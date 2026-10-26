import { readRuntimeConfig } from './runtime.js';

try {
  const config = readRuntimeConfig();
  console.log(JSON.stringify({ mode: config.mode, dbDriver: config.dbDriver, host: config.host, port: config.port, corsOrigins: config.corsOrigins?.length ?? 0 }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Configuração inválida.');
  process.exitCode = 1;
}
