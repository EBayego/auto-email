import type {
  CurrentWritingProfile,
  WritingProfile,
} from '@/modules/identity/writing-profile';
export function writingProfileFixture(): CurrentWritingProfile {
  return {
    schema_version: 2,
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
    form_of_address: 'informal',
    tone: { warmth: 'warm', directness: 'direct' },
    structure_traits: {
      sentence_length: 'short',
      paragraph_length: 'short',
      lists: 'occasional',
    },
    punctuation_traits: {
      exclamations: 'occasional',
      ellipses: 'none',
      semicolons: 'none',
    },
  };
}

export function legacyWritingProfileFixture(): WritingProfile {
  const current = writingProfileFixture();
  return {
    schema_version: 1,
    language: current.language,
    formality: current.formality,
    average_length: current.average_length,
    preferred_greetings: [...current.preferred_greetings],
    preferred_closings: [...current.preferred_closings],
    vocabulary: [...current.vocabulary],
    structure: current.structure,
    punctuation: current.punctuation,
    uses_emojis: current.uses_emojis,
    style_description: current.style_description,
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
    version: 1,
    origin: 'SENT_HISTORY',
    source_message_ids: ['sent0'],
    scope_kind: 'GENERAL',
    scope_key: '',
    parent_revision: null as string | null,
    context_evidence: {},
    relationship_rule_revisions: [] as string[],
    generated_at: '2026-10-18T12:00:00Z',
    profile: writingProfileFixture(),
    model: 'test-model',
    prompt_version: 'mail024-v2',
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
