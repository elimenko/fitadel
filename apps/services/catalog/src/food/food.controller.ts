import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { toGtin14 } from './barcode';
import { preferredLanguages } from './display-name';
import {
  BarcodeLookupDto,
  BarcodeParamsDto,
  ProblemDetailsDto,
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
@Controller({ path: 'foods', version: '1' })
export class FoodController {
  constructor(private readonly foods: FoodService) {}

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
    );
    if (!result) throw new NotFoundException(`No food with barcode ${code}`);
    return result;
  }
}
