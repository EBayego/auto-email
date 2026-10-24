import { z } from 'zod';
import { DataAccessError } from '@/db/errors';

export const executionSettingsSchema = z
  .object({
    automationEnabled: z.boolean(),
    pollIntervalSeconds: z.number().int().min(60).max(86400),
    maxDailyDrafts: z.number().int().min(0).max(1000),
  })
  .strict();
export type ExecutionSettings = z.infer<typeof executionSettingsSchema>;
export function parseExecutionForm(form: URLSearchParams) {
  const action = form.get('action');
  const allowed =
    action === 'settings'
      ? ['action', 'automationEnabled', 'pollIntervalSeconds', 'maxDailyDrafts']
      : ['action'];
  if (
    [...form.keys()].some(
      (key) => !allowed.includes(key) || form.getAll(key).length !== 1,
    )
  )
    throw new DataAccessError('INVALID_INPUT');
  if (action === 'settings') {
    const enabled = form.get('automationEnabled');
    const poll = form.get('pollIntervalSeconds');
    const limit = form.get('maxDailyDrafts');
    if (
      (enabled !== null && enabled !== 'true') ||
      !poll ||
      !/^\d+$/.test(poll) ||
      !limit ||
      !/^\d+$/.test(limit)
    )
      throw new DataAccessError('INVALID_INPUT');
    const settings = executionSettingsSchema.safeParse({
      automationEnabled: enabled === 'true',
      pollIntervalSeconds: Number(poll),
      maxDailyDrafts: Number(limit),
    });
    if (!settings.success) throw new DataAccessError('INVALID_INPUT');
    return { action, settings: settings.data } as const;
  }
  if (action === 'pause' || action === 'resume' || action === 'run')
    return { action } as const;
  throw new DataAccessError('INVALID_INPUT');
}
