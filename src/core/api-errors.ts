/**
 * Typed error classes for service-layer failures.
 *
 * Services throw one of these instead of plain `Error`. The Fastify error
 * handler in `web/server/index.ts` catches them and emits a uniform
 * `{ error: { code, message, details? } }` envelope with the right HTTP
 * status code, so route handlers don't need to string-sniff error messages
 * or manually set reply.code().
 *
 * For CLI callers, these throw like any other Error — the base `.message`
 * is still human-readable.
 */

export type ApiErrorCode =
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'internal';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, details?: unknown) {
    super('not_found', 404, message, details);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super('validation', 400, message, details);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, details?: unknown) {
    super('conflict', 409, message, details);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string, details?: unknown) {
    super('forbidden', 403, message, details);
    this.name = 'ForbiddenError';
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
