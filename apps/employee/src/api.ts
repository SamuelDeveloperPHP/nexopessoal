import type { AccessRequest, DocumentKind, DocumentRecord, MfaChallenge, Session } from './types.js';
import { cachePortal, isOfflineMode, queueDecision, queueUpload, readCachedPortal, setOfflineMode, syncOutbox } from './offline.js';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3333';
const SESSION_KEY = 'nexopessoal:employee-session';

export function getSession(): Session | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored) as Session; } catch { localStorage.removeItem(SESSION_KEY); return null; }
}

function saveSession(response: { token: string; context: Session['context'] }): Session {
  const session = { token: response.token, context: response.context };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();
  const bodyIsForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(bodyIsForm ? {} : { 'content-type': 'application/json' }),
      ...(session?.token ? { authorization: `Bearer ${session.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `A API retornou ${response.status}.`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function acceptInvitation(token: string, password: string): Promise<Session> {
  const response = await api<{ token: string; context: Session['context'] }>('/auth/accept-invitation', { method: 'POST', body: JSON.stringify({ token, password }) });
  return saveSession({ token: response.token, context: response.context });
}

export async function login(email: string, password: string): Promise<Session | MfaChallenge> {
  const response = await api<{ mfaRequired?: true; challengeToken?: string; expiresAt?: string; token?: string; context?: Session['context'] }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (response.mfaRequired && response.challengeToken && response.expiresAt) return { mfaRequired: true, challengeToken: response.challengeToken, expiresAt: response.expiresAt };
  if (!response.token || !response.context) throw new Error('Resposta de autenticação inválida.');
  return saveSession({ token: response.token, context: response.context });
}

export async function verifyMfaLogin(challengeToken: string, code: string): Promise<Session> {
  const response = await api<{ token: string; context: Session['context'] }>('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code }) });
  return saveSession(response);
}

export async function beginMfaSetup(): Promise<{ secret: string; otpauthUri: string; issuer: string; account: string }> {
  return api('/auth/mfa/setup', { method: 'POST', body: JSON.stringify({}) });
}

export async function enableMfa(code: string): Promise<string[]> {
  const response = await api<{ token: string; context: Session['context']; recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
  saveSession(response);
  return response.recoveryCodes;
}

export async function logout(): Promise<void> {
  try {
    if (getSession()) await api<void>('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    // A sessão local nunca deve permanecer no navegador quando a rede caiu.
  }
  localStorage.removeItem(SESSION_KEY);
}

export function offlineEnabled(): boolean { return isOfflineMode(); }
export function setOffline(enabled: boolean): void { setOfflineMode(enabled); }

export async function loadPortal(): Promise<{ requests: AccessRequest[]; documents: DocumentRecord[] }> {
  const session = getSession();
  if (!session) throw new Error('AUTH_REQUIRED');
  if (isOfflineMode() || !navigator.onLine) {
    const cached = await readCachedPortal(session.token);
    if (!cached) throw new Error('Ainda não há dados sincronizados para o modo offline.');
    return cached;
  }
  const [requests, documents] = await Promise.all([
    api<AccessRequest[]>(`/people/${session.context.personId}/access-requests`),
    api<DocumentRecord[]>(`/people/${session.context.personId}/documents`),
  ]);
  const snapshot = { requests, documents };
  await cachePortal(session.token, snapshot);
  return snapshot;
}

export async function uploadDocument(documentKind: DocumentKind, file: File): Promise<DocumentRecord> {
  const session = getSession();
  if (!session) throw new Error('AUTH_REQUIRED');
  if (isOfflineMode() || !navigator.onLine) {
    await queueUpload(session.token, documentKind, file);
    return { id: `offline-${crypto.randomUUID()}`, personId: session.context.personId, documentKind, versionId: 'offline', available: true, quality: { status: 'failed', reasons: ['Aguardando sincronização com a API.'], analyzedAt: new Date().toISOString(), reviewStatus: 'pending' } };
  }
  const form = new FormData();
  form.append('documentKind', documentKind);
  form.append('file', file);
  return api<DocumentRecord>(`/people/${session.context.personId}/documents/upload`, { method: 'POST', body: form });
}

export async function decide(requestId: string, decisions: Array<{ documentKind: DocumentKind; decision: 'approve' | 'deny' }>): Promise<AccessRequest> {
  const session = getSession();
  if (!session) throw new Error('AUTH_REQUIRED');
  if (isOfflineMode() || !navigator.onLine) {
    await queueDecision(session.token, requestId, decisions);
    const cached = await readCachedPortal(session.token);
    const request = cached?.requests.find((item) => item.id === requestId);
    if (!request) throw new Error('Solicitação não disponível no modo offline.');
    return request;
  }
  return api<AccessRequest>(`/access-requests/${requestId}/decision`, { method: 'POST', body: JSON.stringify({ personId: session.context.personId, decisions }) });
}

export async function syncOfflineOperations(): Promise<number> {
  const session = getSession();
  if (!session || !navigator.onLine) return 0;
  return syncOutbox(session.token, {
    upload: async (job) => {
      const bytes = Uint8Array.from(atob(job.bytes), (character) => character.charCodeAt(0));
      const file = new File([bytes], job.fileName, { type: job.mimeType });
      const form = new FormData();
      form.append('documentKind', job.documentKind);
      form.append('file', file);
      await api<DocumentRecord>(`/people/${session.context.personId}/documents/upload`, { method: 'POST', body: form });
    },
    decision: async (job) => {
      await api<AccessRequest>(`/access-requests/${job.requestId}/decision`, { method: 'POST', body: JSON.stringify({ personId: session.context.personId, decisions: job.decisions }) });
    },
  });
}
