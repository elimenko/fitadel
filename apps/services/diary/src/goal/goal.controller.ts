import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiProblem } from '@fitadel/shared-http';
import { SignedInViewer, type Viewer } from '../auth/viewer';
import {
  EffectiveGoalQueryDto,
  GoalDateParamsDto,
  GoalDto,
  GoalListDto,
  GoalSettingsDto,
} from './goal.dto';
import { GoalService } from './goal.service';

const NO_TOKEN = 'No access token, or an invalid or expired one';

@ApiTags('goals')
@ApiBearerAuth()
@ApiProblem(401, NO_TOKEN)
@Controller({ path: 'goals', version: '1' })
export class GoalController {
  constructor(private readonly goals: GoalService) {}

  @Get()
  @ZodResponse({ status: 200, type: GoalListDto })
  async list(@SignedInViewer() viewer: Viewer) {
    return { items: await this.goals.list(viewer.id) };
  }

  // Declared before ':effectiveFrom', which would otherwise match "effective"
  @Get('effective')
  @ZodResponse({
    status: 200,
    type: GoalDto,
    description: 'The latest goal that started on or before the date',
  })
  @ApiProblem(400, 'Not a valid date')
  @ApiProblem(404, 'No goal in effect on that date')
  async effective(
    @Query() { date }: EffectiveGoalQueryDto,
    @SignedInViewer() viewer: Viewer,
  ) {
    const goal = await this.goals.effectiveOn(viewer.id, date);
    if (!goal) throw new NotFoundException('No goal in effect on this date');
    return goal;
  }

  @Get(':effectiveFrom')
  @ZodResponse({ status: 200, type: GoalDto })
  @ApiProblem(400, 'Not a valid date')
  @ApiProblem(404, 'No goal starts on that date')
  async get(
    @Param() { effectiveFrom }: GoalDateParamsDto,
    @SignedInViewer() viewer: Viewer,
  ) {
    const goal = await this.goals.get(viewer.id, effectiveFrom);
    if (!goal) throw new NotFoundException('No goal starts on this date');
    return goal;
  }

  @Put(':effectiveFrom')
  @ZodResponse({
    status: 200,
    type: GoalDto,
    description:
      'Created or replaced; sending the same request again is harmless',
  })
  @ApiProblem(400, 'Invalid fields or date')
  @ApiProblem(
    422,
    'The settings leave no budget, or protein and fat need more than the budget',
  )
  async put(
    @Param() { effectiveFrom }: GoalDateParamsDto,
    @Body() settings: GoalSettingsDto,
    @SignedInViewer() viewer: Viewer,
  ) {
    return this.goals.put(viewer.id, effectiveFrom, settings);
  }

  @Delete(':effectiveFrom')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'Deleted; the previous goal now applies from that date',
  })
  @ApiProblem(400, 'Not a valid date')
  @ApiProblem(404, 'No goal starts on that date')
  async delete(
    @Param() { effectiveFrom }: GoalDateParamsDto,
    @SignedInViewer() viewer: Viewer,
  ): Promise<void> {
    if (!(await this.goals.delete(viewer.id, effectiveFrom))) {
      throw new NotFoundException('No goal starts on this date');
    }
  }
}
