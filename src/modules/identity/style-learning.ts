import { z } from 'zod';
import { styleScopeSchema } from './contextual-style';
export const styleLearningVersion = 'mail059-v1';
export const styleLearningOperationSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('settings'),
    enabled: z.boolean(),
    expectedRevision: z.uuid().nullable(),
    noticeVersion: z.literal(styleLearningVersion),
  }),
  z.strictObject({
    action: z.enum(['accept', 'reject', 'revert']),
    proposalId: z.uuid(),
    expectedRevision: z.uuid(),
  }),
]);
export type StyleLearningOperation = z.infer<
  typeof styleLearningOperationSchema
>;
export const learningProposalSchema = z.strictObject({
  id: z.uuid(),
  scope: styleScopeSchema,
  feature: z.enum(['greeting', 'closing']),
  category: z.enum(['NONE', 'SHORT', 'FORMAL', 'GRATITUDE', 'WARM']),
  status: z.enum(['PENDING', 'APPLIED', 'REJECTED', 'STALE', 'REVERTED']),
  baseRevision: z.uuid(),
  appliedRevision: z.uuid().nullable(),
  baseVersion: z.int().positive(),
  appliedVersion: z.int().positive().nullable(),
  currentRevision: z.uuid(),
  support: z.int().min(3).max(100),
  total: z.int().min(3).max(100),
  threads: z.int().min(3).max(100),
  days: z.int().min(2).max(31),
  audiences: z.int().min(1).max(100),
  automatic: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  before: z.array(z.string().max(60)).max(5).nullable(),
  after: z.array(z.string().max(60)).max(5),
});
export const styleLearningSnapshotSchema = z.strictObject({
  settings: z.strictObject({
    enabled: z.boolean(),
    revision: z.uuid().nullable(),
    authorizedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  proposals: z.array(learningProposalSchema).max(50),
});
export type StyleLearningSnapshot = z.infer<typeof styleLearningSnapshotSchema>;
export type LearningProposal = z.infer<typeof learningProposalSchema>;
export const learningMessages: Record<string, string> = {
  INVALID_INPUT: 'Revisa la operación solicitada.',
  STALE_STYLE:
    'El perfil o sus preferencias han cambiado. Recarga las propuestas antes de continuar.',
  INSUFFICIENT_EVIDENCE:
    'Las correcciones ya no tienen evidencia suficiente. La propuesta no se ha aplicado.',
  NOT_CONNECTED: 'Conecta Gmail para gestionar el aprendizaje.',
  NOT_FOUND: 'La propuesta ya no está disponible.',
  UNAVAILABLE: 'No se ha podido completar la operación. Vuelve a intentarlo.',
};
export class StyleLearningError extends Error {
  constructor(public readonly code: keyof typeof learningMessages) {
    super(code);
    this.name = 'StyleLearningError';
  }
}
export function learningChangeLabel(
  p: Pick<LearningProposal, 'feature' | 'category'>,
) {
  const target = {
    NONE: 'sin',
    SHORT: 'breves',
    FORMAL: 'formales',
    GRATITUDE: 'con agradecimiento',
    WARM: 'cercanas',
  }[p.category];
  return p.category === 'NONE'
    ? `Retirar ${p.feature === 'greeting' ? 'los saludos' : 'las despedidas'}`
    : `Usar ${p.feature === 'greeting' ? 'saludos' : 'despedidas'} ${target}`;
}
