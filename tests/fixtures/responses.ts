import type {
  GeneratedResponse,
  ResponseGenerationInput,
} from '@/modules/response/contracts';
import { writingProfileFixture } from './writing-profile';
export function responseInput(): ResponseGenerationInput {
  return {
    conversation: {
      schemaVersion: 1,
      subject: 'Confirmación',
      messages: [
        {
          speaker: 'participant_1',
          text: 'Hola, por favor confirma que has recibido este correo. Gracias.',
          isTarget: true,
        },
      ],
      style: writingProfileFixture(),
    },
  };
}
export function readyResponse(): GeneratedResponse {
  return {
    status: 'READY',
    bodyText:
      'Buenos días,\n\nConfirmo que he recibido tu mensaje.\n\nGracias y un saludo.',
    language: 'es',
    missingInformation: [],
    evidence: [],
    warnings: [],
  };
}
export const supportedResponse = () => ({
  verdict: 'SUPPORTED',
  issues: [] as string[],
});
