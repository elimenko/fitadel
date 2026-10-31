import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { OidcModule } from '../oidc/oidc.module';
import { InteractionController } from './interaction.controller';

@Module({
  imports: [AccountModule, OidcModule],
  controllers: [InteractionController],
})
export class InteractionModule {}
