import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { route } from './routes';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    return await route(event);
  } catch (error) {
    console.error('Party Lambda Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};