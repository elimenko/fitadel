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
import { type Food, NutrientBasis } from '@fitadel/catalog-grpc';
import { FakeCatalog, PROTO_DIR } from '@fitadel/catalog-grpc/testing';
import { type Metadata, status } from '@grpc/grpc-js';
import {
  FakeIdentity,
  routesOpenWithoutToken,
} from '@fitadel/shared-auth/testing';
import { configureHttp, type ProblemDetails } from '@fitadel/shared-http';
import type { Day, Entry } from './day/day.dto';
import type { Goal } from './goal/goal.dto';
import { IdempotencyService } from './idempotency/idempotency.service';

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

  it('accepts unknown macros in diary entries, but not negative values', async () => {
    const insert = (proteinG: string) =>
      query(
        urls.app,
        `INSERT INTO diary_entry (user_id, date, meal, kcal, protein_g, updated_at)
         VALUES (gen_random_uuid(), '2026-11-15', 'lunch', 300, ${proteinG}, now())`,
      );
    // A CHECK on NULL is unknown, not false, so it passes
    await expect(insert('NULL')).resolves.toEqual([]);
    await expect(insert('-1')).rejects.toThrow(
      /diary_entry_values_non_negative/,
    );
  });

  it('keeps the food columns of an entry all or nothing', async () => {
    const insert = (columns: string, values: string) =>
      query(
        urls.app,
        `INSERT INTO diary_entry (user_id, date, meal, kcal, updated_at${columns})
         VALUES (gen_random_uuid(), '2026-11-15', 'lunch', 300, now()${values})`,
      );
    const food = ', food_id, amount, basis, kcal_per_100';
    await expect(
      insert(food, ", gen_random_uuid(), 150, 'g', 200"),
    ).resolves.toEqual([]);
    // A food without an amount, or a manual entry with a brand
    await expect(
      insert(', food_id, basis, kcal_per_100', ", gen_random_uuid(), 'g', 200"),
    ).rejects.toThrow(/diary_entry_food_all_or_nothing/);
    await expect(insert(', brand', ", 'Piątnica'")).rejects.toThrow(
      /diary_entry_food_all_or_nothing/,
    );
    await expect(
      insert(food, ", gen_random_uuid(), 0, 'g', 200"),
    ).rejects.toThrow(/diary_entry_food_values_valid/);
  });
});

let app: INestApplication;
let identity: FakeIdentity;
let catalog: FakeCatalog;

