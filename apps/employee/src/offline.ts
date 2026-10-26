import type { AccessRequest, DocumentKind, DocumentRecord } from './types.js';

const DB_NAME = 'nexopessoal-offline-v1';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const OUTBOX_STORE = 'outbox';
const MODE_KEY = 'nexopessoal:offline-mode';

type PortalCache = { requests: AccessRequest[]; documents: DocumentRecord[] };
type UploadJob = { kind: 'upload'; documentKind: DocumentKind; fileName: string; mimeType: string; bytes: string };
type DecisionJob = { kind: 'decision'; requestId: string; decisions: Array<{ documentKind: DocumentKind; decision: 'approve' | 'deny' }> };
type OutboxJob = { id: string; payload: UploadJob | DecisionJob; createdAt: string; iv: string; ciphertext: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(CACHE_STORE, { keyPath: 'id' });
      request.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento offline.'));
  });
}

function toBase64(bytes: Uint8Array): string {
  let value = '';
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(token: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(value: unknown, token: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(token);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, new TextEncoder().encode(JSON.stringify(value)) as unknown as BufferSource);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function decrypt<T>(record: { iv: string; ciphertext: string }, token: string): Promise<T> {
  const key = await deriveKey(token);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(record.iv) as unknown as BufferSource }, key, fromBase64(record.ciphertext) as unknown as BufferSource);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function isOfflineMode(): boolean {
  return localStorage.getItem(MODE_KEY) === 'enabled';
}

export function setOfflineMode(enabled: boolean): void {
  localStorage.setItem(MODE_KEY, enabled ? 'enabled' : 'disabled');
}

export async function cachePortal(token: string, snapshot: PortalCache): Promise<void> {
  const db = await openDatabase();
  const encrypted = await encrypt(snapshot, token);
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put({ id: 'portal', ...encrypted });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export async function readCachedPortal(token: string): Promise<PortalCache | null> {
  const db = await openDatabase();
  const record = await new Promise<{ iv: string; ciphertext: string } | undefined>((resolve, reject) => {
    const request = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get('portal');
    request.onsuccess = () => resolve(request.result as { iv: string; ciphertext: string } | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record ? decrypt<PortalCache>(record, token) : null;
}

async function enqueue(token: string, payload: UploadJob | DecisionJob): Promise<void> {
  const encrypted = await encrypt(payload, token);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(OUTBOX_STORE, 'readwrite').objectStore(OUTBOX_STORE).put({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...encrypted });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export async function queueUpload(token: string, documentKind: DocumentKind, file: File): Promise<void> {
  const bytes = toBase64(new Uint8Array(await file.arrayBuffer()));
  await enqueue(token, { kind: 'upload', documentKind, fileName: file.name, mimeType: file.type, bytes });
  const cached = await readCachedPortal(token);
  if (!cached) return;
  cached.documents = cached.documents.filter((document) => document.documentKind !== documentKind);
  cached.documents.push({ id: `offline-${crypto.randomUUID()}`, personId: '', documentKind, versionId: 'offline', available: true, file: { originalName: file.name, mimeType: file.type, sizeBytes: file.size, sha256: 'pending-sync', createdAt: new Date().toISOString() }, quality: { status: 'failed', reasons: ['Aguardando sincronização com a API.'], analyzedAt: new Date().toISOString(), reviewStatus: 'pending' } });
  await cachePortal(token, cached);
}

export async function queueDecision(token: string, requestId: string, decisions: DecisionJob['decisions']): Promise<void> {
  await enqueue(token, { kind: 'decision', requestId, decisions });
  const cached = await readCachedPortal(token);
  if (!cached) return;
  const request = cached.requests.find((item) => item.id === requestId);
  if (request) for (const decision of decisions) {
    const item = request.items.find((candidate) => candidate.documentKind === decision.documentKind);
    if (item) item.status = decision.decision === 'approve' ? 'approved' : 'denied';
  }
  await cachePortal(token, cached);
}

export async function syncOutbox(token: string, handlers: { upload: (job: UploadJob) => Promise<void>; decision: (job: DecisionJob) => Promise<void> }): Promise<number> {
  const db = await openDatabase();
  const records = await new Promise<OutboxJob[]>((resolve, reject) => {
    const request = db.transaction(OUTBOX_STORE, 'readonly').objectStore(OUTBOX_STORE).getAll();
    request.onsuccess = () => resolve(request.result as OutboxJob[]);
    request.onerror = () => reject(request.error);
  });
  let processed = 0;
  for (const record of records.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const payload = await decrypt<UploadJob | DecisionJob>(record, token);
    if (payload.kind === 'upload') await handlers.upload(payload);
    else await handlers.decision(payload);
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(OUTBOX_STORE, 'readwrite').objectStore(OUTBOX_STORE).delete(record.id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    processed += 1;
  }
  db.close();
  return processed;
}
