export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { getWebServerConfig, ConfigurationError } =
      await import('./config/env');
    try {
      const config = getWebServerConfig();
      const { createOperationalTelemetry } =
        await import('./db/operational-telemetry');
      const { installTelemetry } =
        await import('./modules/observability/telemetry');
      installTelemetry(createOperationalTelemetry(config));
      for (const name of [
        'OPENAI_API_KEY',
        'SUPABASE_ACCESS_TOKEN',
        'SUPABASE_DB_PASSWORD',
        'ALERT_WEBHOOK_URL',
        'ALERT_WEBHOOK_BEARER_TOKEN',
      ])
        process.env[name] = '';
      const { getErasureLedger } =
        await import('./modules/security/erasure-ledger');
      getErasureLedger();
      const { startRuntimeHeartbeat } =
        await import('./modules/operations/runtime-health');
      startRuntimeHeartbeat('web');
    } catch (error) {
      console.error(
        error instanceof ConfigurationError
          ? error.message
          : 'No se pudo validar la configuración del servidor.',
      );
      process.exit(1);
    }
  }
}

export async function onRequestError(error: unknown) {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { observe } = await import('./modules/observability/telemetry');
    await observe('WEB', async () => {
      throw error;
    }).catch(() => {});
  }
}
