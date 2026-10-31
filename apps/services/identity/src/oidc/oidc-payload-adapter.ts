import { createHash } from 'node:crypto';
import type { Adapter, AdapterFactory, AdapterPayload } from 'oidc-provider';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

/**
 * oidc-provider's storage in the oidc_payload table, one adapter per model
 * (AuthorizationCode, RefreshToken, Session, Grant, …).
 *
 * `alreadyConsumed` creates the error a losing concurrent consume throws; the provider
 * passes oidc-provider's InvalidGrant, so the client gets a 400 rather than a 500.
 */
export function oidcPayloadAdapterFactory(
  prisma: PrismaClient,
  alreadyConsumed: () => Error,
): AdapterFactory {
  return (model) => new OidcPayloadAdapter(prisma, model, alreadyConsumed);
}

export class OidcPayloadAdapter implements Adapter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly model: string,
    private readonly alreadyConsumed: () => Error,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
    const key = { model: this.model, id: digest(id) };
    const data = {
      // `consumed` lives in consumed_at only, so the JSON can't contradict it
      payload: {
        ...payload,
        consumed: undefined,
      } as unknown as Prisma.InputJsonObject,
      grantId: payload.grantId ?? null,
      uid: payload.uid ?? null,
      userCode: payload.userCode ?? null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
    await this.prisma.oidcPayload.upsert({
      where: { model_id: key },
      create: { ...key, ...data },
      update: data,
    });
  }

  async find(id: string) {
    return toPayload(
      await this.prisma.oidcPayload.findFirst({
        where: { model: this.model, id: digest(id), ...notExpired() },
      }),
    );
  }

  async findByUid(uid: string) {
    return toPayload(
      await this.prisma.oidcPayload.findFirst({
        where: { model: this.model, uid, ...notExpired() },
      }),
    );
  }

  async findByUserCode(userCode: string) {
    return toPayload(
      await this.prisma.oidcPayload.findFirst({
        where: { model: this.model, userCode, ...notExpired() },
      }),
    );
  }

  /**
   * Marks a code or refresh token as used, atomically: of two concurrent requests with
   * the same code, exactly one updates the row. The engine checks `consumed` before
   * calling this, but two requests can both pass that check (WP-10); the loser ends up
   * here with 0 rows updated and is treated like a reuse: the grant is revoked.
   */
  async consume(id: string) {
    const key = { model: this.model, id: digest(id) };
    const { count } = await this.prisma.oidcPayload.updateMany({
      where: { ...key, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 1) return;

    const row = await this.prisma.oidcPayload.findUnique({
      where: { model_id: key },
      select: { grantId: true },
    });
    if (row?.grantId) await this.revokeGrant(row.grantId);
    throw this.alreadyConsumed();
  }

  async destroy(id: string) {
    await this.prisma.oidcPayload.deleteMany({
      where: { model: this.model, id: digest(id) },
    });
  }

  /** The engine calls this once per model when it revokes a grant */
  async revokeByGrantId(grantId: string) {
    await this.prisma.oidcPayload.deleteMany({
      where: { model: this.model, grantId },
    });
  }

  /** Every code and token of the grant, and the grant itself */
  private async revokeGrant(grantId: string) {
    await this.prisma.oidcPayload.deleteMany({
      where: {
        OR: [{ grantId }, { model: 'Grant', id: digest(grantId) }],
      },
    });
  }
}

/** Deletes rows past their expiry; find() already ignores them. Returns the count. */
export async function deleteExpiredOidcPayloads(
  prisma: PrismaClient,
): Promise<number> {
  const { count } = await prisma.oidcPayload.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

/**
 * For codes and refresh tokens the engine's id is the secret itself, so only its
 * SHA-256 is stored. A fast hash is enough: the ids are 256 random bits, nothing to
 * guess (unlike passwords).
 */
function digest(id: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(id).digest());
}

function notExpired() {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}

function toPayload(
  row: { payload: Prisma.JsonValue; consumedAt: Date | null } | null,
): AdapterPayload | undefined {
  if (!row) return undefined;
  const payload = row.payload as AdapterPayload;
  return row.consumedAt
    ? { ...payload, consumed: Math.floor(row.consumedAt.getTime() / 1000) }
    : payload;
}
