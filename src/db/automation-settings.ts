import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import { assertPrivacyAuthorized } from './privacy';
import {
  AutomationSettingsError,
  automationSnapshotSchema,
  automationUpdateSchema,
  normalizeAutomationSettings,
  type AutomationSnapshot,
} from '@/modules/workflow/automation-settings';

export function createAutomationSettingsRepository(
  client: DataClient,
  userId: string,
) {
  requireUuid(userId);
  function decode(data: unknown): AutomationSnapshot {
    const parsed = automationSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new DataAccessError('UNAVAILABLE');
    return parsed.data;
  }
  return Object.freeze({
    async get() {
      const { data, error } = await client.rpc('get_automation_configuration', {
        p_user_id: userId,
      });
      if (error) throw new DataAccessError('UNAVAILABLE');
      if (!data) throw new DataAccessError('FORBIDDEN');
      return decode(data);
    },
    async set(input: unknown) {
      let value: AutomationSnapshot;
      try {
        const parsed = automationUpdateSchema.parse(input);
        value = {
          ...parsed,
          settings: normalizeAutomationSettings(parsed.settings),
        };
      } catch {
        throw new DataAccessError('INVALID_INPUT');
      }
      if (value.settings.execution.automationEnabled)
        await assertPrivacyAuthorized(client, userId);
      const { data, error } = await client.rpc('set_automation_configuration', {
        p_user_id: userId,
        p_revision: value.revision,
        p_settings: value.settings,
      });
      if (error?.message === 'SETTINGS_CHANGED')
        throw new AutomationSettingsError('SETTINGS_CHANGED');
      if (error?.message === 'FORBIDDEN')
        throw new DataAccessError('FORBIDDEN');
      if (error?.code === '23514') throw new DataAccessError('INVALID_INPUT');
      if (error) throw new DataAccessError('UNAVAILABLE');
      return decode(data);
    },
  });
}
