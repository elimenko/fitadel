import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { rankBarcodeMatches } from './barcode-ranking';
import type { BarcodeLookupDto } from './food.dto';
import { toFood } from './food.mapper';

@Injectable()
export class FoodService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Foods with this barcode (GTIN-14), the best match first. Null when there are none.
   * Until there are user accounts (Phase 2), only public foods are visible.
   */
  async findByBarcode(
    barcode: string,
    languages: string[],
    viewerId: string | null = null,
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
