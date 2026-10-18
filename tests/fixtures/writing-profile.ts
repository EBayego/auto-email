import type { WritingProfile } from '@/modules/identity/writing-profile';
export function writingProfileFixture(): WritingProfile {
  return {
    schema_version: 1,
    language: 'es',
    formality: 'medium',
    average_length: 'short',
    preferred_greetings: ['Hola', 'Buenos días'],
    preferred_closings: ['Gracias', 'Un saludo'],
    vocabulary: ['Perfecto', 'De acuerdo'],
    structure: 'Párrafos breves con petición directa y cierre cordial.',
    punctuation: 'Puntuación convencional y preguntas directas.',
    uses_emojis: false,
    style_description: 'Estilo directo, cordial y poco ceremonioso.',
  };
}

export const profileWork = {
  userId: '00000000-0000-4000-8000-000000000001',
  gmailAccountId: '00000000-0000-4000-8000-000000000002',
};
export function writingProfileRow() {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    user_id: profileWork.userId,
    gmail_account_id: profileWork.gmailAccountId,
    revision: '00000000-0000-4000-8000-000000000004',
    profile: writingProfileFixture(),
    model: 'test-model',
    prompt_version: 'mail018-v1',
    sample_size: 1,
    input_tokens: 100,
    output_tokens: 80,
    warnings: ['BELOW_RECOMMENDED_SIZE'],
    review_status: 'UNREVIEWED',
    reviewed_at: null as string | null,
    created_at: '2026-10-18T12:00:00Z',
    updated_at: '2026-10-18T12:00:00Z',
  };
}
