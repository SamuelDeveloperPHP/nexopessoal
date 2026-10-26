import type { AccessRequest, AuthSession, DemoContext, DocumentKind, DocumentRecord, MfaChallenge, Person } from './types.js';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3333';
const CONTEXT_KEY = 'nexopessoal:demo-context';
const SESSION_KEY = 'nexopessoal:session';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(readSession()?.token ? { authorization: `Bearer ${readSession()?.token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `A API retornou ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function readSession(): AuthSession | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AuthSession;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(response: { token: string; context: Omit<DemoContext, 'hrMembershipId'> & { membershipId: string } }): AuthSession {
  const session: AuthSession = {
    token: response.token,
    context: { ...response.context, hrMembershipId: response.context.membershipId },
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(CONTEXT_KEY, JSON.stringify(session.context));
  return session;
}

export async function registerSession(input: { tenantName: string; name: string; email: string; password: string }): Promise<AuthSession> {
  const response = await api<{ token: string; context: Omit<DemoContext, 'hrMembershipId'> & { membershipId: string } }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const session = saveSession(response);
  await seedDemo(session.context);
  return session;
}

export async function loginSession(input: { email: string; password: string }): Promise<AuthSession | MfaChallenge> {
  const response = await api<{ mfaRequired?: true; challengeToken?: string; expiresAt?: string; token?: string; context?: Omit<DemoContext, 'hrMembershipId'> & { membershipId: string } }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (response.mfaRequired && response.challengeToken && response.expiresAt) return { mfaRequired: true, challengeToken: response.challengeToken, expiresAt: response.expiresAt };
  if (!response.token || !response.context) throw new Error('Resposta de autenticação inválida.');
  return saveSession({ token: response.token, context: response.context });
}

export async function verifyMfaLogin(challengeToken: string, code: string): Promise<AuthSession> {
  const response = await api<{ token: string; context: Omit<DemoContext, 'hrMembershipId'> & { membershipId: string } }>('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code }) });
  return saveSession(response);
}

export async function beginMfaSetup(): Promise<{ secret: string; otpauthUri: string; issuer: string; account: string }> {
  return api('/auth/mfa/setup', { method: 'POST', body: JSON.stringify({}) });
}

export async function enableMfa(code: string): Promise<string[]> {
  const response = await api<{ token: string; context: Omit<DemoContext, 'hrMembershipId'> & { membershipId: string }; recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
  saveSession(response);
  return response.recoveryCodes;
}

export async function logoutSession(): Promise<void> {
  try {
    if (readSession()) await api<void>('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    // A sessão local nunca deve permanecer no navegador quando a rede caiu.
  }
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(CONTEXT_KEY);
}

async function seedDemo(context: DemoContext): Promise<void> {
  const documentKinds: DocumentKind[] = ['cpf', 'work_card', 'aso'];
  for (const documentKind of documentKinds) {
    await api(`/people/${context.personId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ documentKind }),
    });
  }
  await api('/tenants/' + context.tenantId + '/access-requests', {
    method: 'POST',
    body: JSON.stringify({
      personId: context.personId,
      requestedByMembershipId: context.hrMembershipId,
      purpose: 'admission',
      items: documentKinds.map((documentKind) => ({ documentKind })),
    }),
  });
}

export async function loadDemo(): Promise<{ context: DemoContext; requests: AccessRequest[] }> {
  const session = readSession();
  if (!session) throw new Error('AUTH_REQUIRED');
  const stored = localStorage.getItem(CONTEXT_KEY);
  if (!stored) localStorage.setItem(CONTEXT_KEY, JSON.stringify(session.context));
  try {
    const context = JSON.parse(stored ?? JSON.stringify(session.context)) as DemoContext;
    if (!context.hrMembershipId) throw new Error('Contexto antigo');
    let requests = await getTenantRequests(context.tenantId);
    if (requests.length === 0) {
      await seedDemo(context);
      requests = await getTenantRequests(context.tenantId);
    }
    return { context, requests };
  } catch {
    localStorage.removeItem(CONTEXT_KEY);
    throw new Error('Sessão expirada. Entre novamente.');
  }
}

export async function refreshDemo(): Promise<{ context: DemoContext; requests: AccessRequest[] }> {
  return loadDemo();
}

export async function createAdmission(
  context: DemoContext,
  input: { name: string; email: string; documentKinds: DocumentKind[] },
): Promise<{ context: DemoContext; requests: AccessRequest[] }> {
  const employee = await api<{ person: Person; membership: { id: string } }>(`/tenants/${context.tenantId}/people`, {
    method: 'POST',
    body: JSON.stringify({ name: input.name, email: input.email }),
  });
  await api(`/tenants/${context.tenantId}/access-requests`, {
    method: 'POST',
    body: JSON.stringify({
      personId: employee.person.id,
      requestedByMembershipId: context.hrMembershipId,
      purpose: 'admission',
      items: input.documentKinds.map((documentKind) => ({ documentKind })),
    }),
  });
  return { context, requests: await getTenantRequests(context.tenantId) };
}

export async function createEmployeeInvitation(context: DemoContext, personId: string): Promise<{ token: string; expiresAt: string }> {
  return api<{ token: string; expiresAt: string }>(`/tenants/${context.tenantId}/people/${personId}/invitation`, { method: 'POST' });
}

export async function getPersonDocuments(personId: string): Promise<DocumentRecord[]> {
  return api<DocumentRecord[]>(`/people/${personId}/documents`);
}

export async function reviewDocument(documentId: string, decision: 'approve' | 'reject', notes?: string): Promise<DocumentRecord> {
  return api<DocumentRecord>(`/documents/${documentId}/review`, { method: 'POST', body: JSON.stringify({ decision, ...(notes ? { notes } : {}) }) });
}

async function getTenantRequests(tenantId: string): Promise<AccessRequest[]> {
  return api<AccessRequest[]>(`/tenants/${tenantId}/access-requests`);
}
