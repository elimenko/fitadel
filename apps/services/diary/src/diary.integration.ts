/**
 * Integration tests against a real, throwaway Postgres (Testcontainers).
 * Each run provisions the database with tools/db and applies the migrations, exactly
 * as a fresh environment would. Run with `nx run diary:integration` (needs Docker).
 */
// Far from UTC (+14:00, no daylight saving): a date read or written as local midnight
// would land on the previous day
process.env.TZ = 'Pacific/Kiritimati';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  FakeIdentity,
  routesOpenWithoutToken,
} from '@fitadel/shared-auth/testing';
import { configureHttp, type ProblemDetails } from '@fitadel/shared-http';
import type { Goal } from './goal/goal.dto';

const workspaceRoot = join(__dirname, '../../../..');
const projectRoot = join(__dirname, '..');

/** The same pinned image as local development (compose.yaml is the single source). */
function postgresImage(): string {
  const compose = readFileSync(join(workspaceRoot, 'compose.yaml'), 'utf8');
  const image = /image:\s*(postgres:\S+)/.exec(compose)?.[1];
  if (!image) throw new Error('No postgres image found in compose.yaml');
  return image;
}

const passwords = {
  migrator: randomBytes(16).toString('hex'),
  app: randomBytes(16).toString('hex'),
  reader: randomBytes(16).toString('hex'),
};

let container: StartedPostgreSqlContainer;
let urls: { migrator: string; app: string; reader: string };

/** Runs the Prisma CLI as diary_migrator; throws on a non-zero exit code. */
function prisma(...args: string[]): string {
  return execFileSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), ...args],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: urls.migrator,
        CHECKPOINT_DISABLE: '1',
      },
      encoding: 'utf8',
    },
  );
}

/** Runs one query as the given role and returns its rows */
async function query(url: string, sql: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage())
    .withEnvironment({
      DIARY_MIGRATOR_PASSWORD: passwords.migrator,
      DIARY_APP_PASSWORD: passwords.app,
      DIARY_READER_PASSWORD: passwords.reader,
    })
    // An empty volume runs these on first start, like a fresh local or cloud setup
    .withCopyFilesToContainer(
      ['diary.sh', 'diary.psql'].map((file) => ({
        source: join(workspaceRoot, 'tools/db', file),
        target: `/docker-entrypoint-initdb.d/${file}`,
      })),
    )
    .start();

  const server = `${container.getHost()}:${container.getPort()}`;
  urls = {
    migrator: `postgresql://diary_migrator:${passwords.migrator}@${server}/diary`,
    app: `postgresql://diary_app:${passwords.app}@${server}/diary`,
    reader: `postgresql://diary_reader:${passwords.reader}@${server}/diary`,
  };
  prisma('migrate', 'deploy');
});

afterAll(async () => {
  await container?.stop();
});

describe('database', () => {
  it('denies schema changes to the runtime role', async () => {
    await expect(
      query(urls.app, 'CREATE TABLE intruder (id int)'),
    ).rejects.toThrow(/permission denied for schema public/);
  });

  it('gives the reader role read-only sessions', async () => {
    expect(
      await query(urls.reader, 'SHOW default_transaction_read_only'),
    ).toEqual([{ default_transaction_read_only: 'on' }]);
  });

  // Migrations contain no GRANTs: default privileges cover tables the migrator creates
  it('lets the runtime role write and the reader read migrated tables', async () => {
    const user = '00000000-0000-7000-8000-00000000d1a7';
    await query(
      urls.app,
      `INSERT INTO goal (user_id, effective_from, maintenance_kcal, adjustment_unit,
         adjustment_value, protein_g, fat_g, fiber_g, updated_at)
       VALUES ('${user}', '2026-01-01', 2500, 'kcal', 0, 150, 60, 30, now())`,
    );
    expect(
      await query(
        urls.reader,
        `SELECT maintenance_kcal FROM goal WHERE user_id = '${user}'`,
      ),
    ).toEqual([{ maintenance_kcal: 2500 }]);
    await query(urls.app, `DELETE FROM goal WHERE user_id = '${user}'`);
  });

  it('rejects goals that can never be valid', async () => {
    await expect(
      query(
        urls.app,
        `INSERT INTO goal (user_id, effective_from, maintenance_kcal, adjustment_unit,
           adjustment_value, protein_g, fat_g, fiber_g, updated_at)
         VALUES (gen_random_uuid(), '2026-01-01', 2500, 'kcal', 0, -1, 60, 30, now())`,
      ),
    ).rejects.toThrow(/goal_grams_non_negative/);
  });
});

