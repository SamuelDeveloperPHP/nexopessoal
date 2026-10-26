import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { MySqlStore } from './mysql-store.js';
import { readRuntimeConfig } from './runtime.js';
import { DemoStore } from './store.js';

const config = readRuntimeConfig();
if (config.dbDriver === 'sqlite') mkdirSync(dirname(config.dbPath), { recursive: true });
const store = config.dbDriver === 'mysql'
  ? await MySqlStore.create({ ...config.mysql, ...(config.mfaKey ? { mfaKey: config.mfaKey } : {}) })
  : new DemoStore({ dbPath: config.dbPath, ...(config.mfaKey ? { mfaKey: config.mfaKey } : {}) });
const app = createApp(store, {
  requireAuth: true,
  storageRoot: config.storageRoot,
  ...(config.corsOrigins ? { corsOrigins: config.corsOrigins } : {}),
  allowDemoReset: false,
  runtimeMode: config.mode,
});

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`NexoPessoal API ${config.mode} em http://${config.host}:${config.port}`);
} catch (error) {
  store.close();
  throw error;
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Encerrando API após ${signal}.`);
  await store.waitForPersistence();
  await app.close();
  store.close();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
