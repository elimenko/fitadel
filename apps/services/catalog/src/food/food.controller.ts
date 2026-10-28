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
  ApiExtraModels,
  ApiHeader,
  ApiNoContentResponse,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { CurrentViewer, type Viewer } from '../auth/viewer';
import { toGtin14 } from './barcode';
import { CustomFoodService } from './custom-food.service';
import { preferredLanguages } from './display-name';
import {
  BarcodeLookupDto,
  BarcodeParamsDto,
  CreateFoodDto,
  FoodDto,
  FoodIdParamsDto,
  ProblemDetailsDto,
  ReplaceFoodDto,
  SearchQueryDto,
  SearchResultDto,
} from './food.dto';
import { FoodService } from './food.service';

/** An error response in the docs: RFC 9457 problem details */
const problem = (status: number, description: string) =>
  ApiResponse({
    status,
    description,
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDetailsDto) },
      },
    },
  });

@ApiTags('foods')
@ApiExtraModels(ProblemDetailsDto)
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  description: 'Chooses the display name, e.g. "ru-RU,ru;q=0.9,en;q=0.8"',
})
@ApiHeader({
  name: 'X-Dev-User-Id',
  required: false,
  description:
    'Development only (AUTH_MODE=dev-headers), until Phase 2 brings logins: the user, as a UUID',
})
@ApiHeader({
  name: 'X-Dev-Roles',
  required: false,
  description: 'Development only: "contributor" may add public foods',
})
@Controller({ path: 'foods', version: '1' })
export class FoodController {
  constructor(
    private readonly foods: FoodService,
    private readonly customFoods: CustomFoodService,
  ) {}

  @Get()
  @ZodResponse({
    status: 200,
    type: SearchResultDto,
    description: "A page of matching foods (with the user's own private ones)",
  })
  @problem(400, 'Invalid query parameters')
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
  @ZodResponse({
    status: 200,
    type: BarcodeLookupDto,
    description: 'The best match, plus alternatives',
  })
  @problem(400, 'Not a valid barcode (wrong length, or a mistyped digit)')
  @problem(
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
  @ZodResponse({
    status: 200,
    type: FoodDto,
    description: 'The food, also when retired (diary entries refer to it)',
  })
  @problem(404, "No such food, or it's someone else's private food")
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
  @problem(400, 'Invalid fields, or a mistyped barcode')
  @problem(401, 'No user (until Phase 2: send X-Dev-User-Id)')
  @problem(403, 'Public foods need the contributor role')
  @problem(404, 'basedOnId: no such food to copy')
  @problem(
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
  @problem(400, 'Invalid fields, or a mistyped barcode')
  @problem(401, 'No user')
  @problem(
    403,
    'Not your food (create your own copy instead), or public needs the contributor role',
  )
  @problem(404, "No such food, or it's someone else's private food")
  @problem(409, 'The barcode is taken')
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
  @problem(401, 'No user')
  @problem(403, 'Not your food')
  @problem(404, "No such food, or it's someone else's private food")
  async retire(
    @Param() { id }: FoodIdParamsDto,
    @CurrentViewer() viewer: Viewer | null,
  ): Promise<void> {
    await this.customFoods.retire(id, viewer);
  }
}
