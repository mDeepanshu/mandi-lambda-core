import { route } from './routes';

export const handler = async (event: any) => {
  try {
    return await route(event);
  } catch (e) {
    console.error('Vyapari Lambda Error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        responseCode: '500',
        responseMessage: 'Something Went Wrong',
      }),
    };
  }
};
