import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FoodSearch } from './food-search';

/**
 * Trigram and prefix full-text search on the expression indexes over
 * food_search_text(names, brand) (see the migrations). Both matchers are combined:
 * trigrams tolerate typos ("mlekko"), prefixes find partly typed words ("serek wiej").
 */
@Injectable()
export class PostgresFoodSearch extends FoodSearch {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async search({
    text,
    limit,
    offset,
  }: {
    text: string;
    limit: number;
    offset: number;
  }): Promise<string[]> {
    // $queryRaw sends every ${...} as a bound parameter, never as SQL text.
    // The expressions must match the index definitions exactly, or the planner won't
    // use the indexes.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH q AS (
        SELECT f_norm(${text}) AS norm,
               -- 'serek wiej' -> 'serek':* & 'wiej':*
               to_tsquery('simple', array_to_string(array(
                 SELECT quote_literal(word) || ':*'
                 FROM regexp_split_to_table(f_norm(${text}), '[^[:alnum:]]+') AS word
                 WHERE word <> ''
               ), ' & ')) AS prefix
      )
      SELECT food.id
      FROM food, q
      WHERE food.retired_at IS NULL
        AND food.visibility = 'public'
        AND (q.norm <% food_search_text(food.names, food.brand)
             OR to_tsvector('simple', food_search_text(food.names, food.brand)) @@ q.prefix)
      ORDER BY ('poland' = ANY(food.countries)) DESC,
               word_similarity(q.norm, food_search_text(food.names, food.brand)) DESC,
               food.popularity DESC,
               -- A deterministic last key, so pages don't overlap or skip rows
               food.id
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((row) => row.id);
  }
}
