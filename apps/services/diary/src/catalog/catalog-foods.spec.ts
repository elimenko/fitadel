import {
  catalogGrpcOptions,
  createFoodServiceClient,
  type GetFoodRequest,
  type GetFoodResponse,
  NutrientBasis,
  protobufFileName,
} from '@fitadel/catalog-grpc';
import {
  type GrpcObject,
  type Metadata,
  type ServerUnaryCall,
  type ServiceDefinition,
  Server,
  ServerCredentials,
  loadPackageDefinition,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { CATALOG_CHANNEL_OPTIONS, CatalogFoods } from './catalog-foods';

const PROTO_DIR = join(__dirname, '../../../../../libs/catalog/grpc/proto');
const FOOD_ID = '0192f8a4-6a3e-7c00-8f00-000000000001';
const AS_BOB = { authorization: 'Bearer bobs-token', languages: ['en', 'pl'] };

type Answer = (
  call: ServerUnaryCall<GetFoodRequest, GetFoodResponse>,
) => Promise<GetFoodResponse | { code: status; details: string }>;

const kefirFood = {
  id: FOOD_ID,
  name: 'Kefir',
  brand: 'Piątnica',
  basis: NutrientBasis.NUTRIENT_BASIS_ML,
  // Protein unset (unknown); fiber a known 0
  per100: { kcal: 51, fatG: 2, carbsG: 4.7, fiberG: 0 },
};
const kefir: GetFoodResponse = { food: kefirFood };
const fail =
  (code: status) => async (): Promise<{ code: status; details: string }> => ({
    code,
    details: status[code],
  });

/** A stand-in catalog: a real gRPC server on a random port, answering as told */
describe('CatalogFoods', () => {
  let server: Server;
  let address: string;
  let answer: Answer;
  let calls: ServerUnaryCall<GetFoodRequest, GetFoodResponse>[];
  let foods: CatalogFoods;

  beforeAll(async () => {
    const { loader } = catalogGrpcOptions('', PROTO_DIR).options;
    const loaded = loadPackageDefinition(loadSync(protobufFileName, loader));
    const v1 = ((loaded.fitadel as GrpcObject).catalog as GrpcObject)
      .v1 as GrpcObject;
    const service = (v1.FoodService as { service: ServiceDefinition }).service;

    server = new Server();
    server.addService(service, {
      getFood: (
        call: ServerUnaryCall<GetFoodRequest, GetFoodResponse>,
        callback: (
          error: { code: status; details: string } | null,
          response?: GetFoodResponse,
        ) => void,
      ) => {
        calls.push(call);
        answer(call).then((result) =>
          'code' in result ? callback(result) : callback(null, result),
        );
      },
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (error, bound) => (error ? reject(error) : resolve(bound)),
      ),
    );
    address = `127.0.0.1:${port}`;
  });

  beforeEach(() => {
    calls = [];
    foods = new CatalogFoods(
      createFoodServiceClient(address, PROTO_DIR, CATALOG_CHANNEL_OPTIONS),
    );
  });

  afterEach(() => foods.onModuleDestroy());

  afterAll(() => server.forceShutdown());

  it('copies a food, with unknown values as null', async () => {
    answer = async () => kefir;
    expect(await foods.get(FOOD_ID, AS_BOB)).toEqual({
      id: FOOD_ID,
      name: 'Kefir',
      brand: 'Piątnica',
      basis: 'ml',
      per100: { kcal: 51, proteinG: null, fatG: 2, carbsG: 4.7, fiberG: 0 },
    });
  });

  it("calls on the user's behalf: their token and languages, and a deadline", async () => {
    answer = async () => kefir;
    await foods.get(FOOD_ID, AS_BOB);

    const [call] = calls;
    expect(call.request).toEqual({ id: FOOD_ID, languages: ['en', 'pl'] });
    expect((call.metadata as Metadata).get('authorization')).toEqual([
      'Bearer bobs-token',
    ]);
    // The deadline travels with the call
    // (a Date or epoch ms; Infinity would mean "no deadline")
    const deadline = call.getDeadline();
    const at = deadline instanceof Date ? deadline.getTime() : deadline;
    expect(at - Date.now()).toBeGreaterThan(0);
    expect(at - Date.now()).toBeLessThanOrEqual(1000);
  });

  it('answers null when the catalog has no such food for the user', async () => {
    answer = fail(status.NOT_FOUND);
    expect(await foods.get(FOOD_ID, AS_BOB)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('retries once when the catalog is unavailable', async () => {
    let attempt = 0;
    answer = async () => (++attempt === 1 ? fail(status.UNAVAILABLE)() : kefir);
    expect((await foods.get(FOOD_ID, AS_BOB))?.name).toBe('Kefir');
    expect(calls).toHaveLength(2);
  });

  it('answers 503 when the catalog stays unavailable', async () => {
    answer = fail(status.UNAVAILABLE);
    await expect(foods.get(FOOD_ID, AS_BOB)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(calls).toHaveLength(2);
  });

  it('answers 503 when nothing listens at the address', async () => {
    const down = new CatalogFoods(
      createFoodServiceClient(
        `127.0.0.1:${await freePort()}`,
        PROTO_DIR,
        CATALOG_CHANNEL_OPTIONS,
      ),
    );
    await expect(down.get(FOOD_ID, AS_BOB)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    down.onModuleDestroy();
  });

  it('gives up after the deadline with 504', async () => {
    // The catalog answers too late. It also knows the deadline (grpc-timeout) and ends
    // the call itself when it passes, so its late answer goes nowhere.
    answer = () =>
      new Promise((resolve) => setTimeout(() => resolve(kefir), 1500));
    const started = Date.now();
    await expect(foods.get(FOOD_ID, AS_BOB)).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(900);
    expect(waited).toBeLessThan(1300);
  });

  it.each([status.INTERNAL, status.UNAUTHENTICATED, status.INVALID_ARGUMENT])(
    'answers 502 without retrying for other failures (%s)',
    async (code) => {
      answer = fail(code);
      await expect(foods.get(FOOD_ID, AS_BOB)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(calls).toHaveLength(1);
    },
  );

  it('refuses a food without a basis it knows, rather than guessing grams', async () => {
    for (const basis of [
      NutrientBasis.NUTRIENT_BASIS_UNSPECIFIED,
      // A basis added in a newer catalog arrives as its number
      7 as NutrientBasis,
    ]) {
      answer = async () => ({ food: { ...kefirFood, basis } });
      await expect(foods.get(FOOD_ID, AS_BOB)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    }
  });
});

/** A port that is free right now (the OS picks it) */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
