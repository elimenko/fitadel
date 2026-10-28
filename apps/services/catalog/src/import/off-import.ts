import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Pool, PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { readDumpLines, shouldParse } from './off-dump';
import {
  cleanOffProduct,
  type CleanFood,
  type OffProduct,
  type RejectReason,
  type Warning,
} from './off-product';

export interface ImportReport {
  /** Lines in the dump */
  read: number;
  /** Parsed: products with nutrition data, plus those already in the catalog */
  parsed: number;
  /** Cleaned and staged */
  staged: number;
  rejected: Partial<Record<RejectReason | 'duplicate_code', number>>;
  warnings: Partial<Record<Warning, number>>;
  inserted: number;
  updated: number;
  unchanged: number;
  retired: number;
}

export interface ImportOptions {
  /** Called every 250,000 dump lines */
  onProgress?: (read: number) => void;
  /** Abort instead of retiring more than this share of the active catalog */
  maxRetiredShare?: number;
}

const tracer = trace.getTracer('catalog-import');

/**
 * Imports an Open Food Facts JSONL dump: stream and clean the products into the
 * food_import staging table with COPY, then merge them into food in one transaction.
 * Idempotent: running it twice with the same dump changes nothing the second time.
 */
export async function importOffDump(
  pool: Pool,
  file: string,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const client = await pool.connect();
  try {
    // Session-level lock: a second import waits for nothing and fails fast instead.
    // Postgres releases it automatically if this connection dies.
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('catalog:off-import')) AS locked",
    );
    if (!rows[0].locked) throw new Error('Another import is running');
    try {
      return await runImport(client, file, options);
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('catalog:off-import'))",
      );
    }
  } finally {
    client.release();
  }
}

