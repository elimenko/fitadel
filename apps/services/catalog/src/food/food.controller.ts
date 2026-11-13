import {
  BadRequestException,
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
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ApiProblem } from '@fitadel/shared-http';
import { CurrentViewer, Public, type Viewer } from '../auth/viewer';
import { toGtin14 } from './barcode';
import { CustomFoodService } from './custom-food.service';
import { preferredLanguages } from './display-name';
import {
  BarcodeLookupDto,
  BarcodeParamsDto,
  CreateFoodDto,
  FoodDto,
  FoodIdParamsDto,
  ReplaceFoodDto,
  SearchQueryDto,
  SearchResultDto,
} from './food.dto';
import { FoodService } from './food.service';

const NO_TOKEN = 'No access token, or an invalid or expired one';
const INVALID_TOKEN =
  'An invalid or expired access token (send none to read anonymously)';

@ApiTags('foods')
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  description: 'Chooses the display name, e.g. "ru-RU,ru;q=0.9,en;q=0.8"',
})
// An access token from identity; reading works without one (anonymously)
@ApiBearerAuth()
@Controller({ path: 'foods', version: '1' })
export class FoodController {
  constructor(
    private readonly foods: FoodService,
    private readonly customFoods: CustomFoodService,
  ) {}

  @Get()
  @Public()
  @ZodResponse({
    status: 200,
    type: SearchResultDto,
    description: "A page of matching foods (with the user's own private ones)",
  })
  @ApiProblem(400, 'Invalid query parameters')
  @ApiProblem(401, INVALID_TOKEN)
  async search(
    @Query() { q, limit, offset }: SearchQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentViewer() viewer: Viewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.vary('Accept-Language');
    return this.foods.search(
      q,
      preferredLanguages(acceptLanguage),
      limit,
      offset,
      viewer,
    );
  }

  @Get('barcode/:code')
  @Public()
  @ZodResponse({
    status: 200,
    type: BarcodeLookupDto,
    description: 'The best match, plus alternatives',
  })
  @ApiProblem(400, 'Not a valid barcode (wrong length, or a mistyped digit)')
  @ApiProblem(401, INVALID_TOKEN)
  @ApiProblem(
    404,
    'Neither the catalog nor Open Food Facts has a usable food with this barcode',
  )
  async findByBarcode(
    @Param() { code }: BarcodeParamsDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentViewer() viewer: Viewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    // The display name depends on this header, so caches must keep one copy per value
    response.vary('Accept-Language');

    const barcode = toGtin14(code);
    if (!barcode) {
      throw new BadRequestException(
        "The barcode's check digit doesn't match: a digit may be mistyped",
      );
    }
    const result = await this.foods.findByBarcode(
      code,
      barcode,
      preferredLanguages(acceptLanguage),
      viewer,
    );
    if (!result) throw new NotFoundException(`No food with barcode ${code}`);
    return result;
  }

  @Get(':id')
  @Public()
  @ZodResponse({
    status: 200,
    type: FoodDto,
    description: 'The food, also when retired (diary entries refer to it)',
  })
  @ApiProblem(401, INVALID_TOKEN)
  @ApiProblem(404, "No such food, or it's someone else's private food")
  async findById(
    @Param() { id }: FoodIdParamsDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentViewer() viewer: Viewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.vary('Accept-Language');
    const food = await this.customFoods.findById(
      id,
      preferredLanguages(acceptLanguage),
      viewer,
    );
    if (!food) throw new NotFoundException('No food with this id');
    return food;
  }

  @Post()
  @ZodResponse({
    status: 201,
    type: FoodDto,
    description: 'Created; the Location header points to it',
  })
  @ApiProblem(400, 'Invalid fields, or a mistyped barcode')
  @ApiProblem(401, NO_TOKEN)
  @ApiProblem(403, 'Public foods need the contributor role')
  @ApiProblem(404, 'basedOnId: no such food to copy')
  @ApiProblem(
    409,
    'The barcode is taken; existingFoodId names the food that holds it',
  )
  async create(
    @Body() input: CreateFoodDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentViewer() viewer: Viewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    const food = await this.customFoods.create(
      input,
      preferredLanguages(acceptLanguage),
      viewer,
    );
    response.location(`/v1/foods/${food.id}`);
    return food;
  }

  @Put(':id')
  @ZodResponse({ status: 200, type: FoodDto, description: 'Replaced' })
  @ApiProblem(400, 'Invalid fields, or a mistyped barcode')
  @ApiProblem(401, NO_TOKEN)
  @ApiProblem(
    403,
    'Not your food (create your own copy instead), or public needs the contributor role',
  )
  @ApiProblem(404, "No such food, or it's someone else's private food")
  @ApiProblem(409, 'The barcode is taken')
  async replace(
    @Param() { id }: FoodIdParamsDto,
    @Body() input: ReplaceFoodDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentViewer() viewer: Viewer | null,
  ) {
    return this.customFoods.replace(
      id,
      input,
      preferredLanguages(acceptLanguage),
      viewer,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'Retired: no longer offered, still readable by id',
  })
  @ApiProblem(401, NO_TOKEN)
  @ApiProblem(403, 'Not your food')
  @ApiProblem(404, "No such food, or it's someone else's private food")
  async retire(
    @Param() { id }: FoodIdParamsDto,
    @CurrentViewer() viewer: Viewer | null,
  ): Promise<void> {
    await this.customFoods.retire(id, viewer);
  }
}
