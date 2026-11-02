import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { safeOperationalEvent } from '@/modules/security/operational-log';
import { executionContext } from './context';

export const stages = [
  'WORKER',
  'SYNC',
  'JOBS',
  'ONBOARDING',
  'DELETION',
  'GMAIL',
  'OPENAI',
  'KNOWLEDGE',
  'WEB',
  'MONITOR',
] as const;
export type Stage = (typeof stages)[number];
export type Span = {
  id: string;
  run_id: string;
  stage: Stage;
  outcome: 'SUCCEEDED' | 'FAILED';
  reason_code: string | null;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
};
export interface TelemetryStore {
  start(id: string, stage: Stage): Promise<void>;
  heartbeat(id: string): Promise<void>;
  append?(spans: Span[]): Promise<void>;
  finish(
    id: string,
    failed: boolean,
    durationMs: number,
    spans: Span[],
  ): Promise<void>;
}
type Context = {
  runId: string;
  stage: Stage;
  spans: Span[];
  owner: Telemetry;
  buffer: { tail: Promise<void>; overflowReported: boolean };
};
const context = new AsyncLocalStorage<Context>();
let defaultTelemetry: Telemetry | undefined;
const elapsed = (start: number) =>
  Math.min(2147483647, Math.max(0, Math.round(performance.now() - start)));
export function safeErrorCode(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  return String(
    safeOperationalEvent({
      type: 'PROVIDER_FAILED',
      errorCode: typeof code === 'string' ? code : 'UNAVAILABLE',
    }).errorCode,
  );
}
type Options<T> = {
  failed?: (value: T) => boolean;
  usage?: (value: T) => { inputTokens: number; outputTokens: number } | null;
};
const token = (value: unknown) =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 1e12
    ? value
    : null;
export type Telemetry = ReturnType<typeof createTelemetry>;
export function installTelemetry(telemetry: Telemetry) {
  defaultTelemetry = telemetry;
}
export function observe<T>(
  stage: Stage,
  operation: () => Promise<T>,
  options: Options<T> = {},
): Promise<T> {
  const current = context.getStore();
  if (!current)
    return defaultTelemetry
      ? defaultTelemetry.run(stage, operation, options)
      : operation();
  return current.owner.measure(stage, operation, options);
}
export function createTelemetry(input: {
  store: TelemetryStore;
  pricing?: { inputUsdPerMillion: number; outputUsdPerMillion: number } | null;
  log?: (value: Record<string, unknown>) => void;
}) {
  const log = input.log ?? ((value) => console.log(JSON.stringify(value)));
  const write = (value: Record<string, unknown>) => {
    try {
      log({ timestamp: new Date().toISOString(), ...value });
    } catch {
      /* Logging never authorizes a repeated API write. */
    }
  };
  const sinkFailure = (runId: string) =>
    write({
      type: 'ALERT_RAISED',
      severity: 'critical',
      executionId: runId,
      stage: 'MONITOR',
      alert: 'TELEMETRY_UNAVAILABLE',
    });
  const owner = {
    async measure<T>(
      stage: Stage,
      operation: () => Promise<T>,
      options: Options<T> = {},
    ): Promise<T> {
      const current = context.getStore()!;
      const started = performance.now();
      let failed = true,
        reason: string | null = 'UNAVAILABLE';
      let usage: ReturnType<NonNullable<Options<T>['usage']>> = null;
      try {
        const value = await context.run({ ...current, stage }, () =>
          executionContext.run({ runId: current.runId, stage }, operation),
        );
        failed = options.failed?.(value) ?? false;
        reason = failed ? 'UNAVAILABLE' : null;
        if (options.usage) {
          try {
            usage = options.usage(value);
          } catch {
            /* Unknown usage remains null. */
          }
        }
        return value;
      } catch (error) {
        reason = safeErrorCode(error);
        throw error;
      } finally {
        const inputTokens = token(usage?.inputTokens),
          outputTokens = token(usage?.outputTokens);
        const cost =
          inputTokens !== null && outputTokens !== null && input.pricing
            ? Math.ceil(
                (inputTokens * input.pricing.inputUsdPerMillion +
                  outputTokens * input.pricing.outputUsdPerMillion) *
                  100,
              ) / 100000000
            : null;
        const span: Span = {
          id: randomUUID(),
          run_id: current.runId,
          stage,
          outcome: failed ? 'FAILED' : 'SUCCEEDED',
          reason_code: reason,
          duration_ms: elapsed(started),
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: cost,
        };
        if (current.spans.length < 1000) current.spans.push(span);
        else if (!current.buffer.overflowReported) {
          current.buffer.overflowReported = true;
          sinkFailure(current.runId);
        }
        write({
          type: 'OPERATION_COMPLETED',
          executionId: current.runId,
          spanId: span.id,
          stage,
          severity: failed ? 'error' : 'info',
          outcome: span.outcome,
          reasonCode: reason,
          durationMs: span.duration_ms,
          inputTokens,
          outputTokens,
          estimatedCostUsd: cost,
        });
        if (input.store.append && current.spans.length >= 500) {
          const batch = current.spans.splice(0, 500);
          current.buffer.tail = current.buffer.tail
            .then(() => input.store.append!(batch))
            .catch(() => sinkFailure(current.runId));
          await current.buffer.tail;
        }
      }
    },
    async run<T>(
      stage: Stage,
      operation: () => Promise<T>,
      options: Options<T> = {},
    ): Promise<T> {
      const runId = randomUUID(),
        spans: Span[] = [],
        started = performance.now();
      let failed = true;
      const buffer = { tail: Promise.resolve(), overflowReported: false };
      write({
        type: 'EXECUTION_STARTED',
        executionId: runId,
        stage,
        severity: 'info',
      });
      try {
        await input.store.start(runId, stage);
      } catch {
        sinkFailure(runId);
      }
      const timer = setInterval(() => {
        void input.store.heartbeat(runId).catch(() => sinkFailure(runId));
      }, 30000);
      timer.unref();
      try {
        return await context.run(
          { runId, stage, spans, owner, buffer },
          async () => {
            const result = await owner.measure(stage, operation, options);
            failed = options.failed?.(result) ?? false;
            return result;
          },
        );
      } finally {
        clearInterval(timer);
        await buffer.tail;
        const duration = elapsed(started);
        try {
          await input.store.finish(runId, failed, duration, spans);
        } catch {
          sinkFailure(runId);
        }
        write({
          type: 'EXECUTION_COMPLETED',
          executionId: runId,
          stage,
          severity: failed ? 'error' : 'info',
          failed,
          durationMs: duration,
        });
        if (failed)
          write({
            type: 'ALERT_RAISED',
            severity: 'critical',
            executionId: runId,
            stage,
            alert: 'IMPORTANT_FAILURE',
          });
      }
    },
  };
  return owner;
}
