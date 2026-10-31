import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountService } from './account.service';
import { PasswordHasher } from './password-hasher';

@Module({
  imports: [PrismaModule],
  providers: [AccountService, PasswordHasher],
  exports: [AccountService],
})
export class AccountModule {}
