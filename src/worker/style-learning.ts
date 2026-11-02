export async function runStyleLearning(
  store: { refresh(limit: number): Promise<void> },
  limit: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return;
  await store.refresh(limit);
}
