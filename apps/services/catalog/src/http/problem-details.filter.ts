import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

/** RFC 9457 problem details: one error format for every endpoint */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  /** Validation errors, one per invalid field */
  errors?: { path: string; message: string }[];
  /** RFC 9457 extension members, e.g. existingFoodId */
  [extension: string]: unknown;
}

/**
 * An HTTP error that carries extra problem-details members, e.g.
 * new ProblemException(409, 'Someone already added it', { existingFoodId }).
 */
export class ProblemException extends HttpException {
  constructor(
    status: number,
    detail: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail, status);
  }
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // A deliberately custom body (e.g. terminus's health report) is kept as it is;
    // only Nest's default { statusCode, message, error } becomes a problem document
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && !('statusCode' in body)) {
        response.status(exception.getStatus()).json(body);
        return;
      }
    }

    const problem = toProblem(exception, request.originalUrl);
    if (problem.status >= 500) {
      this.logger.error(exception, 'Unhandled error');
    }
    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }
}

export function toProblem(
  exception: unknown,
  instance: string,
): ProblemDetails {
  if (exception instanceof ZodValidationException) {
    const error = exception.getZodError() as ZodError;
    return {
      ...base(HttpStatus.BAD_REQUEST, instance),
      detail: 'The request has invalid fields',
      errors: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const detail = exception.message;
    return {
      ...base(status, instance),
      // Nest's generic messages ("Not Found") repeat the title; keep only real details
      ...(detail && detail !== STATUS_CODES[status] ? { detail } : {}),
      ...(exception instanceof ProblemException ? exception.extensions : {}),
    };
  }
  // Unexpected errors: no internals in the response (they're logged instead)
  return base(HttpStatus.INTERNAL_SERVER_ERROR, instance);
}

function base(status: number, instance: string) {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    instance,
  };
}
