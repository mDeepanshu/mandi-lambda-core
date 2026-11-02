import { ResponseCodes, ResponseMessages } from './response';

// HTTP API falls back to text/plain when a structured response has no Content-Type.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function success(
  body?: any,
  created = false
) {
  return {
    statusCode: created
      ? ResponseCodes.SUCCESSFULLY_CREATED
      : ResponseCodes.SUCCESS_CODE,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      responseCode: String(
        created
          ? ResponseCodes.SUCCESSFULLY_CREATED
          : ResponseCodes.SUCCESS_CODE
      ),
      responseMessage: created
        ? ResponseMessages.SAVED_SUCCESSFULLY
        : ResponseMessages.SUCCESS_MESSAGES,
      responseBody: body,
    }),
  };
}

export function error(
  message: ResponseMessages | string = ResponseMessages.SOMETHING_WENT_WRONG,
  code: ResponseCodes | number = ResponseCodes.SOMETHING_WENT_WRONG,
  body?: any
) {
  const responseBody: Record<string, any> = {
    responseCode: String(code),
    responseMessage: message,
  };

  if (body !== undefined) {
    responseBody.responseBody = body;
  }

  return {
    statusCode: code,
    headers: JSON_HEADERS,
    body: JSON.stringify(responseBody),
  };
}
