export type RuntimeMode = 'demo' | 'staging' | 'production';

export type RuntimeConfig = {
  mode: RuntimeMode;
  nodeEnv: string;
  dbDriver: 'sqlite' | 'mysql';
  dbPath: string;
  mysql?: {
    url?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionLimit?: number;
  };
  storageRoot: string;
  mfaKey?: string;
  corsOrigins?: string[];
  host: string;
  port: number;
};

function runtimeMode(value: string | undefined): RuntimeMode {
  if (value === 'production' || value === 'staging' || value === 'demo') return value;
  return 'staging';
}

function corsOrigins(value: string | undefined): string[] | undefined {
  const origins = value?.split(',').map((origin) => origin.trim()).filter(Boolean);
  return origins && origins.length > 0 ? origins : undefined;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const mode = runtimeMode(env.NEXO_RUNTIME_MODE ?? (nodeEnv === 'production' ? 'production' : 'staging'));
  const origins = corsOrigins(env.NEXO_CORS_ORIGINS);
  const requestedDbDriver = env.NEXO_DB_DRIVER ?? (mode === 'production' ? 'mysql' : 'sqlite');
  const dbDriver = requestedDbDriver === 'mysql' ? 'mysql' : 'sqlite';
  const config: RuntimeConfig = {
    mode,
    nodeEnv,
    dbDriver,
    dbPath: env.NEXO_DB_PATH ?? './data/nexopessoal.sqlite',
    ...(dbDriver === 'mysql' ? {
      mysql: {
        ...(env.NEXO_MYSQL_URL ? { url: env.NEXO_MYSQL_URL } : {}),
        ...(env.NEXO_MYSQL_HOST ? { host: env.NEXO_MYSQL_HOST } : {}),
        ...(env.NEXO_MYSQL_PORT ? { port: Number(env.NEXO_MYSQL_PORT) } : {}),
        ...(env.NEXO_MYSQL_USER ? { user: env.NEXO_MYSQL_USER } : {}),
        ...(env.NEXO_MYSQL_PASSWORD ? { password: env.NEXO_MYSQL_PASSWORD } : {}),
        ...(env.NEXO_MYSQL_DATABASE ? { database: env.NEXO_MYSQL_DATABASE } : {}),
        ...(env.NEXO_MYSQL_POOL ? { connectionLimit: Number(env.NEXO_MYSQL_POOL) } : {}),
      },
    } : {}),
    storageRoot: env.NEXO_STORAGE_PATH ?? './data/documents',
    ...(env.NEXO_MFA_KEY ? { mfaKey: env.NEXO_MFA_KEY } : {}),
    ...(origins ? { corsOrigins: origins } : {}),
    host: env.NEXO_HOST ?? (mode === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port: Number(env.PORT ?? 3333),
  };

  const issues: string[] = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) issues.push('PORT deve ser uma porta TCP válida.');
  if (mode === 'production') {
    if (!config.mfaKey || config.mfaKey.length < 32) issues.push('NEXO_MFA_KEY deve ter pelo menos 32 caracteres e ser persistente.');
    if (!config.corsOrigins?.length) issues.push('NEXO_CORS_ORIGINS deve listar as origens web permitidas.');
    if (requestedDbDriver !== 'mysql') issues.push('NEXO_DB_DRIVER deve ser mysql em produção.');
    if (!env.NEXO_MYSQL_URL && (!env.NEXO_MYSQL_HOST || !env.NEXO_MYSQL_USER || !env.NEXO_MYSQL_DATABASE)) issues.push('Configure NEXO_MYSQL_URL ou NEXO_MYSQL_HOST, NEXO_MYSQL_USER e NEXO_MYSQL_DATABASE.');
    if (!env.NEXO_MYSQL_URL && !env.NEXO_MYSQL_PASSWORD) issues.push('NEXO_MYSQL_PASSWORD deve ser informado pelo secret manager.');
    if (!env.NEXO_STORAGE_PATH) issues.push('NEXO_STORAGE_PATH deve apontar para o storage privado configurado para o ambiente.');
  }
  if (requestedDbDriver !== 'mysql' && requestedDbDriver !== 'sqlite') issues.push('NEXO_DB_DRIVER deve ser mysql ou sqlite.');
  if (dbDriver === 'mysql' && !env.NEXO_MYSQL_URL && (!env.NEXO_MYSQL_HOST || !env.NEXO_MYSQL_USER || !env.NEXO_MYSQL_DATABASE)) issues.push('Configuração MySQL incompleta.');
  if (dbDriver === 'mysql' && env.NEXO_MYSQL_PORT && (!Number.isInteger(Number(env.NEXO_MYSQL_PORT)) || Number(env.NEXO_MYSQL_PORT) < 1 || Number(env.NEXO_MYSQL_PORT) > 65535)) issues.push('NEXO_MYSQL_PORT deve ser válida.');
  if (issues.length > 0) throw new Error(`Configuração ${mode} inválida: ${issues.join(' ')}`);
  return config;
}
