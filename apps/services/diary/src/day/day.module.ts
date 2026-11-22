import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { GoalModule } from '../goal/goal.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DayController, EntryController } from './day.controller';
import { EntryService } from './entry.service';

@Module({
  imports: [PrismaModule, GoalModule, CatalogModule, IdempotencyModule],
  controllers: [DayController, EntryController],
  providers: [EntryService],
})
export class DayModule {}
