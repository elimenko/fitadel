import { createFoodServiceClient } from '@fitadel/catalog-grpc';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import type { Env } from '../config/env';
import { CATALOG_CHANNEL_OPTIONS, CatalogFoods } from './catalog-foods';

@Module({
  providers: [
    {
      provide: CatalogFoods,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new CatalogFoods(
          createFoodServiceClient(
            config.get('CATALOG_GRPC_URL', { infer: true }),
            // webpack copies the .proto files next to the bundle (webpack.config.js)
            config.get('CATALOG_PROTO_DIR', { infer: true }) ??
              join(__dirname, 'proto'),
            CATALOG_CHANNEL_OPTIONS,
          ),
        ),
    },
  ],
  exports: [CatalogFoods],
})
export class CatalogModule {}
