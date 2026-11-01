import { createTransport, type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends one email or throws. Also the injection token (an abstract class has a runtime value). */
export abstract class Mailer {
  abstract send(message: EmailMessage): Promise<void>;
}

/**
 * Sends over SMTP: Mailpit locally (compose.yaml), Amazon SES's SMTP endpoint in
 * production. Only the URL changes between them.
 */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(options: { url: string; from: string; requireTls: boolean }) {
    super();
    this.transport = createTransport(
      {
        url: options.url,
        // smtp:// upgrades with STARTTLS when the server offers it; requireTLS refuses
        // to continue in plain text when it doesn't, so a downgrade can't expose links
        requireTLS: options.requireTls,
        // The defaults wait minutes; the outbox retries sooner instead
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      },
      { from: options.from },
    );
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail(message);
  }
}
