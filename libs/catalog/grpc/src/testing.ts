/**
 * A stand-in catalog for other services' tests: a real gRPC server on a random port,
 * serving foods the test adds, or failing as the test says.
 */
import {
  type GrpcObject,
  type ServerUnaryCall,
  type ServiceDefinition,
  Server,
  ServerCredentials,
  loadPackageDefinition,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';
import {
  type Food,
  type GetFoodRequest,
  type GetFoodResponse,
  protobufFileName,
} from './generated/fitadel/catalog/v1/food_service';
import { catalogGrpcOptions } from './grpc-options';

/** The contract's .proto files in this library's source, for tests */
export const PROTO_DIR = join(__dirname, '../proto');

/** A gRPC failure to answer with */
export interface GrpcFailure {
  code: status;
  details: string;
}

export type FakeAnswer = (
  call: ServerUnaryCall<GetFoodRequest, GetFoodResponse>,
) => Promise<GetFoodResponse | GrpcFailure>;

export class FakeCatalog {
  /** Foods by id; GetFood answers NOT_FOUND for any other id */
  readonly foods = new Map<string, Food>();
  /** Every GetFood call, oldest first */
  readonly calls: ServerUnaryCall<GetFoodRequest, GetFoodResponse>[] = [];
  /** How GetFood answers; by default from `foods` */
  answer: FakeAnswer = async (call) => this.lookup(call.request.id);

  private constructor(
    private readonly server: Server,
    /** `host:port` to connect to */
    readonly url: string,
  ) {}

  static async start(): Promise<FakeCatalog> {
    const { loader } = catalogGrpcOptions('', PROTO_DIR).options;
    const loaded = loadPackageDefinition(loadSync(protobufFileName, loader));
    const v1 = ((loaded.fitadel as GrpcObject).catalog as GrpcObject)
      .v1 as GrpcObject;
    const service = (v1.FoodService as { service: ServiceDefinition }).service;

    const server = new Server();
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (error, bound) => (error ? reject(error) : resolve(bound)),
      ),
    );
    const fake = new FakeCatalog(server, `127.0.0.1:${port}`);
    server.addService(service, {
      getFood: (
        call: ServerUnaryCall<GetFoodRequest, GetFoodResponse>,
        callback: (
          error: GrpcFailure | null,
          response?: GetFoodResponse,
        ) => void,
      ) => {
        fake.calls.push(call);
        fake
          .answer(call)
          .then((result) =>
            'code' in result ? callback(result) : callback(null, result),
          );
      },
    });
    return fake;
  }

  /** Answer every call with this failure */
  failWith(code: status) {
    this.answer = async () => ({ code, details: status[code] });
  }

  /** Back to answering from `foods`, and forget earlier calls */
  reset() {
    this.answer = async (call) => this.lookup(call.request.id);
    this.calls.length = 0;
  }

  async stop() {
    this.server.forceShutdown();
  }

  private lookup(id: string): GetFoodResponse | GrpcFailure {
    const food = this.foods.get(id);
    return food
      ? { food }
      : { code: status.NOT_FOUND, details: 'No such food' };
  }
}
