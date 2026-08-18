import { Context } from 'aws-lambda';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_RANK: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const configuredLevel: LogLevel = (process.env.LOG_LEVEL?.toUpperCase() as LogLevel) ?? 'INFO';
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'mandi-lambda-core';

// Mutable per-invocation context — safe because Lambda is single-threaded per instance
let _requestId = 'cold-start';
let _functionName = 'unknown';

export function initLogger(context: Context): void {
  _requestId = context.awsRequestId;
  _functionName = context.functionName;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  if (error !== null && typeof error === 'object') {
    return { rawError: error };
  }
  return { rawError: String(error) };
}

function emit(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[configuredLevel]) return;
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE_NAME,
      requestId: _requestId,
      function: _functionName,
      message,
      ...extra,
    }) + '\n'
  );
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) => emit('DEBUG', message, extra),
  info:  (message: string, extra?: Record<string, unknown>) => emit('INFO',  message, extra),
  warn:  (message: string, extra?: Record<string, unknown>) => emit('WARN',  message, extra),
  error: (message: string, error?: unknown, extra?: Record<string, unknown>) =>
    emit('ERROR', message, {
      ...(error !== undefined ? serializeError(error) : {}),
      ...extra,
    }),
};
