import { AsyncLocalStorage } from 'node:async_hooks';

export const executionContext = new AsyncLocalStorage<{
  runId: string;
  stage: string;
}>();
export function telemetryContext() {
  const current = executionContext.getStore();
  return current ? { executionId: current.runId, stage: current.stage } : {};
}
