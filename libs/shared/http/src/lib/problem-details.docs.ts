import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The shape ProblemDetailsFilter sends, for the API docs */
export const ProblemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('Validation errors, one per invalid field'),
  })
  .describe('RFC 9457 problem details');

export class ProblemDetailsDto extends createZodDto(ProblemDetailsSchema) {}

/** An error response in the docs: RFC 9457 problem details */
export const ApiProblem = (status: number, description: string) =>
  applyDecorators(
    ApiExtraModels(ProblemDetailsDto),
    ApiResponse({
      status,
      description,
      content: {
        'application/problem+json': {
          schema: { $ref: getSchemaPath(ProblemDetailsDto) },
        },
      },
    }),
  );
