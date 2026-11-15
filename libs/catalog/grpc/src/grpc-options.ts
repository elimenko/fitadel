import { type GrpcOptions, Transport } from '@nestjs/microservices';
import {
  FITADEL_CATALOG_V1_PACKAGE_NAME,
  protobufFileName,
} from './generated/fitadel/catalog/v1/food_service';

/**
 * How the catalog's gRPC server and its clients load the contract. Both sides must
 * read the .proto the same way, or field names and unset values would differ.
 *
 * @param url `host:port`: where the server listens, or where a client connects
 * @param protoDir the folder holding `fitadel/…/*.proto`: in a build, the copy next to
 *   the bundle; in tests, `libs/catalog/grpc/proto`
 */
export function catalogGrpcOptions(url: string, protoDir: string): GrpcOptions {
  return {
    transport: Transport.GRPC,
    options: {
      url,
      package: FITADEL_CATALOG_V1_PACKAGE_NAME,
      protoPath: protobufFileName,
      loader: {
        includeDirs: [protoDir],
        // camelCase field names, as in the generated types (protein_g → proteinG).
        // protobufjs only capitalizes a letter after "_" while ts-proto also drops it
        // before a digit, so no field name may have "_" before a digit
        keepCase: false,
        // Unset fields stay absent instead of reading as 0 or "". `optional` fields
        // (unknown nutrients) keep their presence either way; this covers the rest
        defaults: false,
        // Enums as their numbers, as in the generated NutrientBasis
        enums: Number,
      },
    },
  };
}
