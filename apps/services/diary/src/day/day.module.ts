import { Module } from '@nestjs/common';
import { GoalModule } from '../goal/goal.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DayController, EntryController } from './day.controller';
import { EntryService } from './entry.service';

@Module({
  imports: [PrismaModule, GoalModule],
  controllers: [DayController, EntryController],
  providers: [EntryService],
})
export class DayModule {}
