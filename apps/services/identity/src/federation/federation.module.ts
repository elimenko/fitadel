import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PublicUrl } from '../config/public-url';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { FederationService } from './federation.service';
import { GoogleClient } from './google-client';

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: FederationService,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService<Env, true>) => {
        const clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
        const clientSecret = config.get('GOOGLE_CLIENT_SECRET', {
          infer: true,
        });
        const urls = new PublicUrl(config.get('OIDC_ISSUER', { infer: true }));
        return new FederationService(
          prisma,
          clientId && clientSecret
            ? new GoogleClient({
                issuer: config.get('GOOGLE_ISSUER', { infer: true }),
                clientId,
                clientSecret,
                redirectUri: urls.link('interaction/google/callback'),
              })
            : null,
        );
      },
    },
  ],
  exports: [FederationService],
})
export class FederationModule {}
