import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

/**
 * Reads the Open Food Facts JSONL dump (gzip) line by line. The file is about 50 GB
 * uncompressed, so it's streamed, never loaded into memory.
 */
export function readDumpLines(file: string): AsyncIterable<string> {
  const input = createReadStream(file);
  return createInterface({
    input: file.endsWith('.gz') ? input.pipe(createGunzip()) : input,
    crlfDelay: Infinity,
  });
}

// Every "code" value in a line. Nested objects have "code" keys too, so the first match
// isn't necessarily the product's barcode (about 7% of lines).
const CODE_VALUES = /"code":"([^"]*)"/g;

/**
 * Cheap pre-filter before JSON.parse. We import every product with nutrition data, so a
 * line is worth parsing when it has a nutrition block, or when it's a product already in
 * the catalog (to notice that it changed or lost its data). A superset: cleaning decides.
 */
export function shouldParse(line: string, known: ReadonlySet<string>): boolean {
  if (line.includes('"aggregated_set"')) return true;
  for (const [, code] of line.matchAll(CODE_VALUES)) {
    if (known.has(code)) return true;
  }
  return false;
}
