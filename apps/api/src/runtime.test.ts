import assert from 'node:assert/strict';
import test from 'node:test';
import { readRuntimeConfig } from './runtime.js';

test('exige segredos e origens explícitas no modo produção', () => {
  assert.throws(() => readRuntimeConfig({ NODE_ENV: 'production' }), /NEXO_MFA_KEY/);
  assert.throws(() => readRuntimeConfig({
    NODE_ENV: 'production',
    NEXO_DB_DRIVER: 'sqlite',
    NEXO_MFA_KEY: 'a'.repeat(32),
    NEXO_CORS_ORIGINS: 'https://rh.example.com',
    NEXO_STORAGE_PATH: '/srv/nexopessoal/documents',
  }), /NEXO_DB_DRIVER/);
  const config = readRuntimeConfig({
    NODE_ENV: 'production',
    NEXO_DB_DRIVER: 'mysql',
    NEXO_MFA_KEY: 'a'.repeat(32),
    NEXO_CORS_ORIGINS: 'https://rh.example.com, https://app.example.com',
    NEXO_MYSQL_HOST: '127.0.0.1',
    NEXO_MYSQL_USER: 'nexopessoal',
    NEXO_MYSQL_PASSWORD: 'secret-from-test-env',
    NEXO_MYSQL_DATABASE: 'nexopessoal',
    NEXO_STORAGE_PATH: '/srv/nexopessoal/documents',
    PORT: '8443',
  });
  assert.equal(config.mode, 'production');
  assert.equal(config.dbDriver, 'mysql');
  assert.deepEqual(config.corsOrigins, ['https://rh.example.com', 'https://app.example.com']);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8443);
});

test('mantém configuração local sem exigir segredos de produção', () => {
  const config = readRuntimeConfig({ NEXO_RUNTIME_MODE: 'staging' });
  assert.equal(config.mode, 'staging');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.dbDriver, 'sqlite');
});
