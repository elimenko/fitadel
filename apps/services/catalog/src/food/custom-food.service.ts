import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isContributor, type Viewer } from '../auth/viewer';
import { Prisma } from '../generated/prisma/client';
import { ProblemException } from '../http/problem-details.filter';
import { PrismaService } from '../prisma/prisma.service';
import { toGtin14 } from './barcode';
import type { Food, FoodInput } from './food.dto';
import { toFood } from './food.mapper';
import { visibleTo } from './visibility';

/**
 * Foods users enter themselves: for barcodes the catalog doesn't know, and as personal
 * corrections ("editing" a food you can't change creates your own copy).
 * Rules from Phase 1, Step 2:
 * - new foods are private (only their owner sees them) unless a contributor makes them
 *   public, for everyone;
 * - only a food's creator may change or retire it; others make their own copy;
 * - one public user food per barcode, and one per user and barcode among private ones.
 *   The database's unique indexes enforce that, also when two requests race.
 */
@Injectable()
export class CustomFoodService {
  constructor(private readonly prisma: PrismaService) {}

  /** Any visible food by id, retired ones included: diary entries refer to them */
  async findById(
    id: string,
    languages: string[],
    viewer: Viewer | null,
  ): Promise<Food | null> {
    const row = await this.prisma.food.findFirst({
      where: { id, ...visibleTo(viewer) },
      include: { servings: true },
    });
    return row ? toFood(row, languages, viewer) : null;
  }

  async create(
    input: FoodInput & { basedOnId: string | null },
    languages: string[],
    viewer: Viewer | null,
  ): Promise<Food> {
    const owner = requireViewer(viewer);
    this.checkVisibility(input.visibility, owner);
    const barcode = normalizeBarcode(input.barcode);
    if (input.basedOnId) {
      const original = await this.prisma.food.findFirst({
        where: { id: input.basedOnId, ...visibleTo(owner) },
        select: { id: true },
      });
      if (!original)
        throw new NotFoundException('No food to copy with this id');
    }

    try {
      const row = await this.prisma.food.create({
        data: {
          source: 'user',
          ownerId: owner.id,
          basedOnId: input.basedOnId,
          ...columns(input, barcode),
          servings: { create: input.servings },
        },
        include: { servings: true },
      });
      return toFood(row, languages, owner);
    } catch (error) {
      throw await this.explainConflict(error, barcode, input.visibility, owner);
    }
  }

  /** Replaces a food in full (PUT): only its creator may */
  async replace(
    id: string,
    input: FoodInput,
    languages: string[],
    viewer: Viewer | null,
  ): Promise<Food> {
    const owner = requireViewer(viewer);
    const existing = await this.findOwn(id, owner);
    if (input.visibility === 'public' && existing.visibility !== 'public') {
      this.checkVisibility('public', owner);
    }
    const barcode = normalizeBarcode(input.barcode);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.foodServing.deleteMany({ where: { foodId: id } });
        return tx.food.update({
          where: { id },
          data: {
            ...columns(input, barcode),
            servings: { create: input.servings },
          },
          include: { servings: true },
        });
      });
      return toFood(row, languages, owner);
    } catch (error) {
      throw await this.explainConflict(error, barcode, input.visibility, owner);
    }
  }

  /** Retires a food (never deletes it: diary entries refer to it); only its creator may */
  async retire(id: string, viewer: Viewer | null): Promise<void> {
    const owner = requireViewer(viewer);
    await this.findOwn(id, owner);
    await this.prisma.food.updateMany({
      where: { id, retiredAt: null },
      data: { retiredAt: new Date() },
    });
  }

  /** 404 when the viewer can't see the food, 403 when they see it but it isn't theirs */
  private async findOwn(id: string, owner: Viewer) {
    const food = await this.prisma.food.findFirst({
      where: { id, ...visibleTo(owner) },
    });
    if (!food) throw new NotFoundException('No food with this id');
    if (food.source !== 'user' || food.ownerId !== owner.id) {
      throw new ForbiddenException(
        'Only its creator can change this food; create your own copy instead (basedOnId)',
      );
    }
    return food;
  }

  private checkVisibility(visibility: 'public' | 'private', viewer: Viewer) {
    if (visibility === 'public' && !isContributor(viewer)) {
      throw new ForbiddenException(
        'Only contributors can add foods for everyone; add it as private instead',
      );
    }
  }

  /**
   * A unique-index violation (P2002) means the barcode is taken. That's checked by the
   * database while writing, not by reading first: two simultaneous requests can't both
   * pass. Answer 409 with the food that holds the barcode.
   */
  private async explainConflict(
    error: unknown,
    barcode: string | null,
    visibility: 'public' | 'private',
    owner: Viewer,
  ): Promise<unknown> {
    const duplicate =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002';
    if (!duplicate || barcode === null) return error;

    const existing = await this.prisma.food.findFirst({
      where:
        visibility === 'public'
          ? { barcode, source: 'user', visibility: 'public' }
          : { barcode, ownerId: owner.id, visibility: 'private' },
      select: { id: true },
    });
    return new ProblemException(
      409,
      visibility === 'public'
        ? 'Someone has already added a public food with this barcode'
        : 'You already have a private food with this barcode',
      { existingFoodId: existing?.id ?? null },
    );
  }
}

function requireViewer(viewer: Viewer | null): Viewer {
  if (!viewer) {
    throw new UnauthorizedException(
      'Sign in to add or change foods (until Phase 2: send X-Dev-User-Id)',
    );
  }
  return viewer;
}

function normalizeBarcode(code: string | null): string | null {
  if (code === null) return null;
  const barcode = toGtin14(code);
  if (!barcode) {
    throw new BadRequestException(
      "The barcode's check digit doesn't match: a digit may be mistyped",
    );
  }
  return barcode;
}

/** The columns a user controls */
function columns(input: FoodInput, barcode: string | null) {
  return {
    barcode,
    names: input.names,
    brand: input.brand,
    basis: input.basis,
    kcal: input.per100.kcal,
    protein: input.per100.protein,
    fat: input.per100.fat,
    carbs: input.per100.carbs,
    sugars: input.per100.sugars,
    fiber: input.per100.fiber,
    saturatedFat: input.per100.saturatedFat,
    salt: input.per100.salt,
    visibility: input.visibility,
  };
}
