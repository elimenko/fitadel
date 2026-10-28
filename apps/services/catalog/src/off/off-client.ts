import { OFF_API_FIELDS, type OffApiProduct } from './off-api-product';

export interface OffClientOptions {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
}

export type OffFetchResult =
  { found: true; product: OffApiProduct } | { found: false };

/** Reads single products from the Open Food Facts API */
export class OffClient {
  constructor(private readonly options: OffClientOptions) {}

  /**
   * Resolves { found: false } when Open Food Facts doesn't know the barcode. Throws on
   * timeouts, network errors and server errors: those say nothing about the product.
   */
  async fetchProduct(code: string): Promise<OffFetchResult> {
    const url = new URL(
      `/api/v2/product/${encodeURIComponent(code)}.json`,
      this.options.baseUrl,
    );
    url.searchParams.set('fields', OFF_API_FIELDS.join(','));

    const response = await fetch(url, {
      headers: {
        'User-Agent': this.options.userAgent,
        Accept: 'application/json',
      },
      // Cancels the request itself, not just our wait for it
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    // An unknown barcode: v2 answers 404 with { status: 0 }
    if (response.status === 404) return { found: false };
    if (!response.ok) {
      throw new Error(`Open Food Facts answered ${response.status}`);
    }
    const body = (await response.json()) as {
      status?: number;
      product?: OffApiProduct;
    };
    return body.status === 1 && body.product
      ? { found: true, product: body.product }
      : { found: false };
  }
}