describe('service', () => {
  beforeAll(async () => {
    identity = await FakeIdentity.start();
    catalog = await FakeCatalog.start();
    // Config is validated when AppModule is loaded, so set the env first
    process.env.CATALOG_GRPC_URL = catalog.url;
    process.env.CATALOG_PROTO_DIR = PROTO_DIR;
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
    await catalog?.stop();
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
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return fetch(`${await app.getUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await identity.token(user)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
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

  describe('diary', () => {
    const zeros = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0 };

    let user: string;
    beforeEach(() => {
      user = randomUUID();
    });

    const day = async (date: string, asUser = user) =>
      (await (await api(asUser, 'GET', `/v1/days/${date}`)).json()) as Day;

    const logEntry = async (date: string, entry: Record<string, unknown>) => {
      const response = await api(
        user,
        'POST',
        `/v1/days/${date}/entries`,
        entry,
      );
      expect(response.status).toBe(201);
      return (await response.json()) as Entry;
    };

    const breakfast = {
      kind: 'manual',
      meal: 'breakfast',
      name: 'Oatmeal',
      kcal: 400,
      proteinG: 20,
      fatG: 10,
      carbsG: 55,
      fiberG: 8,
    };

    it('shows an empty day without a goal', async () => {
      const empty = { entries: [], totals: zeros };
      expect(await day('2026-11-15')).toEqual({
        date: '2026-11-15',
        meals: { breakfast: empty, lunch: empty, dinner: empty, snack: empty },
        totals: zeros,
        targets: null,
        remaining: null,
        incomplete: [],
      });
    });

    it('sums the day by meal against the goal in effect', async () => {
      await api(user, 'PUT', '/v1/goals/2026-11-01', {
        maintenanceKcal: 2500,
        adjustment: { unit: 'kcal', value: -500 },
        proteinG: 150,
        fatG: 60,
        fiberG: 30,
      });
      const oatmeal = await logEntry('2026-11-15', breakfast);
      const coffee = await logEntry('2026-11-15', {
        kind: 'manual',
        meal: 'breakfast',
        kcal: 60,
      });
      await logEntry('2026-11-15', {
        kind: 'manual',
        meal: 'lunch',
        name: 'Canteen lunch',
        kcal: 750.5,
        proteinG: 35,
      });

      const result = await day('2026-11-15');
      expect(result.meals.breakfast.entries.map((entry) => entry.id)).toEqual([
        oatmeal.id,
        coffee.id,
      ]);
      expect(result.meals.breakfast.totals.kcal).toBe(460);
      expect(result.meals.dinner.entries).toEqual([]);
      expect(result.totals).toEqual({
        kcal: 1210.5,
        proteinG: 55,
        fatG: 10,
        carbsG: 55,
        fiberG: 8,
      });
      // 2000 kcal; carbs (2000 - 600 - 540) / 4 = 215
      expect(result.targets).toEqual({
        kcal: 2000,
        proteinG: 150,
        fatG: 60,
        carbsG: 215,
        fiberG: 30,
      });
      expect(result.remaining).toEqual({
        kcal: 789.5,
        proteinG: 95,
        fatG: 50,
        carbsG: 160,
        fiberG: 22,
      });
      expect(result.incomplete).toEqual([
        'proteinG',
        'fatG',
        'carbsG',
        'fiberG',
      ]);
    });

    it('goes negative when over the budget', async () => {
      await api(user, 'PUT', '/v1/goals/2026-11-01', {
        maintenanceKcal: 2000,
        proteinG: 100,
        fatG: 50,
        fiberG: 25,
      });
      await logEntry('2026-11-15', {
        kind: 'manual',
        meal: 'dinner',
        kcal: 2300,
      });
      expect((await day('2026-11-15')).remaining?.kcal).toBe(-300);
    });

    it('logs a quick entry with only calories', async () => {
      const response = await api(user, 'POST', '/v1/days/2026-11-15/entries', {
        kind: 'manual',
        meal: 'snack',
        kcal: 150,
      });
      const entry = (await response.json()) as Entry;
      expect(response.headers.get('location')).toBe(`/v1/entries/${entry.id}`);
      expect(entry).toEqual({
        id: expect.any(String),
        kind: 'manual',
        date: '2026-11-15',
        meal: 'snack',
        name: null,
        kcal: 150,
        proteinG: null,
        fatG: null,
        carbsG: null,
        fiberG: null,
        food: null,
      });
      expect(
        await (await api(user, 'GET', `/v1/entries/${entry.id}`)).json(),
      ).toEqual(entry);
    });

    it('stores values to one decimal', async () => {
      const entry = await logEntry('2026-11-15', {
        kind: 'manual',
        meal: 'snack',
        kcal: 100.26,
        proteinG: 3.14,
      });
      expect(entry.kcal).toBe(100.3);
      expect(entry.proteinG).toBe(3.1);
    });

    it('moves an entry to another day and meal', async () => {
      const entry = await logEntry('2026-11-15', breakfast);
      const response = await api(user, 'PUT', `/v1/entries/${entry.id}`, {
        ...breakfast,
        date: '2026-11-16',
        meal: 'dinner',
        kcal: 450,
      });
      expect(response.status).toBe(200);
      expect((await day('2026-11-15')).totals.kcal).toBe(0);
      const moved = (await day('2026-11-16')).meals.dinner.entries;
      expect(moved).toEqual([
        { ...entry, date: '2026-11-16', meal: 'dinner', kcal: 450 },
      ]);
    });

    it('deletes an entry', async () => {
      const entry = await logEntry('2026-11-15', breakfast);
      expect(
        (await api(user, 'DELETE', `/v1/entries/${entry.id}`)).status,
      ).toBe(204);
      expect(
        (await api(user, 'DELETE', `/v1/entries/${entry.id}`)).status,
      ).toBe(404);
      expect((await day('2026-11-15')).totals.kcal).toBe(0);
    });

    it("never shows or changes another user's entries", async () => {
      const entry = await logEntry('2026-11-15', breakfast);
      const other = randomUUID();
      expect((await day('2026-11-15', other)).totals.kcal).toBe(0);
      expect((await api(other, 'GET', `/v1/entries/${entry.id}`)).status).toBe(
        404,
      );
      expect(
        (
          await api(other, 'PUT', `/v1/entries/${entry.id}`, {
            ...breakfast,
            date: '2026-11-15',
          })
        ).status,
      ).toBe(404);
      expect(
        (await api(other, 'DELETE', `/v1/entries/${entry.id}`)).status,
      ).toBe(404);
      expect((await day('2026-11-15')).totals.kcal).toBe(400);
    });

    it('rejects invalid entries', async () => {
      const post = (entry: unknown) =>
        api(user, 'POST', '/v1/days/2026-11-15/entries', entry);
      expect((await post({ kind: 'manual', meal: 'snack' })).status).toBe(400);
      // Without a kind, the body is neither a manual nor a food entry
      expect((await post({ meal: 'snack', kcal: 100 })).status).toBe(400);
      expect(
        (await post({ kind: 'manual', meal: 'brunch', kcal: 100 })).status,
      ).toBe(400);
      expect(
        (await post({ kind: 'manual', meal: 'snack', kcal: -1 })).status,
      ).toBe(400);
      expect(
        (await api(user, 'POST', '/v1/days/2026-13-01/entries', breakfast))
          .status,
      ).toBe(400);
      expect((await api(user, 'GET', '/v1/entries/not-an-id')).status).toBe(
        400,
      );
    });

    describe('food entries', () => {
      const KEFIR = '0192f8a4-6a3e-7c00-8f00-00000000ce71';
      const QUARK = '0192f8a4-6a3e-7c00-8f00-000000009a4c';
      // Protein unknown (unset), fiber a known 0
      const kefir: Food = {
        id: KEFIR,
        name: 'Kefir',
        brand: 'Piątnica',
        basis: NutrientBasis.NUTRIENT_BASIS_ML,
        per100: { kcal: 51, fatG: 2, carbsG: 4.7, fiberG: 0 },
      };
      const quark: Food = {
        id: QUARK,
        name: 'Twaróg półtłusty',
        basis: NutrientBasis.NUTRIENT_BASIS_G,
        per100: { kcal: 133, proteinG: 18, fatG: 4.5, carbsG: 3.6 },
      };

      beforeEach(() => {
        catalog.reset();
        catalog.foods.set(KEFIR, kefir);
        catalog.foods.set(QUARK, quark);
      });

      const logFood = (
        foodId: string,
        amount: number,
        headers: Record<string, string> = {},
      ) =>
        api(
          user,
          'POST',
          '/v1/days/2026-11-15/entries',
          { kind: 'food', meal: 'breakfast', foodId, amount },
          headers,
        );

      it('logs a food: values for the amount, and a copy of the food', async () => {
        const response = await logFood(KEFIR, 250, {
          'Accept-Language': 'en-GB,pl;q=0.8',
        });
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
          id: expect.any(String),
          kind: 'food',
          date: '2026-11-15',
          meal: 'breakfast',
          name: 'Kefir',
          kcal: 127.5,
          proteinG: null,
          fatG: 5,
          carbsG: 11.8,
          fiberG: 0,
          food: {
            id: KEFIR,
            amount: 250,
            basis: 'ml',
            brand: 'Piątnica',
            per100: {
              kcal: 51,
              proteinG: null,
              fatG: 2,
              carbsG: 4.7,
              fiberG: 0,
            },
          },
        });

        // Asked on the user's behalf: their token and languages
        const [call] = catalog.calls;
        expect(call.request).toEqual({ id: KEFIR, languages: ['en', 'pl'] });
        expect((call.metadata as Metadata).get('authorization')).toEqual([
          expect.stringMatching(/^Bearer ey/),
        ]);

        // An unknown macro makes the day's protein a lower bound
        expect((await day('2026-11-15')).incomplete).toContain('proteinG');
      });

      it('keeps the copy when only the amount changes, even if the catalog changed', async () => {
        const logged = (await (await logFood(QUARK, 200)).json()) as Entry;
        expect(logged.kcal).toBe(266);
        catalog.foods.set(QUARK, {
          ...quark,
          per100: { kcal: 999, proteinG: 1 },
        });

        const response = await api(user, 'PUT', `/v1/entries/${logged.id}`, {
          kind: 'food',
          date: '2026-11-15',
          meal: 'lunch',
          foodId: QUARK,
          amount: 100,
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          meal: 'lunch',
          kcal: 133,
          proteinG: 18,
          food: { amount: 100, per100: { kcal: 133 } },
        });
        // Only the first logging asked the catalog
        expect(catalog.calls).toHaveLength(1);
      });

      it('copies a different food anew, or becomes a manual entry', async () => {
        const logged = (await (await logFood(QUARK, 200)).json()) as Entry;
        const put = (body: object) =>
          api(user, 'PUT', `/v1/entries/${logged.id}`, {
            date: '2026-11-15',
            meal: 'breakfast',
            ...body,
          });

        const swapped = await put({ kind: 'food', foodId: KEFIR, amount: 100 });
        expect(await swapped.json()).toMatchObject({
          name: 'Kefir',
          kcal: 51,
          food: { id: KEFIR, basis: 'ml' },
        });
        expect(catalog.calls).toHaveLength(2);

        const manual = await put({
          kind: 'manual',
          name: 'Leftovers',
          kcal: 300,
        });
        expect(await manual.json()).toMatchObject({
          kind: 'manual',
          name: 'Leftovers',
          kcal: 300,
          proteinG: null,
          food: null,
        });
      });

      it("answers 422 for a food that doesn't exist or isn't the user's", async () => {
        const unknown = '0192f8a4-6a3e-7c00-8f00-0000000dead0';
        const response = await logFood(unknown, 100);
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({
          detail: 'No such food in the catalog',
          foodId: unknown,
        });
      });

      it('tells catalog failures apart, and logs nothing', async () => {
        catalog.failWith(status.UNAVAILABLE);
        expect((await logFood(KEFIR, 100)).status).toBe(503);
        catalog.failWith(status.INTERNAL);
        expect((await logFood(KEFIR, 100)).status).toBe(502);
        catalog.answer = () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ food: kefir }), 1500),
          );
        expect((await logFood(KEFIR, 100)).status).toBe(504);

        expect((await day('2026-11-15')).meals.breakfast.entries).toEqual([]);
      });

      it('rejects invalid food entries without asking the catalog', async () => {
        expect((await logFood(KEFIR, 0)).status).toBe(400);
        expect((await logFood(KEFIR, 5001)).status).toBe(400);
        expect((await logFood('kefir', 100)).status).toBe(400);
        expect(catalog.calls).toEqual([]);
      });
    });

    describe('copying entries', () => {
      const snack = { kind: 'manual', meal: 'snack', name: 'Apple', kcal: 80 };

      const copy = (date: string, body: unknown, asUser = user) =>
        api(asUser, 'POST', `/v1/days/${date}/entries/copies`, body);

      it('copies entries to another day, each into its own meal, in the order asked', async () => {
        const oatmeal = await logEntry('2026-11-15', breakfast);
        const apple = await logEntry('2026-11-15', snack);

        const response = await copy('2026-11-16', {
          entryIds: [apple.id, oatmeal.id],
        });
        expect(response.status).toBe(201);
        const { entries } = (await response.json()) as { entries: Entry[] };
        expect(entries).toEqual([
          { ...apple, id: expect.any(String), date: '2026-11-16' },
          { ...oatmeal, id: expect.any(String), date: '2026-11-16' },
        ]);
        expect(entries.map((entry) => entry.id)).not.toContain(apple.id);

        const copied = await day('2026-11-16');
        expect(copied.meals.breakfast.entries).toEqual([entries[1]]);
        expect(copied.meals.snack.entries).toEqual([entries[0]]);
        // The sources stay where they were
        expect((await day('2026-11-15')).totals.kcal).toBe(480);
      });

      it('copies a whole meal into another meal', async () => {
        const first = await logEntry('2026-11-15', breakfast);
        const second = await logEntry('2026-11-15', snack);
        const { meals } = await day('2026-11-15');
        expect(meals.breakfast.entries).toHaveLength(1);

        const response = await copy('2026-11-15', {
          entryIds: [first.id, second.id],
          meal: 'lunch',
        });
        expect(response.status).toBe(201);
        const lunch = (await day('2026-11-15')).meals.lunch;
        expect(lunch.entries.map((entry) => entry.name)).toEqual([
          'Oatmeal',
          'Apple',
        ]);
        expect(lunch.totals.kcal).toBe(480);
      });

      it('copies a food entry with its copy of the food, without the catalog', async () => {
        const RYE = '0192f8a4-6a3e-7c00-8f00-00000000a1e0';
        catalog.reset();
        catalog.foods.set(RYE, {
          id: RYE,
          name: 'Rye bread',
          basis: NutrientBasis.NUTRIENT_BASIS_G,
          per100: {
            kcal: 259,
            proteinG: 8.5,
            fatG: 3.3,
            carbsG: 48,
            fiberG: 5.8,
          },
        });
        const logged = await logEntry('2026-11-15', {
          kind: 'food',
          meal: 'breakfast',
          foodId: RYE,
          amount: 70,
        });
        // The catalog changes, then fails: the copy needs neither
        catalog.foods.set(RYE, {
          id: RYE,
          name: 'Rye bread, new recipe',
          basis: NutrientBasis.NUTRIENT_BASIS_G,
          per100: { kcal: 300 },
        });
        catalog.failWith(status.UNAVAILABLE);
        const callsBefore = catalog.calls.length;

        const response = await copy('2026-11-16', { entryIds: [logged.id] });
        expect(response.status).toBe(201);
        const { entries } = (await response.json()) as { entries: Entry[] };
        expect(entries).toEqual([
          { ...logged, id: expect.any(String), date: '2026-11-16' },
        ]);
        expect(catalog.calls).toHaveLength(callsBefore);
      });

      it("copies nothing when some entry isn't the user's", async () => {
        const mine = await logEntry('2026-11-15', breakfast);
        const other = randomUUID();
        const theirs = (await (
          await api(other, 'POST', '/v1/days/2026-11-15/entries', snack)
        ).json()) as Entry;
        const unknown = randomUUID();

        const response = await copy('2026-11-16', {
          entryIds: [mine.id, theirs.id, unknown],
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({
          detail: 'No such entries in your diary',
          entryIds: [theirs.id, unknown],
        });
        expect((await day('2026-11-16')).totals.kcal).toBe(0);
      });

      it('rejects invalid copies', async () => {
        const entry = await logEntry('2026-11-15', breakfast);
        const ids = (count: number) =>
          Array.from({ length: count }, () => randomUUID());
        for (const body of [
          { entryIds: [] },
          { entryIds: [entry.id, entry.id] },
          { entryIds: ids(51) },
          { entryIds: ['not-an-id'] },
          { entryIds: [entry.id], meal: 'brunch' },
          {},
        ]) {
          expect((await copy('2026-11-16', body)).status).toBe(400);
        }
        expect(
          (await copy('2026-13-01', { entryIds: [entry.id] })).status,
        ).toBe(400);
        // 50 is allowed: unknown ids then make it a 422, not a 400
        expect((await copy('2026-11-16', { entryIds: ids(50) })).status).toBe(
          422,
        );
      });
    });

    describe('Idempotency-Key', () => {
      const OATS = '0192f8a4-6a3e-7c00-8f00-0000000000a7';
      const oats: Food = {
        id: OATS,
        name: 'Oat flakes',
        basis: NutrientBasis.NUTRIENT_BASIS_G,
        per100: { kcal: 372, proteinG: 13, fatG: 7, carbsG: 59, fiberG: 10 },
      };
      const apple = { kind: 'manual', meal: 'snack', name: 'Apple', kcal: 80 };

      beforeEach(() => {
        catalog.reset();
        catalog.foods.set(OATS, oats);
      });

      const post = (path: string, body: unknown, key: string, asUser = user) =>
        api(asUser, 'POST', path, body, { 'Idempotency-Key': key });
      const log = (body: unknown, key: string, asUser = user) =>
        post('/v1/days/2026-11-22/entries', body, key, asUser);
      const entriesOn = async (date: string, asUser = user) =>
        Object.values((await day(date, asUser)).meals).flatMap(
          (meal) => meal.entries,
        );

      it('answers a retry with the first answer, and writes once', async () => {
        const key = randomUUID();
        const first = await log(apple, key);
        const retry = await log(apple, key);

        expect(first.status).toBe(201);
        expect(retry.status).toBe(201);
        expect(first.headers.get('idempotent-replayed')).toBeNull();
        expect(retry.headers.get('idempotent-replayed')).toBe('true');
        const entry = (await first.json()) as Entry;
        expect(await retry.json()).toEqual(entry);
        expect(retry.headers.get('location')).toBe(`/v1/entries/${entry.id}`);
        expect(await entriesOn('2026-11-22')).toEqual([entry]);

        // Without a key, every POST is a new entry
        await api(user, 'POST', '/v1/days/2026-11-22/entries', apple);
        await api(user, 'POST', '/v1/days/2026-11-22/entries', apple);
        expect(await entriesOn('2026-11-22')).toHaveLength(3);
      });

      it('keeps keys per user', async () => {
        const key = randomUUID();
        const other = randomUUID();
        const mine = (await (await log(apple, key)).json()) as Entry;
        const response = await log(apple, key, other);
        expect(response.headers.get('idempotent-replayed')).toBeNull();
        expect(((await response.json()) as Entry).id).not.toBe(mine.id);
        expect(await entriesOn('2026-11-22', other)).toHaveLength(1);
      });

      it('refuses the same key for a different request', async () => {
        const key = randomUUID();
        const entry = (await (await log(apple, key)).json()) as Entry;
        const refused = [
          await log({ ...apple, kcal: 90 }, key),
          await post('/v1/days/2026-11-23/entries', apple, key),
          await post(
            '/v1/days/2026-11-22/entries/copies',
            { entryIds: [entry.id] },
            key,
          ),
        ];
        for (const response of refused) {
          expect(response.status).toBe(422);
          expect(await response.json()).toMatchObject({
            detail: 'This Idempotency-Key was used for a different request',
          });
        }
        expect(await entriesOn('2026-11-22')).toHaveLength(1);
      });

      it('stores only successes: a retry after a failure runs again', async () => {
        const key = randomUUID();
        const oatmeal = {
          kind: 'food',
          meal: 'breakfast',
          foodId: OATS,
          amount: 60,
        };
        catalog.failWith(status.UNAVAILABLE);
        expect((await log(oatmeal, key)).status).toBe(503);

        catalog.reset();
        catalog.foods.set(OATS, oats);
        const retry = await log(oatmeal, key);
        expect(retry.status).toBe(201);
        expect(retry.headers.get('idempotent-replayed')).toBeNull();
        expect(await entriesOn('2026-11-22')).toHaveLength(1);
      });

      it('writes once when the same request arrives twice at the same time', async () => {
        // Both requests check for the key before the slow catalog call, so both find
        // none and both write: only the key, stored in the same transaction, stops
        // the second
        catalog.answer = () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ food: oats }), 300),
          );
        const key = randomUUID();
        const oatmeal = {
          kind: 'food',
          meal: 'breakfast',
          foodId: OATS,
          amount: 60,
        };

        const responses = await Promise.all([
          log(oatmeal, key),
          log(oatmeal, key),
        ]);
        expect(responses.map((response) => response.status)).toEqual([
          201, 201,
        ]);
        expect(
          responses
            .map((response) => response.headers.get('idempotent-replayed'))
            .sort(),
        ).toEqual(['true', null].sort());
        const [a, b] = (await Promise.all(
          responses.map((response) => response.json()),
        )) as Entry[];
        expect(a).toEqual(b);
        expect(await entriesOn('2026-11-22')).toEqual([a]);
        expect(catalog.calls).toHaveLength(2);
      });

      it('replays a copy, even after its sources are gone', async () => {
        const source = await logEntry('2026-11-22', apple);
        const key = randomUUID();
        const body = { entryIds: [source.id], meal: 'lunch' };
        const first = await post(
          '/v1/days/2026-11-23/entries/copies',
          body,
          key,
        );
        expect(first.status).toBe(201);
        await api(user, 'DELETE', `/v1/entries/${source.id}`);

        const retry = await post(
          '/v1/days/2026-11-23/entries/copies',
          body,
          key,
        );
        expect(retry.status).toBe(201);
        expect(retry.headers.get('idempotent-replayed')).toBe('true');
        expect(await retry.json()).toEqual(await first.json());
        expect(await entriesOn('2026-11-23')).toHaveLength(1);
      });

      it('forgets a key after a day', async () => {
        const key = randomUUID();
        await log(apple, key);
        const age = () =>
          query(
            urls.app,
            `UPDATE idempotency_key SET created_at = now() - interval '25 hours'
             WHERE key = '${key}'`,
          );
        await age();

        const later = await log(apple, key);
        expect(later.status).toBe(201);
        expect(later.headers.get('idempotent-replayed')).toBeNull();
        expect(await entriesOn('2026-11-22')).toHaveLength(2);

        // The hourly cleanup deletes expired keys
        await age();
        expect(
          await app.get(IdempotencyService).deleteExpired(),
        ).toBeGreaterThan(0);
        expect(
          await query(
            urls.app,
            `SELECT 1 FROM idempotency_key WHERE key = '${key}'`,
          ),
        ).toEqual([]);
      });

      it('rejects an invalid key', async () => {
        for (const key of ['a'.repeat(65), 'two words']) {
          const response = await log(apple, key);
          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({
            detail: 'Idempotency-Key must be 1 to 64 visible ASCII characters',
          });
        }
        expect(await entriesOn('2026-11-22')).toEqual([]);
      });
    });
  });
});
