import { route } from './routes';

export const handler = async (event: any) => {
  try {
    return await route(event);
  } catch (err: any) {
    console.error('Item Lambda Error:', err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: err.message || 'Internal Server Error',
      }),
    };
  }
};
