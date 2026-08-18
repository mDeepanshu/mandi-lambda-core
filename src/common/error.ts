import { ResponseCodes, ResponseMessages } from './response';
import { error as errorResponse } from './response.util';
import { logger } from './logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(
    message: string,
    statusCode = ResponseCodes.SOMETHING_WENT_WRONG,
    details?: unknown,
    expose = statusCode < 500
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.expose = expose;
  }
}

export const badRequest = (message: string = ResponseMessages.BAD_REQUEST_CODE, details?: unknown) =>
  new AppError(message, ResponseCodes.BAD_REQUEST_CODE, details);

export const notFound = (message: string = ResponseMessages.NOT_FOUND_MESSAGE, details?: unknown) =>
  new AppError(message, ResponseCodes.NOT_FOUND_CODE, details);

// 409 — the request is valid but would combine existing data, so it is held for
// the caller to confirm. `details` carries the preview the client shows.
export const conflict = (message: string = ResponseMessages.CONFLICT_MESSAGE, details?: unknown) =>
  new AppError(message, ResponseCodes.CONFLICT_CODE, details);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof SyntaxError) {
    return badRequest('Invalid JSON body');
  }

  return new AppError(ResponseMessages.SOMETHING_WENT_WRONG);
}

export function handleError(error: unknown, context = 'Unhandled error') {
  const normalized = normalizeError(error);

  if (!normalized.expose) {
    logger.error(context, error, { statusCode: normalized.statusCode });
  }

  return errorResponse(
    normalized.expose ? normalized.message : ResponseMessages.SOMETHING_WENT_WRONG,
    normalized.statusCode,
    normalized.expose ? normalized.details : undefined
  );
}

export function routeNotFound(message = 'Route not found') {
  return handleError(notFound(message));
}
