export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { getServerConfig, ConfigurationError } =
      await import('./config/env');
    try {
      getServerConfig();
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
