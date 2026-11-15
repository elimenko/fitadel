import {
  FOOD_SERVICE_FULL_NAME,
  type Food as GrpcFood,
  type FoodServiceGrpcClient,
  type GetFoodResponse,
  NutrientBasis,
} from '@fitadel/catalog-grpc';
import {
  type ChannelOptions,
  Metadata,
  type ServiceError,
  status,
} from '@grpc/grpc-js';
import {
  BadGatewayException,
  GatewayTimeoutException,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';

/** A food as the diary copies it into an entry; null = unknown, as in the catalog */
export interface CatalogFood {
  id: string;
  name: string;
  brand: string | null;
  basis: 'g' | 'ml';
  per100: {
    kcal: number;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    fiberG: number | null;
  };
}

/** The user the call is made for: the catalog applies their visibility rules */
export interface OnBehalfOf {
  /** The request's `Authorization` header, forwarded as is */
  authorization: string;
  /** Preferred languages, best first, for the food's name */
  languages: string[];
}

/** Bases the diary knows; UNSPECIFIED and UNRECOGNIZED (from a newer catalog) are not */
const BASIS: Partial<Record<NutrientBasis, CatalogFood['basis']>> = {
  [NutrientBasis.NUTRIENT_BASIS_G]: 'g',
  [NutrientBasis.NUTRIENT_BASIS_ML]: 'ml',
};

/** How long a user waits for the catalog, retry included (ADR-0011) */
export const CATALOG_DEADLINE_MS = 1000;

/**
 * Retry once when the catalog is unavailable (it may be restarting, or one instance is
 * down). grpc-js retries within the call's deadline, so a retry never makes the user
 * wait longer. Only UNAVAILABLE: other failures would fail again the same way.
 */
export const CATALOG_CHANNEL_OPTIONS: ChannelOptions = {
  'grpc.service_config': JSON.stringify({
    methodConfig: [
      {
        name: [{ service: FOOD_SERVICE_FULL_NAME }],
        retryPolicy: {
          maxAttempts: 2,
          initialBackoff: '0.05s',
          maxBackoff: '0.2s',
          backoffMultiplier: 2,
          retryableStatusCodes: ['UNAVAILABLE'],
        },
      },
    ],
  }),
};

/**
 * Reads foods from the catalog over gRPC (ADR-0011). Its failures become the diary's
 * HTTP errors, so a client can tell "catalog down" (503) from "catalog slow" (504) and
 * from "catalog broken" (502). A missing food is not a failure: `get` returns null.
 */
export class CatalogFoods implements OnModuleDestroy {
  private readonly logger = new Logger(CatalogFoods.name);

  constructor(
    private readonly client: FoodServiceGrpcClient,
    private readonly deadlineMs = CATALOG_DEADLINE_MS,
  ) {}

  /** The food, or null if there's none the user may see */
  async get(id: string, user: OnBehalfOf): Promise<CatalogFood | null> {
    let response: GetFoodResponse;
    try {
      response = await this.call(id, user);
    } catch (error) {
      if ((error as ServiceError).code === status.NOT_FOUND) return null;
      throw this.failure(error as ServiceError);
    }
    return this.toCatalogFood(response.food);
  }

  onModuleDestroy() {
    this.client.close();
  }

  private call(id: string, user: OnBehalfOf): Promise<GetFoodResponse> {
    const metadata = new Metadata();
    metadata.set('authorization', user.authorization);
    return new Promise((resolve, reject) =>
      this.client.getFood(
        { id, languages: user.languages },
        metadata,
        // One deadline for the whole call: grpc-js sends it along (grpc-timeout), so
        // the catalog stops working on it when the user stops waiting
        { deadline: Date.now() + this.deadlineMs },
        (error, response) =>
          error || !response ? reject(error) : resolve(response),
      ),
    );
  }

  private failure(error: ServiceError) {
    switch (error.code) {
      case status.UNAVAILABLE:
        this.logger.warn({ err: error }, 'The catalog is unavailable');
        return new ServiceUnavailableException(
          'The food catalog is unavailable; try again shortly',
        );
      case status.DEADLINE_EXCEEDED:
        this.logger.warn({ err: error }, "The catalog didn't answer in time");
        return new GatewayTimeoutException(
          "The food catalog didn't answer in time; try again",
        );
      default:
        // INTERNAL, UNAUTHENTICATED (the diary already checked the token, so this is
        // a configuration mismatch), INVALID_ARGUMENT (a diary bug), …
        this.logger.error(
          { err: error, code: status[error.code] },
          'The catalog call failed',
        );
        return this.broken();
    }
  }

  /**
   * Back into the diary's terms. Unset optional values are unknown (null). Unset
   * plain fields read as their proto3 default (0, ""), as every gRPC runtime does.
   */
  private toCatalogFood(food: GrpcFood | undefined): CatalogFood {
    const basis = food && BASIS[food.basis];
    if (!food?.per100 || !basis) {
      // Unspecified or a basis newer than this diary: guessing grams could turn
      // millilitres into wrong numbers, so refuse instead
      this.logger.error(
        { foodId: food?.id, basis: food?.basis, hasValues: !!food?.per100 },
        'The catalog sent a food the diary cannot read',
      );
      throw this.broken();
    }
    const { kcal, proteinG, fatG, carbsG, fiberG } = food.per100;
    return {
      id: food.id,
      name: food.name ?? '',
      brand: food.brand ?? null,
      basis,
      per100: {
        kcal: kcal ?? 0,
        proteinG: proteinG ?? null,
        fatG: fatG ?? null,
        carbsG: carbsG ?? null,
        fiberG: fiberG ?? null,
      },
    };
  }

  private broken() {
    return new BadGatewayException('The food catalog failed; try again later');
  }
}
