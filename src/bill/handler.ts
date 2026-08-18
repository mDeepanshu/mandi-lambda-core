import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { handleError } from '../common/error';
import { initLogger, logger } from '../common/logger';
import { route } from './routes';

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  initLogger(context);
  const start = Date.now();
  const { method, path } = event.requestContext.http;

  logger.info('Request received', { method, path });
  logger.info('Request payload', { body: event.body, query: event.queryStringParameters });

  try {
    const response = await route(event);
    logger.info('Request completed', { method, path, statusCode: response.statusCode, durationMs: Date.now() - start });
    logger.info('Response body', { body: response.body });
    return response;
  } catch (e) {
    return handleError(e, 'Bill Lambda Error');
  }
};
