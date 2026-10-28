/**
 * Text search over the catalog, behind an interface (ADR-0006): the service depends on
 * this, not on PostgreSQL, so a search engine could replace the implementation.
 * Nest uses the abstract class as the injection token.
 */
export abstract class FoodSearch {
  /** Ids of matching visible foods, best first */
  abstract search(query: {
    text: string;
    limit: number;
    offset: number;
  }): Promise<string[]>;
}
