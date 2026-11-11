import { NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { toProblem } from './problem-details.filter';

describe('toProblem', () => {
  it('describes validation errors per field', () => {
    const result = z
      .object({ code: z.string().regex(/^\d+$/) })
      .safeParse({ code: 'abc' });
    if (result.success) throw new Error('expected a validation error');

    expect(
      toProblem(new ZodValidationException(result.error), '/v1/x'),
    ).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      instance: '/v1/x',
      detail: 'The request has invalid fields',
      errors: [{ path: 'code', message: expect.any(String) }],
    });
  });

  it('keeps a real detail and drops a generic one', () => {
    expect(
      toProblem(new NotFoundException('No food with barcode 123'), '/v1/x'),
    ).toMatchObject({
      status: 404,
      title: 'Not Found',
      detail: 'No food with barcode 123',
    });
    expect(toProblem(new NotFoundException(), '/v1/x')).not.toHaveProperty(
      'detail',
    );
  });

  it('hides the internals of unexpected errors', () => {
    expect(
      toProblem(new Error('connection string with a password'), '/v1/x'),
    ).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: '/v1/x',
    });
  });
});
