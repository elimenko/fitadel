import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GoalController } from './goal.controller';
import { GoalService } from './goal.service';

@Module({
  imports: [PrismaModule],
  controllers: [GoalController],
  providers: [GoalService],
})
export class GoalModule {}