async function runImport(
  client: PoolClient,
  file: string,
  { onProgress = () => undefined, maxRetiredShare = 0.1 }: ImportOptions,
): Promise<ImportReport> {
  const known = await knownProducts(client);
  const report: ImportReport = {
    read: 0,
    parsed: 0,
    staged: 0,
    rejected: {},
    warnings: {},
    inserted: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
  };
  // Known products found in the dump; the active ones missing from it get retired
  const seen = new Set<string>();

  await inSpan('stage', async (span) => {
    // Leftovers of a run that failed before its merge
    await client.query('TRUNCATE food_import');
    const staged = new Set<string>();

    async function* csvRows() {
      for await (const line of readDumpLines(file)) {
        if (++report.read % 250_000 === 0) onProgress(report.read);
        if (!shouldParse(line, known.all)) continue;
        const product = JSON.parse(line) as OffProduct;
        report.parsed++;
        const code = String(product.code);
        if (known.all.has(code)) seen.add(code);

        const result = cleanOffProduct(product);
        if (!result.ok) {
          count(report.rejected, result.reason);
          continue;
        }
        if (staged.has(result.food.sourceRef)) {
          count(report.rejected, 'duplicate_code');
          continue;
        }
        staged.add(result.food.sourceRef);
        for (const warning of new Set(result.warnings)) {
          count(report.warnings, warning);
        }
        yield toCsvRow(result.food);
      }
    }

    await pipeline(
      Readable.from(csvRows()),
      client.query(
        copyFrom(
          `COPY food_import (${STAGING_COLUMNS}) FROM STDIN (FORMAT csv)`,
        ),
      ),
    );
    report.staged = staged.size;
    span.setAttributes({ read: report.read, staged: report.staged });
  });

  const retire = [...known.active].filter((code) => !seen.has(code));
  if (
    known.active.size > 0 &&
    retire.length > known.active.size * maxRetiredShare
  ) {
    // A truncated or broken dump must never wipe the catalog
    throw new Error(
      `Refusing to retire ${retire.length} of ${known.active.size} active products; ` +
        'is the dump complete?',
    );
  }

  await inSpan('merge', async (span) => {
    await client.query('BEGIN');
    try {
      await merge(client, retire, report);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    report.unchanged = report.staged - report.inserted - report.updated;
    span.setAttributes({
      inserted: report.inserted,
      updated: report.updated,
      retired: report.retired,
    });
  });

  // TRUNCATE frees the space at once (about 1 GB for a full dump); DELETE would only
  // mark the rows dead until a vacuum
  await client.query('TRUNCATE food_import');
  return report;
}

async function knownProducts(client: PoolClient) {
  const { rows } = await client.query<{ source_ref: string; active: boolean }>(
    "SELECT source_ref, retired_at IS NULL AS active FROM food WHERE source = 'off'",
  );
  return {
    all: new Set(rows.map((row) => row.source_ref)),
    active: new Set(
      rows.filter((row) => row.active).map((row) => row.source_ref),
    ),
  };
}

/** Within one transaction: readers see the old catalog or the new one, never a mix */
async function merge(
  client: PoolClient,
  retire: string[],
  report: ImportReport,
) {
  // New and changed products. Unchanged ones are skipped by the WHERE clause.
  // xmax = 0 marks a freshly inserted row (an updated row carries the updating xid).
  const upserted = await client.query<{ id: string; inserted: boolean }>(`
    INSERT INTO food (
      source, source_ref, barcode, names, brand, basis, kcal, protein, fat, carbs,
      sugars, fiber, saturated_fat, salt, extra_nutrients, popularity, countries,
      source_updated_at, updated_at
    )
    SELECT 'off', source_ref, barcode, names, brand, basis, kcal, protein, fat, carbs,
      sugars, fiber, saturated_fat, salt, extra_nutrients, popularity, countries,
      source_updated_at, now()
    FROM food_import
    ON CONFLICT (source, source_ref) DO UPDATE SET
      barcode = excluded.barcode, names = excluded.names, brand = excluded.brand,
      basis = excluded.basis, kcal = excluded.kcal, protein = excluded.protein,
      fat = excluded.fat, carbs = excluded.carbs, sugars = excluded.sugars,
      fiber = excluded.fiber, saturated_fat = excluded.saturated_fat,
      salt = excluded.salt, extra_nutrients = excluded.extra_nutrients,
      popularity = excluded.popularity, countries = excluded.countries,
      source_updated_at = excluded.source_updated_at,
      retired_at = NULL, updated_at = now()
    WHERE food.source_updated_at IS DISTINCT FROM excluded.source_updated_at
       OR food.popularity IS DISTINCT FROM excluded.popularity
       OR food.retired_at IS NOT NULL
    RETURNING id, (xmax = 0) AS inserted
  `);
  report.inserted = upserted.rows.filter((row) => row.inserted).length;
  report.updated = upserted.rows.length - report.inserted;

  // Servings of the new and changed products are replaced as a whole
  const ids = upserted.rows.map((row) => row.id);
  await client.query(
    'DELETE FROM food_serving WHERE food_id = ANY($1::uuid[])',
    [ids],
  );
  await client.query(
    `INSERT INTO food_serving (food_id, label, amount)
     SELECT food.id, food_import.serving_label, food_import.serving_amount
     FROM food JOIN food_import ON food.source = 'off' AND food.source_ref = food_import.source_ref
     WHERE food.id = ANY($1::uuid[]) AND food_import.serving_label IS NOT NULL`,
    [ids],
  );

  // Gone from Open Food Facts: retired, never deleted (diary entries refer to them)
  const retired = await client.query(
    `UPDATE food SET retired_at = now(), updated_at = now()
     WHERE source = 'off' AND retired_at IS NULL AND source_ref = ANY($1::text[])`,
    [retire],
  );
  report.retired = retired.rowCount ?? 0;
}

const STAGING_COLUMNS = [
  'source_ref',
  'barcode',
  'names',
  'brand',
  'basis',
  'kcal',
  'protein',
  'fat',
  'carbs',
  'sugars',
  'fiber',
  'saturated_fat',
  'salt',
  'extra_nutrients',
  'popularity',
  'countries',
  'source_updated_at',
  'serving_label',
  'serving_amount',
].join(', ');

/** One CSV line in STAGING_COLUMNS order. An unquoted empty field is NULL. */
export function toCsvRow(food: CleanFood): string {
  return (
    [
      food.sourceRef,
      food.barcode,
      JSON.stringify(food.names),
      food.brand,
      food.basis,
      food.kcal,
      food.protein,
      food.fat,
      food.carbs,
      food.sugars,
      food.fiber,
      food.saturatedFat,
      food.salt,
      food.extraNutrients && JSON.stringify(food.extraNutrients),
      food.popularity,
      pgArray(food.countries),
      food.sourceUpdatedAt?.toISOString() ?? null,
      food.serving?.label ?? null,
      food.serving?.amount ?? null,
    ]
      .map(csvField)
      .join(',') + '\n'
  );
}

/** A Postgres array literal, e.g. {"poland","ireland"} */
export function pgArray(values: string[]): string {
  const items = values.map((value) => `"${value.replace(/[\\"]/g, '\\$&')}"`);
  return `{${items.join(',')}}`;
}

function csvField(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  return `"${value.replace(/"/g, '""')}"`;
}

function count<K extends string>(counts: Partial<Record<K, number>>, key: K) {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Runs fn in a child span that is always ended, and marked as failed on errors */
function inSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
