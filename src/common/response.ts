export enum ResponseCodes {
  SUCCESS_CODE = 200,
  SUCCESSFULLY_CREATED = 201,
  SOMETHING_WENT_WRONG = 500,
  BAD_REQUEST_CODE = 400,
  UNAUTHORIZED_CODE = 401,
  NOT_FOUND_CODE = 404,
  CONFLICT_CODE = 409,
  // upstream provider failures (e.g. the TTS engine) — distinguished from our
  // own 500s so a client can tell "retry later" from "this request is broken"
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
}

export enum ResponseMessages {
  SUCCESS_MESSAGES = 'Success',
  SAVED_SUCCESSFULLY = 'Saved Successfully',
  SOMETHING_WENT_WRONG = 'Something Went Wrong',
  BAD_REQUEST_CODE = 'Bad Request',
  NOT_FOUND_MESSAGE = 'Entity not found',
  CONFLICT_MESSAGE = 'Confirmation required',
}

export interface CommonApiResponse {
  responseCode: string;
  responseMessage: string;
  responseBody?: any;
}
