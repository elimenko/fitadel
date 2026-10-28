import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { rankBarcodeMatches } from './barcode-ranking';
import { FoodSearch } from './food-search';
import type { BarcodeLookupDto, SearchResultDto } from './food.dto';
import { toFood } from './food.mapper';
import { OffLookupService } from './off-lookup.service';

@Injectable()
export class FoodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly offLookup: OffLookupService,
    private readonly foodSearch: FoodSearch,
  ) {}

  /** A page of foods matching the text, best first */
  async search(
    text: string,
    languages: string[],
    limit: number,
    offset: number,
  ): Promise<SearchResultDto> {
    // One extra row tells whether there's a next page, without counting all matches
    const ids = await this.foodSearch.search({
      text,
      limit: limit + 1,
      offset,
    });
    const page = ids.slice(0, limit);
    const rows = await this.prisma.food.findMany({
      where: { id: { in: page } },
      include: { servings: true },
    });
    // findMany doesn't keep the search order
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: page.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toFood(row, languages)] : [];
      }),
      nextOffset: ids.length > limit ? offset + limit : null,
    };
  }

  /**
   * Foods with this barcode, the best match first. A barcode the catalog doesn't have
   * is looked up live in Open Food Facts. Null when neither has it.
   * Until there are user accounts (Phase 2), only public foods are visible.
   *
   * @param code the barcode as scanned; @param barcode the same as GTIN-14
   */
  async findByBarcode(
    code: string,
    barcode: string,
    languages: string[],
    viewerId: string | null = null,
  ): Promise<BarcodeLookupDto | null> {
    const local = await this.findStored(barcode, languages, viewerId);
    if (local) return local;
    const outcome = await this.offLookup.lookup(code, barcode);
    return outcome === 'stored'
      ? this.findStored(barcode, languages, viewerId)
      : null;
  }

  private async findStored(
    barcode: string,
    languages: string[],
    viewerId: string | null,
  ): Promise<BarcodeLookupDto | null> {
    // A barcode matches only a handful of rows: fetch them all, rank in code
    const rows = await this.prisma.food.findMany({
      where: {
        barcode,
        retiredAt: null,
        OR: [
          { visibility: 'public' },
          ...(viewerId ? [{ ownerId: viewerId }] : []),
        ],
      },
      include: { servings: true },
    });
    const [best, ...alternatives] = rankBarcodeMatches(rows, viewerId).map(
      (row) => toFood(row, languages),
    );
    return best ? { food: best, alternatives } : null;
  }
}
