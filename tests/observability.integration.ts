import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { SecretValue, type DataServiceConfig } from '@/config/env';
import { createOperationalTelemetry } from '@/db/operational-telemetry';
import { createOperationalMonitorStore } from '@/db/operational-monitor';
import { createGmailClient } from '@/providers/gmail';
import { createOpenAiClient } from '@/providers/openai';
import { createProviderRequestExecutor } from '@/providers/request-policy';
import { readRequestPolicyConfig } from '@/worker/request-config';
import { observe } from '@/modules/observability/telemetry';
import { telemetryContext } from '@/modules/observability/context';
import { readObservabilityConfig } from '@/modules/observability/config';
import { runOperationalMonitor } from '@/modules/observability/monitor';

const url = process.env.AUTO_EMAIL_TEST_URL!;
if (url !== 'http://127.0.0.1:55321') throw new Error('Only local Supabase');
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const config: DataServiceConfig = {
  environment: 'test',
  timeoutMs: 2000,
  auth: {
    appOrigin: process.env.AUTO_EMAIL_TEST_APP_URL!,
    supabaseUrl: url,
    publishableKey: process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
    secureCookies: false,
  },
  supabase: {
    url,
    secretKey: new SecretValue(process.env.AUTO_EMAIL_TEST_SECRET_KEY!),
  },
};
const ids: string[] = [];
async function run<T>(
  operation: () => Promise<T>,
  failed?: (value: T) => boolean,
) {
  return createOperationalTelemetry(config, service).run(
    'WORKER',
    async () => {
      ids.push(telemetryContext().executionId!);
      return operation();
    },
    { failed },
  );
}
afterAll(async () => {
  if (ids.length) {
    expect(
      (await service.from('operational_alerts').delete().in('run_id', ids))
        .error,
    ).toBeNull();
    expect(
      (await service.from('operational_runs').delete().in('id', ids)).error,
    ).toBeNull();
  }
});
describe('MAIL-066 proveedores y monitor con persistencia real', () => {
  it('mide cada intento real de Gmail y el consumo de OpenAI sin persistir sus contenidos', async () => {
    const raw =
      'private-mail-body private-token private-prompt@example.invalid';
    const gmailFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ emailAddress: 'private-prompt@example.invalid' }),
      );
    const executor = createProviderRequestExecutor({
      config: readRequestPolicyConfig({}, 1000),
      gate: {
        acquire: async () => ({ leaseId: randomUUID(), retryAfterMs: 0 }),
        release: async () => {},
        cooldown: async () => {},
      },
      pause: async () => {},
    });
    const gmail = createGmailClient(
      async () => 'private-token',
      1000,
      gmailFetch,
      executor,
    );
    const openaiFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 'synthetic-response',
        object: 'response',
        status: 'completed',
        output: [
          {
            id: 'synthetic-message',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              { type: 'output_text', text: '{"ok":true}', annotations: [] },
            ],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 5 },
      }),
    );
    const text = createOpenAiClient(
      {
        apiKey: new SecretValue('synthetic-key'),
        model: 'synthetic-model',
        reasoningEffort: 'none',
        maxOutputTokens: 2048,
      },
      1000,
      openaiFetch,
    );
    await run(async () => {
      await gmail.get('profile');
      await text.generate({ instructions: raw, input: raw });
    });
    const runId = ids.at(-1)!;
    const spans = await service
      .from('operational_spans')
      .select('*')
      .eq('run_id', runId);
    expect(spans.error).toBeNull();
    expect(spans.data?.filter((s) => s.stage === 'GMAIL')).toHaveLength(2);
    expect(
      spans.data?.filter((s) => s.stage === 'GMAIL' && s.outcome === 'FAILED'),
    ).toHaveLength(1);
    expect(spans.data?.find((s) => s.stage === 'OPENAI')).toMatchObject({
      input_tokens: 20,
      output_tokens: 5,
      estimated_cost_usd: null,
    });
    expect(JSON.stringify(spans.data)).not.toContain('private');
    expect(
      (
        await service
          .from('operational_runs')
          .select('status')
          .eq('id', runId)
          .single()
      ).data?.status,
    ).toBe('SUCCEEDED');
  });
  it('un fallo importante crea una alerta persistente asociada a la ejecución', async () => {
    await expect(
      run(() =>
        observe('KNOWLEDGE', async () => {
          throw new Error('private-error-content');
        }),
      ),
    ).rejects.toThrow('private-error-content');
    const alert = await service
      .from('operational_alerts')
      .select('*')
      .eq('run_id', ids.at(-1)!)
      .single();
    expect(alert.error).toBeNull();
    expect(alert.data).toMatchObject({
      kind: 'IMPORTANT_FAILURE',
      stage: 'WORKER',
      state: 'OPEN',
      severity: 'critical',
    });
    expect(JSON.stringify(alert.data)).not.toContain('private');
  });
  it('calcula métricas, mantiene costes desconocidos y diagnostica sin contenido de emails', async () => {
    const store = createOperationalMonitorStore(
      service,
      readObservabilityConfig({}),
    );
    const health = (await store.check()) as {
      workerRuns: number;
      stages: {
        stage: string;
        calls: number;
        p95_ms: number;
        estimated_cost_usd: number | null;
      }[];
    };
    expect(health.workerRuns).toBeGreaterThanOrEqual(2);
    expect(health.stages.find((s) => s.stage === 'GMAIL')).toMatchObject({
      calls: 2,
      estimated_cost_usd: null,
    });
    expect(
      health.stages.find((s) => s.stage === 'OPENAI')?.p95_ms,
    ).toBeGreaterThanOrEqual(0);
    const log = vi.fn();
    await runOperationalMonitor({
      store,
      config: readObservabilityConfig({}),
      log,
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ALERT_ACTIVE',
        kind: 'IMPORTANT_FAILURE',
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  });
  it('un worker recuperado resuelve el incidente sin borrar su historial', async () => {
    await run(
      async () => ({ failed: false }),
      (value) => value.failed,
    );
    const alert = await service
      .from('operational_alerts')
      .select('state,resolved_at')
      .eq('kind', 'IMPORTANT_FAILURE')
      .eq('stage', 'WORKER')
      .single();
    expect(alert.error).toBeNull();
    expect(alert.data?.state).toBe('RESOLVED');
    expect(alert.data?.resolved_at).toBeTruthy();
  });
  it('el rechazo del almacén de métricas no repite una operación externa confirmada', async () => {
    const badClient = createClient<Database>(
      url,
      process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const operation = vi.fn().mockResolvedValue('synthetic-draft');
    expect(
      await createOperationalTelemetry(config, badClient).run(
        'WORKER',
        operation,
      ),
    ).toBe('synthetic-draft');
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('el acceso anónimo a tablas y RPC operativas permanece cerrado', async () => {
    const anon = createClient<Database>(
      url,
      process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(
      (await anon.from('operational_alerts').select('*')).error,
    ).not.toBeNull();
    expect(
      (await anon.rpc('check_operational_health', {})).error,
    ).not.toBeNull();
  });
});
