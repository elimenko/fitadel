import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type EmailMessage, Mailer } from './mailer';

/**
 * Queues an email. Pass the transaction client of whatever the email is about (a
 * verification token, a reset request): both commit or neither does, and the request
 * returns without waiting for the mail server, in the same time whether or not an
 * email was queued.
 */
export async function enqueueEmail(
  db: Prisma.TransactionClient,
  message: EmailMessage,
): Promise<void> {
  await db.emailOutbox.create({
    data: {
      recipient: message.to,
      subject: message.subject,
      textBody: message.text,
      htmlBody: message.html,
    },
  });
}

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 10;
/** Longer than a batch can take (10 × SmtpMailer's timeouts), so a held row stays held */
const LEASE_MS = 10 * 60 * 1000;
/** 30 s, 1, 2, 4, 8 min between attempts: about 15 minutes before giving up */
const MAX_ATTEMPTS = 6;
const backoffMs = (attempts: number) => 30_000 * 2 ** (attempts - 1);

interface ClaimedRow {
  id: string;
  recipient: string;
  subject: string;
  text_body: string;
  html_body: string | null;
  attempts: number;
}

export interface SendResult {
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * Sends queued emails. Every replica runs it: claiming rows takes a lease in one
 * statement, and `SKIP LOCKED` lets concurrent senders pass over each other's rows
 * instead of waiting or sending them twice.
 *
 * Delivery is at least once: a sender that crashes after sending but before deleting
 * the row leaves it to be sent again when the lease runs out.
 */
@Injectable()
export class EmailOutboxSender implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxSender.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
  ) {}

  onModuleInit() {
    // unref: a pending poll never keeps the process alive on shutdown
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** One run at a time per process: a slow mail server doesn't pile up runs */
  private async poll() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sendDue();
    } catch (error) {
      this.logger.warn({ err: error }, 'Sending queued emails failed');
    } finally {
      this.running = false;
    }
  }

  async sendDue(now = new Date()): Promise<SendResult> {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE email_outbox
      SET attempts = attempts + 1,
          next_attempt_at = ${new Date(now.getTime() + LEASE_MS)}
      WHERE id IN (
        SELECT id FROM email_outbox
        WHERE next_attempt_at <= ${now}
        ORDER BY next_attempt_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, recipient, subject, text_body, html_body, attempts`;

    const result: SendResult = { sent: 0, retrying: 0, failed: 0 };
    for (const row of rows) {
      result[await this.sendOne(row, now)]++;
    }
    return result;
  }

  private async sendOne(row: ClaimedRow, now: Date): Promise<keyof SendResult> {
    try {
      await this.mailer.send({
        to: row.recipient,
        subject: row.subject,
        text: row.text_body,
        html: row.html_body ?? undefined,
      });
      await this.prisma.emailOutbox.delete({ where: { id: row.id } });
      this.logger.log(
        { emailId: row.id, attempts: row.attempts },
        'Email sent',
      );
      return 'sent';
    } catch (error) {
      // Logs get the codes only: SMTP messages often quote the recipient's address
      const { code, responseCode } = error as {
        code?: string;
        responseCode?: number;
      };
      const context = {
        emailId: row.id,
        attempts: row.attempts,
        code,
        responseCode,
      };
      // 5xx: the server refused this message for good (e.g. no such mailbox)
      const permanent = responseCode !== undefined && responseCode >= 500;

      if (permanent || row.attempts >= MAX_ATTEMPTS) {
        await this.prisma.emailOutbox.delete({ where: { id: row.id } });
        this.logger.error(context, 'Email not sent, giving up');
        return 'failed';
      }
      await this.prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      this.logger.warn(context, 'Email not sent, will retry');
      return 'retrying';
    }
  }
}
