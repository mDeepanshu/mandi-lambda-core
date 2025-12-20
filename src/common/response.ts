export enum ResponseCodes {
  SUCCESS_CODE = 200,
  SUCCESSFULLY_CREATED = 201,
  SOMETHING_WENT_WRONG = 500,
  BAD_REQUEST_CODE = 400,
  NOT_FOUND_CODE = 404,
}

export enum ResponseMessages {
  SUCCESS_MESSAGES = 'Success',
  SAVED_SUCCESSFULLY = 'Saved Successfully',
  SOMETHING_WENT_WRONG = 'Something Went Wrong',
  BAD_REQUEST_CODE = 'Bad Request',
  NOT_FOUND_MESSAGE = 'Entity not found',
}

export interface CommonApiResponse {
  responseCode: string;
  responseMessage: string;
  responseBody?: any;
}
