import {
  type CallOptions,
  type ChannelOptions,
  type ClientUnaryCall,
  type Metadata,
  type ServiceError,
  credentials,
  loadPackageDefinition,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  FITADEL_CATALOG_V1_PACKAGE_NAME,
  FOOD_SERVICE_NAME,
  type GetFoodRequest,
  type GetFoodResponse,
  protobufFileName,
} from './generated/fitadel/catalog/v1/food_service';
import { catalogGrpcOptions } from './grpc-options';

/** The fully qualified service name, as service configs and logs use it */
export const FOOD_SERVICE_FULL_NAME = `${FITADEL_CATALOG_V1_PACKAGE_NAME}.${FOOD_SERVICE_NAME}`;

/** A plain grpc-js client: per-call deadlines and metadata, callbacks */
export interface FoodServiceGrpcClient {
  getFood(
    request: GetFoodRequest,
    metadata: Metadata,
    options: CallOptions,
    callback: (error: ServiceError | null, response?: GetFoodResponse) => void,
  ): ClientUnaryCall;
  close(): void;
}

type FoodServiceConstructor = new (
  address: string,
  channelCredentials: ReturnType<typeof credentials.createInsecure>,
  options?: ChannelOptions,
) => FoodServiceGrpcClient;

/**
 * A FoodService client that loads the contract the same way the server does. It
 * connects lazily, on the first call.
 *
 * @param url the catalog's `host:port`
 * @param protoDir the folder holding `fitadel/…/*.proto` (see catalogGrpcOptions)
 * @param channelOptions e.g. a service config with a retry policy
 */
export function createFoodServiceClient(
  url: string,
  protoDir: string,
  channelOptions?: ChannelOptions,
): FoodServiceGrpcClient {
  const { loader } = catalogGrpcOptions(url, protoDir).options;
  const loaded = loadPackageDefinition(
    loadSync(protobufFileName, loader),
  ) as unknown as {
    fitadel: { catalog: { v1: { FoodService: FoodServiceConstructor } } };
  };
  return new loaded.fitadel.catalog.v1.FoodService(
    url,
    // Plain text inside the network for now; mTLS is an ADR-0011 follow-up
    credentials.createInsecure(),
    channelOptions,
  );
}
