import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateQuery } from '../common/validation';
import * as service from './service';
import { ensureClipsBodySchema, ttsManifestQuerySchema } from './validation';

export async function getManifest(event: APIGatewayProxyEventV2) {
  try {
    const { voice, lang } = validateQuery(event, ttsManifestQuerySchema);

    logger.info('Get TTS manifest', { voice, lang });
    const result = await service.getManifest(voice, lang);
    return success(result);
  } catch (e) {
    return handleError(e, 'Get TTS manifest error');
  }
}

export async function ensureClips(event: APIGatewayProxyEventV2) {
  try {
    const { tokens, voice, lang } = validateBody(event, ensureClipsBodySchema);

    logger.info('Ensure TTS clips', { count: tokens.length, voice, lang });
    const result = await service.ensureClips(tokens, voice, lang);
    return success(result);
  } catch (e) {
    return handleError(e, 'Ensure TTS clips error');
  }
}
