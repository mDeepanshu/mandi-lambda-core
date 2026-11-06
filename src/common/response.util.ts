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

// The old server answered some business outcomes (duplicate vasuli, party not
// found) as HTTP 200 with the real code inside the body, and the frontends
// depend on it: their interceptor turns any non-2xx into a bare "error".
export function legacyResult(code: number, body?: any) {
  const message =
    code === ResponseCodes.SUCCESS_CODE ? ResponseMessages.SUCCESS_MESSAGES
    : code === ResponseCodes.SUCCESSFULLY_CREATED ? ResponseMessages.SAVED_SUCCESSFULLY
    : code === ResponseCodes.NOT_FOUND_CODE ? ResponseMessages.NOT_FOUND_MESSAGE
    : code === ResponseCodes.BAD_REQUEST_CODE ? ResponseMessages.BAD_REQUEST_CODE
    : ResponseMessages.SOMETHING_WENT_WRONG;
  return {
    statusCode: ResponseCodes.SUCCESS_CODE,
    headers: JSON_HEADERS,
    body: JSON.stringify({ responseCode: String(code), responseMessage: message, responseBody: body }),
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
