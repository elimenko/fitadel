import {
  applyDecorators,
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Answer } from './idempotency.service';

/** Visible ASCII, no spaces; a UUID fits */
const KEY_PATTERN = /^[\x21-\x7E]{1,64}$/;

/**
 * The request's Idempotency-Key header, or undefined without one. A param decorator,
 * because Nest runs no pipes on @Headers().
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, context: ExecutionContext): string | undefined => {
    const value = context.switchToHttp().getRequest<Request>().headers[
      'idempotency-key'
    ];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
      throw new BadRequestException(
        'Idempotency-Key must be 1 to 64 visible ASCII characters',
      );
    }
    return value;
  },
);

export const ApiIdempotencyKey = () =>
  applyDecorators(
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'A unique value per intent (a UUID), sent again with every retry: a retry ' +
        'within a day gets the first answer, with `Idempotent-Replayed: true`, ' +
        'and writes nothing',
      schema: { type: 'string', maxLength: 64 },
    }),
  );

/** Sends an answer as it was first given, and says when it is a replay */
export function send<T>(response: Response, answer: Answer<T>): T {
  response.status(answer.status);
  if (answer.replayed) response.setHeader('Idempotent-Replayed', 'true');
  return answer.body;
}