let app: INestApplication;
let identity: FakeIdentity;

describe('service', () => {
  beforeAll(async () => {
    identity = await FakeIdentity.start();
    // Config is validated when AppModule is loaded, so set the env first
    process.env.DATABASE_URL = urls.app;
    process.env.AUTH_ISSUER = identity.issuer;
    process.env.AUTH_AUDIENCE = identity.audience;
    process.env.AUTH_JWKS_URI = identity.jwksUri;
    const { AppModule } = await import('./app/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.listen(0);
  });

  afterAll(async () => {
    await app?.close();
    await identity?.stop();
  });

  it('is ready with a real database', async () => {
    const response = await fetch(`${await app.getUrl()}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      info: { database: { status: 'up' } },
    });
  });

  it('answers errors with RFC 9457 problem details', async () => {
    const response = await fetch(`${await app.getUrl()}/v1/unknown`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(
      /^application\/problem\+json/,
    );
  });

  it('refuses requests without a token on every route except the public ones', async () => {
    // Routes marked @Public(). The gateway has no public diary routes (envoy.yaml), so
    // a new one also needs an entry there.
    expect(await routesOpenWithoutToken(app)).toEqual([
      'GET /health/live',
      'GET /health/ready',
    ]);
  });

  /** Calls the API as a user, with a token from the fake identity */
  async function api(
    user: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${await app.getUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await identity.token(user)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  describe('goals', () => {
    const listGoals = async (user: string) =>
      (await (await api(user, 'GET', '/v1/goals')).json()) as {
        items: Goal[];
      };

    const settings = {
      maintenanceKcal: 2600,
      adjustment: { unit: 'percent', value: -20 },
      proteinG: 150,
      fatG: 60,
      fiberG: 30,
    };

    /** Each test gets a fresh user, so tests can't see each other's goals */
    let user: string;
    beforeEach(() => {
      user = randomUUID();
    });

    const putGoal = (date: string, body: unknown = settings) =>
      api(user, 'PUT', `/v1/goals/${date}`, body);

    it('creates a goal and returns its targets', async () => {
      const response = await putGoal('2026-11-15');
      expect(response.status).toBe(200);
      const goal = (await response.json()) as Goal;
      expect(goal).toEqual({
        effectiveFrom: '2026-11-15',
        ...settings,
        // 2600 - 20 % = 2080; carbs (2080 - 600 - 540) / 4 = 235
        targets: {
          kcal: 2080,
          proteinG: 150,
          fatG: 60,
          carbsG: 235,
          fiberG: 30,
        },
      });
      expect(
        await (await api(user, 'GET', '/v1/goals/2026-11-15')).json(),
      ).toEqual(goal);
    });

    it('replaces the goal on a repeated PUT for the same date', async () => {
      await putGoal('2026-11-15');
      await putGoal('2026-11-15', { ...settings, proteinG: 160 });
      const { items } = await listGoals(user);
      expect(items).toHaveLength(1);
      expect(items[0].proteinG).toBe(160);
    });

    it('stores the calendar date the client sent, whatever the time zone', async () => {
      await putGoal('2026-11-15');
      expect(
        await query(
          urls.reader,
          `SELECT effective_from::text AS date FROM goal WHERE user_id = '${user}'`,
        ),
      ).toEqual([{ date: '2026-11-15' }]);
    });

    it('finds the goal in effect on a date', async () => {
      await putGoal('2026-09-01', { ...settings, maintenanceKcal: 2500 });
      await putGoal('2026-11-15', { ...settings, maintenanceKcal: 2700 });
      const effectiveOn = async (date: string) => {
        const response = await api(
          user,
          'GET',
          `/v1/goals/effective?date=${date}`,
        );
        return response.status === 200
          ? ((await response.json()) as Goal).effectiveFrom
          : response.status;
      };
      expect(await effectiveOn('2026-08-31')).toBe(404);
      expect(await effectiveOn('2026-09-01')).toBe('2026-09-01');
      expect(await effectiveOn('2026-11-14')).toBe('2026-09-01');
      expect(await effectiveOn('2026-11-15')).toBe('2026-11-15');
      expect(await effectiveOn('2027-03-01')).toBe('2026-11-15');
    });

    it('lists goals, latest first', async () => {
      await putGoal('2026-09-01');
      await putGoal('2026-11-15');
      await putGoal('2026-10-01');
      const { items } = await listGoals(user);
      expect(
        items.map((goal: { effectiveFrom: string }) => goal.effectiveFrom),
      ).toEqual(['2026-11-15', '2026-10-01', '2026-09-01']);
    });

    it('applies the previous goal again after a delete', async () => {
      await putGoal('2026-09-01');
      await putGoal('2026-11-15');
      expect((await api(user, 'DELETE', '/v1/goals/2026-11-15')).status).toBe(
        204,
      );
      expect((await api(user, 'DELETE', '/v1/goals/2026-11-15')).status).toBe(
        404,
      );
      const response = await api(
        user,
        'GET',
        '/v1/goals/effective?date=2026-12-01',
      );
      expect(((await response.json()) as Goal).effectiveFrom).toBe(
        '2026-09-01',
      );
    });

    it("never shows or changes another user's goals", async () => {
      await putGoal('2026-11-15');
      const other = randomUUID();
      expect(await listGoals(other)).toEqual({
        items: [],
      });
      expect((await api(other, 'GET', '/v1/goals/2026-11-15')).status).toBe(
        404,
      );
      expect(
        (await api(other, 'GET', '/v1/goals/effective?date=2026-12-01')).status,
      ).toBe(404);
      expect((await api(other, 'DELETE', '/v1/goals/2026-11-15')).status).toBe(
        404,
      );
      expect((await api(user, 'GET', '/v1/goals/2026-11-15')).status).toBe(200);
    });

    it('rejects protein and fat that need more than the budget', async () => {
      const response = await putGoal('2026-11-15', { ...settings, fatG: 200 });
      expect(response.status).toBe(422);
      expect(response.headers.get('content-type')).toMatch(
        /^application\/problem\+json/,
      );
      expect(await response.json()).toMatchObject({
        status: 422,
        detail:
          'Protein and fat alone are 2400 kcal, more than the budget of 2080 kcal',
      });
      const { items } = await listGoals(user);
      expect(items).toEqual([]);
    });

    it('rejects dates that are not calendar dates, and invalid settings', async () => {
      expect((await putGoal('2026-02-30')).status).toBe(400);
      expect((await putGoal('15.11.2026')).status).toBe(400);
      expect(
        (await api(user, 'GET', '/v1/goals/effective?date=tomorrow')).status,
      ).toBe(400);
      const response = await putGoal('2026-11-15', {
        ...settings,
        adjustment: { unit: 'percent', value: -500 },
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as ProblemDetails).errors).toEqual([
        { path: 'adjustment.value', message: expect.any(String) },
      ]);
    });

    it('treats a missing adjustment as none', async () => {
      const { maintenanceKcal, proteinG, fatG, fiberG } = settings;
      const response = await putGoal('2026-11-15', {
        maintenanceKcal,
        proteinG,
        fatG,
        fiberG,
      });
      const goal = (await response.json()) as Goal;
      expect(goal.adjustment).toEqual({ unit: 'kcal', value: 0 });
      expect(goal.targets.kcal).toBe(2600);
    });
  });
});
