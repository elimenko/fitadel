import { Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import * as client from 'openid-client';
import { normalizeEmail } from '../account/email';
import { linkTokenHash } from '../account/link-token';
import { PrismaService } from '../prisma/prisma.service';
import type { ExternalIdentity, GoogleClient } from './google-client';

/** How long a user may take at Google before the attempt and its result expire */
export const FEDERATION_TTL_MS = 10 * 60 * 1000;

/** What the sign-in page does once the browser is back from Google */
export type FederationResult =
  | { outcome: 'signed_in'; accountId: string }
  | { outcome: 'link_required'; email: string }
  | { outcome: 'email_unverified' }
  | { outcome: 'failed' };

type Resolution =
  | { outcome: 'signed_in'; accountId: string }
  | {
      outcome: 'link_required';
      accountId: string;
      issuer: string;
      subject: string;
    }
  | { outcome: 'email_unverified' };

/**
 * Sign-in through an external provider (Google), in three requests: the start
 * redirects to the provider, its callback maps the identity to an account, and the
 * interaction picks up the result. A provider identity is keyed by (issuer, subject),
 * never by email: it reaches an existing account only through a link created after
 * that account's password sign-in (docs/architecture/authentication.md).
 */
@Injectable()
export class FederationService {
  private readonly logger = new Logger(FederationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleClient | null,
  ) {}

  get googleEnabled(): boolean {
    return this.google !== null;
  }

  get googleRedirectUri(): string {
    return this.requireGoogle().redirectUri;
  }

  /**
   * Starts a Google sign-in for an interaction: stores the attempt and returns where
   * to send the browser, and the `state` to bind the callback to this browser.
   */
  async startGoogle(
    interactionUid: string,
    now = new Date(),
  ): Promise<{ url: URL; state: string }> {
    const google = this.requireGoogle();
    const checks = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier: client.randomPKCECodeVerifier(),
    };
    // Expired rows of either table go here; nothing else creates them
    await this.prisma.$transaction([
      this.prisma.federationAttempt.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
      this.prisma.federationResult.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
      this.prisma.federationAttempt.create({
        data: {
          stateHash: linkTokenHash(checks.state),
          interactionUid,
          codeVerifier: checks.codeVerifier,
          nonce: checks.nonce,
          expiresAt: new Date(now.getTime() + FEDERATION_TTL_MS),
        },
      }),
    ]);
    return { url: await google.authorizationUrl(checks), state: checks.state };
  }

  /**
   * Google's redirect back: uses the attempt up, asks Google who signed in and stores
   * the result for the interaction. Returns the interaction's uid, or undefined when
   * the callback matches no attempt of this browser (unknown, expired or used state).
   */
  async finishGoogle(
    callbackUrl: URL,
    browserState: string | undefined,
    now = new Date(),
  ): Promise<string | undefined> {
    const google = this.requireGoogle();
    const state = callbackUrl.searchParams.get('state');
    // The state cookie proves this browser started the attempt: a callback URL with
    // someone else's code (login CSRF) is refused
    if (!state || !browserState || !sameValue(state, browserState)) {
      return undefined;
    }
    const attempt = await this.consumeAttempt(state, now);
    if (!attempt) return undefined;

    let result: Resolution | { outcome: 'failed' };
    try {
      const identity = await google.identityFromCallback(callbackUrl, {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.codeVerifier,
      });
      result = await this.resolve(identity, now);
    } catch (error) {
      // An error from Google (the user cancelled, a bad code) or a failed check
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Google sign-in failed',
      );
      result = { outcome: 'failed' };
    }

    const data = {
      outcome: result.outcome,
      accountId: 'accountId' in result ? result.accountId : null,
      issuer: 'issuer' in result ? result.issuer : null,
      subject: 'subject' in result ? result.subject : null,
      expiresAt: new Date(now.getTime() + FEDERATION_TTL_MS),
    };
    await this.prisma.federationResult.upsert({
      where: { interactionUid: attempt.interactionUid },
      create: { interactionUid: attempt.interactionUid, ...data },
      update: data,
    });
    this.logger.log(
      { outcome: result.outcome, accountId: data.accountId ?? undefined },
      'Google sign-in returned',
    );
    return attempt.interactionUid;
  }

  /**
   * The result for an interaction, once its browser is back. A link_required result
   * stays until the password sign-in that links it; the others are used up here.
   */
  async resultFor(
    interactionUid: string,
    now = new Date(),
  ): Promise<FederationResult | undefined> {
    const row = await this.prisma.federationResult.findUnique({
      where: { interactionUid },
      select: {
        outcome: true,
        accountId: true,
        expiresAt: true,
        account: { select: { email: true } },
      },
    });
    if (!row || row.expiresAt <= now) return undefined;
    if (row.outcome === 'link_required' && row.account) {
      return { outcome: 'link_required', email: row.account.email };
    }
    await this.prisma.federationResult.deleteMany({
      where: { interactionUid },
    });
    if (row.outcome === 'signed_in' && row.accountId) {
      return { outcome: 'signed_in', accountId: row.accountId };
    }
    return row.outcome === 'email_unverified'
      ? { outcome: 'email_unverified' }
      : { outcome: 'failed' };
  }

  /** Whether the interaction came back from Google needing a password sign-in to link */
  async isLinkPending(
    interactionUid: string,
    now = new Date(),
  ): Promise<boolean> {
    const count = await this.prisma.federationResult.count({
      where: {
        interactionUid,
        outcome: 'link_required',
        expiresAt: { gt: now },
      },
    });
    return count > 0;
  }

  /**
   * After a password sign-in: if this interaction came back from Google needing a
   * link to this account, the password proved ownership, so link the identity.
   * Returns whether it linked one.
   */
  async linkAfterSignIn(
    interactionUid: string,
    accountId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.federationResult.findUnique({
        where: { interactionUid },
      });
      if (pending?.outcome !== 'link_required') return false;
      // A double submit: exactly one deletes the row and links
      const { count } = await tx.federationResult.deleteMany({
        where: { interactionUid },
      });
      if (
        count === 0 ||
        pending.expiresAt <= now ||
        // Signed in to another account than the one with Google's email: no link
        pending.accountId !== accountId ||
        !pending.issuer ||
        !pending.subject
      ) {
        return false;
      }
      const linked = await tx.accountIdentity.createManyAndReturn({
        data: [{ accountId, issuer: pending.issuer, subject: pending.subject }],
        skipDuplicates: true,
        select: { id: true },
      });
      if (linked.length > 0) {
        this.logger.log({ accountId }, 'Google identity linked');
      }
      return linked.length > 0;
    });
  }

  /** Finds the attempt for a state and deletes it, so each callback works once */
  private consumeAttempt(state: string, now: Date) {
    const stateHash = linkTokenHash(state);
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.federationAttempt.findUnique({
        where: { stateHash },
      });
      if (!attempt) return undefined;
      // Two callbacks at once both found it; exactly one deletes it
      const { count } = await tx.federationAttempt.deleteMany({
        where: { stateHash },
      });
      return count === 1 && attempt.expiresAt > now ? attempt : undefined;
    });
  }

  /** Maps a provider identity to an account: linked, new, or waiting for a link */
  private async resolve(
    identity: ExternalIdentity,
    now: Date,
    retried = false,
  ): Promise<Resolution> {
    const { issuer, subject } = identity;
    const linked = await this.prisma.accountIdentity.findUnique({
      where: { issuer_subject: { issuer, subject } },
      select: { accountId: true },
    });
    if (linked) return { outcome: 'signed_in', accountId: linked.accountId };

    // Without the provider's word for the email it can't become a login name
    if (!identity.email || !identity.emailVerified) {
      return { outcome: 'email_unverified' };
    }
    const email = normalizeEmail(identity.email);
    const existing = await this.prisma.account.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return {
        outcome: 'link_required',
        accountId: existing.id,
        issuer,
        subject,
      };
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING: an account created for this email meanwhile (another
      // tab finishing the same sign-up, or a registration link) is resolved again
      const [account] = await tx.account.createManyAndReturn({
        data: [
          { email, emailVerifiedAt: now, displayName: identity.name ?? null },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      if (!account) return undefined;
      await tx.accountIdentity.create({
        data: { accountId: account.id, issuer, subject },
      });
      return account.id;
    });
    if (created) {
      this.logger.log({ accountId: created }, 'Account created with Google');
      return { outcome: 'signed_in', accountId: created };
    }
    if (retried) throw new Error('Account changed twice during a sign-up');
    return this.resolve(identity, now, true);
  }

  private requireGoogle(): GoogleClient {
    if (!this.google) throw new Error('Google sign-in is not configured');
    return this.google;
  }
}

/** Constant-time comparison: how much of a guessed state matched must not leak */
function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
