import { ResponseCodes, ResponseMessages } from './response';

export function success(
  body?: any,
  created = false
) {
  return {
    statusCode: created
      ? ResponseCodes.SUCCESSFULLY_CREATED
      : ResponseCodes.SUCCESS_CODE,
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
  code: ResponseCodes = ResponseCodes.SOMETHING_WENT_WRONG
) {
  return {
    statusCode: code,
    body: JSON.stringify({
      responseCode: String(code),
      responseMessage: message,
    }),
  };
}