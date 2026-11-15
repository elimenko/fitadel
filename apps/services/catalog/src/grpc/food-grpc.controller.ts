import {
  type FoodServiceController,
  FoodServiceControllerMethods,
  type GetFoodRequest,
  type GetFoodResponse,
} from '@fitadel/catalog-grpc';
import {
  AccessTokenVerifier,
  InvalidAccessToken,
  type Viewer,
} from '@fitadel/shared-auth';
import { type Metadata, status } from '@grpc/grpc-js';
import { Controller, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { z } from 'zod';
import { CustomFoodService } from '../food/custom-food.service';
import { toGrpcFood } from './food-grpc.mapper';

const FoodId = z.uuid();

/**
 * FoodService over gRPC, for other services (ADR-0011). The same rules as the REST API:
 * the token is optional, and without one only public foods are found.
 *
 * Nest's global guard, pipes and filters apply to HTTP only, so this controller
 * checks the token itself and answers with gRPC status codes.
 */
@Controller()
@FoodServiceControllerMethods()
export class FoodGrpcController implements FoodServiceController {
  private readonly logger = new Logger(FoodGrpcController.name);

  constructor(
    private readonly foods: CustomFoodService,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async getFood(
    request: GetFoodRequest,
    metadata?: Metadata,
  ): Promise<GetFoodResponse> {
    const viewer = await this.viewerOf(metadata);
    if (!FoodId.safeParse(request.id).success) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'The food id must be a UUID',
      });
    }
    const languages = (request.languages ?? []).map(
      (language) => language.trim().toLowerCase().split('-')[0],
    );
    const food = await this.foods.findById(request.id, languages, viewer);
    if (!food) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: "No such food, or it's someone else's private food",
      });
    }
    return { food: toGrpcFood(food) };
  }

  /** The user from the `authorization` metadata, or null without one */
  private async viewerOf(metadata?: Metadata): Promise<Viewer | null> {
    const [header] = metadata?.get('authorization') ?? [];
    if (header === undefined) return null;
    const token = /^Bearer ([\w.~+/-]+=*)$/i.exec(String(header))?.[1];
    if (!token) throw this.unauthenticated('not a Bearer header');
    try {
      return await this.verifier.verify(token);
    } catch (error) {
      // A broken token is never "anonymous", as in the REST API
      if (error instanceof InvalidAccessToken) {
        throw this.unauthenticated(error.detail, error.reason);
      }
      // Identity's keys are unreachable: not the caller's fault, and it may pass
      this.logger.error({ err: error }, 'Access tokens cannot be verified');
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Sign-in is unavailable right now; try again shortly',
      });
    }
  }

  private unauthenticated(
    detail: string,
    reason: InvalidAccessToken['reason'] = 'invalid',
  ): RpcException {
    // The reason for the logs; the token itself never
    this.logger.warn({ reason, detail }, 'Access token refused');
    return new RpcException({
      code: status.UNAUTHENTICATED,
      message:
        reason === 'expired'
          ? 'The access token expired'
          : 'Invalid access token',
    });
  }
}
