import { z } from 'zod';
import { badRequest } from './error';

type ValidationTarget = 'body' | 'query' | 'headers';

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

function parseJsonBody(body?: string | null): unknown {
  if (!body) return undefined;

  try {
    return JSON.parse(body);
  } catch {
    throw badRequest('Invalid JSON body');
  }
}

function normalizeHeaders(headers?: Record<string, string | undefined>) {
  return Object.entries(headers ?? {}).reduce<Record<string, string | undefined>>(
    (normalized, [key, value]) => {
      normalized[key.toLowerCase()] = value;
      return normalized;
    },
    {}
  );
}

function validate<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  target: ValidationTarget
): z.infer<TSchema> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw badRequest(`Invalid request ${target}`, formatIssues(result.error));
  }

  return result.data;
}

export function validateBody<TSchema extends z.ZodType>(
  event: { body?: string | null },
  schema: TSchema
): z.infer<TSchema> {
  return validate(schema, parseJsonBody(event.body), 'body');
}

export function validateQuery<TSchema extends z.ZodType>(
  event: { queryStringParameters?: Record<string, string | undefined> | null },
  schema: TSchema
): z.infer<TSchema> {
  return validate(schema, event.queryStringParameters ?? {}, 'query');
}

export function validateHeaders<TSchema extends z.ZodType>(
  event: { headers?: Record<string, string | undefined> },
  schema: TSchema
): z.infer<TSchema> {
  return validate(schema, normalizeHeaders(event.headers), 'headers');
}

