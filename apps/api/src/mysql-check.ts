import { MySqlStore } from './mysql-store.js';
import { readRuntimeConfig } from './runtime.js';

try {
  const config = readRuntimeConfig();
  if (config.dbDriver !== 'mysql') throw new Error('NEXO_DB_DRIVER precisa ser mysql para testar a conexão.');
  const store = await MySqlStore.create({ ...config.mysql, ...(config.mfaKey ? { mfaKey: config.mfaKey } : {}) });
  await store.waitForPersistence();
  store.close();
  console.log('Conexão MySQL e schema inicial validados.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Não foi possível validar o MySQL.');
  process.exitCode = 1;
}
