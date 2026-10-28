import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { type CleanFood, cleanOffProduct } from '../import/off-product';
import { fromApiProduct } from '../off/off-api-product';
import { OffClient, type OffFetchResult } from '../off/off-client';
import { PrismaService } from '../prisma/prisma.service';

/** Don't ask Open Food Facts again about a barcode it didn't have for this long */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

export type LiveLookupOutcome =
  /** Found, cleaned and stored: now in the catalog */
  | 'stored'
  /** Open Food Facts doesn't know the barcode */
  | 'not_found'
  /** Open Food Facts has it, but without usable data (e.g. no label energy) */
  | 'rejected'
  /** One of the above, less than a day ago: not asked again */
  | 'recent_miss'
  /** Timeout, network or server error: try again on the next scan */
  | 'unavailable'
  | 'disabled';

/**
 * Looks up barcodes the catalog doesn't have in the Open Food Facts API, which has
 * products its export lacks. Usable products are stored like imported ones, so the
 * next scan (by anyone) is a normal database hit.
 */
@Injectable()
export class OffLookupService {
  private readonly logger = new Logger(OffLookupService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly off: OffClient,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('OFF_LOOKUP', { infer: true }) === 'enabled';
  }

  /** @param code the barcode as scanned; @param barcode the same as GTIN-14 */
  async lookup(code: string, barcode: string): Promise<LiveLookupOutcome> {
    if (!this.enabled) return 'disabled';
    const miss = await this.prisma.offLookupMiss.findUnique({
      where: { barcode },
    });
    if (miss && Date.now() - miss.checkedAt.getTime() < MISS_TTL_MS) {
      return 'recent_miss';
    }

    let result: OffFetchResult;
    try {
      result = await this.off.fetchProduct(code);
    } catch (error) {
      // Says nothing about the product, so it isn't remembered as a miss
      this.logger.warn(
        { err: error, barcode },
        'Open Food Facts lookup failed',
      );
      return 'unavailable';
    }
    if (!result.found) {
      await this.rememberMiss(barcode);
      return 'not_found';
    }

    // The same cleaning rules as the import
    const cleaned = cleanOffProduct(fromApiProduct(result.product));
    if (!cleaned.ok) {
      this.logger.log(
        { barcode, reason: cleaned.reason },
        'Open Food Facts product not usable',
      );
      await this.rememberMiss(barcode);
      return 'rejected';
    }
    await this.store(cleaned.food);
    await this.prisma.offLookupMiss.deleteMany({ where: { barcode } });
    this.logger.log({ barcode }, 'Stored a product from Open Food Facts');
    return 'stored';
  }

  private async rememberMiss(barcode: string) {
    const checkedAt = new Date();
    await this.prisma.offLookupMiss.upsert({
      where: { barcode },
      create: { barcode, checkedAt },
      update: { checkedAt },
    });
  }

  /** Like an imported food, but from_dump stays false: see food.from_dump */
  private async store(food: CleanFood) {
    const data = {
      barcode: food.barcode,
      names: food.names,
      brand: food.brand,
      basis: food.basis,
      kcal: food.kcal,
      protein: food.protein,
      fat: food.fat,
      carbs: food.carbs,
      sugars: food.sugars,
      fiber: food.fiber,
      saturatedFat: food.saturatedFat,
      salt: food.salt,
      extraNutrients: food.extraNutrients ?? Prisma.DbNull,
      popularity: food.popularity,
      countries: food.countries,
      sourceUpdatedAt: food.sourceUpdatedAt,
      retiredAt: null,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.food.upsert({
          where: {
            source_sourceRef: { source: 'off', sourceRef: food.sourceRef },
          },
          create: { source: 'off', sourceRef: food.sourceRef, ...data },
          update: data,
        });
        await tx.foodServing.deleteMany({ where: { foodId: row.id } });
        if (food.serving) {
          await tx.foodServing.create({
            data: { foodId: row.id, ...food.serving },
          });
        }
      });
    } catch (error) {
      // Two scans of the same new barcode at once: the other request stored it
      // (the unique (source, source_ref) constraint decides, not our code)
      const duplicate =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002';
      if (!duplicate) throw error;
    }
  }
}
