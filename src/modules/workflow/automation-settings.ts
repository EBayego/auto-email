import { z } from 'zod';
import { executionSettingsSchema } from './execution-controls';
import { normalizeClassifierExclusions } from '@/modules/classifier/rules';
import {
  normalizeResponsePolicySettings,
  responsePolicySettingsSchema,
} from '@/modules/policy/settings';

export const automationSettingsSchema = z.strictObject({
  execution: executionSettingsSchema,
  processingScope: z.enum(['ALL_INCOMING', 'INBOX', 'UNREAD_INBOX']),
  excludedAddresses: z.array(z.string().max(254)).max(100),
  excludedDomains: z.array(z.string().max(253)).max(100),
  policy: responsePolicySettingsSchema,
});
export type AutomationSettings = z.infer<typeof automationSettingsSchema>;
export const automationSnapshotSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  settings: automationSettingsSchema,
});
export type AutomationSnapshot = z.infer<typeof automationSnapshotSchema>;
export const automationUpdateSchema = automationSnapshotSchema;
export function normalizeAutomationSettings(
  input: unknown,
): AutomationSettings {
  const value = automationSettingsSchema.parse(input);
  const exclusions = normalizeClassifierExclusions({
    excludedAddresses: value.excludedAddresses,
    excludedDomains: value.excludedDomains,
  });
  return {
    ...value,
    excludedAddresses: [...exclusions.excludedAddresses],
    excludedDomains: [...exclusions.excludedDomains],
    policy: normalizeResponsePolicySettings(value.policy),
  };
}
export class AutomationSettingsError extends Error {
  constructor(readonly code: 'SETTINGS_CHANGED') {
    super(code);
    this.name = 'AutomationSettingsError';
  }
}
