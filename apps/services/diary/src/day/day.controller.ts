import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ApiProblem, preferredLanguages } from '@fitadel/shared-http';
import type { OnBehalfOf } from '../catalog/catalog-foods';
import { SignedInViewer, type Viewer } from '../auth/viewer';
import {
  CreateEntryDto,
  DayDto,
  DayParamsDto,
  EntryDto,
  EntryIdParamsDto,
  ReplaceEntryDto,
} from './day.dto';
import { EntryService } from './entry.service';

const NO_TOKEN = 'No access token, or an invalid or expired one';

/** Food entries copy a food from the catalog: the errors of that call (ADR-0011) */
const ApiCatalogProblems = () =>
  applyDecorators(
    ApiProblem(
      422,
      "No such food in the catalog (or someone else's private food)",
    ),
    ApiProblem(502, 'The catalog failed'),
    ApiProblem(503, 'The catalog is unavailable; try again shortly'),
    ApiProblem(504, "The catalog didn't answer in time; try again"),
  );

/** The user a catalog call is made for: their token, and languages for the food's name */
const onBehalfOf = (
  authorization: string,
  acceptLanguage: string | undefined,
): OnBehalfOf => ({
  authorization,
  languages: preferredLanguages(acceptLanguage),
});

@ApiTags('diary')
@ApiBearerAuth()
@ApiProblem(401, NO_TOKEN)
@Controller({ path: 'days', version: '1' })
export class DayController {
  constructor(private readonly entries: EntryService) {}

  @Get(':date')
  @ZodResponse({ status: 200, type: DayDto })
  @ApiProblem(400, 'Not a valid date')
  async day(@Param() { date }: DayParamsDto, @SignedInViewer() viewer: Viewer) {
    return this.entries.day(viewer.id, date);
  }

  @Post(':date/entries')
  @ZodResponse({
    status: 201,
    type: EntryDto,
    description: 'Created; the Location header points to it',
  })
  @ApiProblem(400, 'Invalid fields or date')
  @ApiCatalogProblems()
  async create(
    @Param() { date }: DayParamsDto,
    @Body() entry: CreateEntryDto,
    @SignedInViewer() viewer: Viewer,
    @Headers('authorization') authorization: string,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const created = await this.entries.create(
      viewer.id,
      date,
      entry,
      onBehalfOf(authorization, acceptLanguage),
    );
    response.location(`/v1/entries/${created.id}`);
    return created;
  }
}

@ApiTags('diary')
@ApiBearerAuth()
@ApiProblem(401, NO_TOKEN)
@Controller({ path: 'entries', version: '1' })
export class EntryController {
  constructor(private readonly entries: EntryService) {}

  @Get(':id')
  @ZodResponse({ status: 200, type: EntryDto })
  @ApiProblem(400, 'Not a valid id')
  @ApiProblem(404, 'No such entry in your diary')
  async get(
    @Param() { id }: EntryIdParamsDto,
    @SignedInViewer() viewer: Viewer,
  ) {
    const entry = await this.entries.get(viewer.id, id);
    if (!entry) throw new NotFoundException('No such entry in your diary');
    return entry;
  }

  @Put(':id')
  @ZodResponse({ status: 200, type: EntryDto, description: 'Replaced' })
  @ApiProblem(400, 'Invalid fields or date')
  @ApiProblem(404, 'No such entry in your diary')
  @ApiCatalogProblems()
  async replace(
    @Param() { id }: EntryIdParamsDto,
    @Body() change: ReplaceEntryDto,
    @SignedInViewer() viewer: Viewer,
    @Headers('authorization') authorization: string,
    @Headers('accept-language') acceptLanguage: string | undefined,
  ) {
    const entry = await this.entries.replace(
      viewer.id,
      id,
      change,
      onBehalfOf(authorization, acceptLanguage),
    );
    if (!entry) throw new NotFoundException('No such entry in your diary');
    return entry;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiProblem(400, 'Not a valid id')
  @ApiProblem(404, 'No such entry in your diary')
  async delete(
    @Param() { id }: EntryIdParamsDto,
    @SignedInViewer() viewer: Viewer,
  ): Promise<void> {
    if (!(await this.entries.delete(viewer.id, id))) {
      throw new NotFoundException('No such entry in your diary');
    }
  }
}
