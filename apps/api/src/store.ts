import { randomUUID } from 'node:crypto';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  AccessRequest,
  DocumentGrant,
  DocumentKind,
  DocumentRecord,
  DocumentQuality,
  Role,
} from '@nexopessoal/domain';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUri, verifyTotp } from './mfa.js';

export type Tenant = { id: string; name: string };
export type Person = { id: string; name: string; email: string };
export type Membership = { id: string; tenantId: string; personId: string; role: Role };
export type AuditEvent = { action: string; subjectId: string; tenantId?: string; at: string };
export type AuthAccount = { id: string; personId: string; email: string; passwordHash: string; createdAt: string; mfaEnabled: boolean; mfaSecretCiphertext?: string; recoveryCodeHashes: string[] };
export type AuthSession = { id: string; accountId: string; tokenHash: string; expiresAt: string; mfaVerifiedAt?: string };
export type AuthPrincipal = { account: AuthAccount; person: Person; memberships: Membership[] };
export type StoredDocument = { documentId: string; storageKey: string; originalName: string; mimeType: string; sizeBytes: number; sha256: string; createdAt: string };
export type EmployeeInvitation = { id: string; tenantId: string; personId: string; tokenHash: string; expiresAt: string; createdAt: string; acceptedAt?: string };

type StoreOptions = { dbPath?: string; mfaKey?: string };
type MfaChallenge = { tokenHash: string; accountId: string; expiresAt: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [salt, expected] = encoded.split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class DemoStore {
  readonly tenants = new Map<string, Tenant>();
  readonly people = new Map<string, Person>();
  readonly memberships = new Map<string, Membership>();
  readonly documents = new Map<string, DocumentRecord>();
  readonly storedFiles = new Map<string, StoredDocument>();
  readonly documentQuality = new Map<string, DocumentQuality>();
  readonly invitations = new Map<string, EmployeeInvitation>();
  readonly requests = new Map<string, AccessRequest>();
  readonly grants = new Map<string, DocumentGrant>();
  readonly audit: AuditEvent[] = [];
  readonly accounts = new Map<string, AuthAccount>();
  readonly sessions = new Map<string, AuthSession>();
  private readonly mfaChallenges = new Map<string, MfaChallenge>();
  private readonly mfaKey: Buffer;
  private readonly db?: DatabaseSync;
  private isClosed = false;

  get closed(): boolean {
    return this.isClosed;
  }

  constructor(options: StoreOptions = {}) {
    this.mfaKey = createHash('sha256').update(options.mfaKey ?? process.env.NEXO_MFA_KEY ?? randomBytes(32)).digest();
    if (options.dbPath) {
      this.db = new DatabaseSync(options.dbPath);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS memberships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, role TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, document_kind TEXT NOT NULL, version_id TEXT NOT NULL, available INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS document_files (document_id TEXT PRIMARY KEY, storage_key TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS document_quality (document_id TEXT PRIMARY KEY, status TEXT NOT NULL, reasons_json TEXT NOT NULL, analyzed_at TEXT NOT NULL, review_status TEXT NOT NULL, review_notes TEXT, reviewed_at TEXT, reviewed_by_membership_id TEXT);
        CREATE TABLE IF NOT EXISTS access_requests (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, requested_by_membership_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS access_request_items (request_id TEXT NOT NULL, document_kind TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (request_id, document_kind));
        CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, access_request_id TEXT NOT NULL, document_kind TEXT NOT NULL, document_version_id TEXT NOT NULL, purpose TEXT NOT NULL, granted_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
        CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, subject_id TEXT NOT NULL, tenant_id TEXT, at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, person_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, mfa_enabled INTEGER NOT NULL DEFAULT 0, mfa_secret_ciphertext TEXT, recovery_codes_json TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, mfa_verified_at TEXT);
        CREATE TABLE IF NOT EXISTS employee_invitations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, accepted_at TEXT);
      `);
      for (const statement of [
        'ALTER TABLE auth_accounts ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE auth_accounts ADD COLUMN mfa_secret_ciphertext TEXT',
        "ALTER TABLE auth_accounts ADD COLUMN recovery_codes_json TEXT NOT NULL DEFAULT '[]'",
        'ALTER TABLE auth_sessions ADD COLUMN mfa_verified_at TEXT',
      ]) {
        try { this.db.exec(statement); } catch { /* coluna já existe */ }
      }
      this.hydrate();
    }
  }

  addTenant(name: string): Tenant {
    const tenant = { id: randomUUID(), name };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  addPerson(name: string, email: string): Person {
    const person = { id: randomUUID(), name, email: normalizeEmail(email) };
    this.people.set(person.id, person);
    return person;
  }

  findPersonByEmail(email: string): Person | undefined {
    return [...this.people.values()].find((person) => person.email === normalizeEmail(email));
  }

  findMembership(tenantId: string, personId: string): Membership | undefined {
    return [...this.memberships.values()].find(
      (membership) => membership.tenantId === tenantId && membership.personId === personId,
    );
  }

  addMembership(tenantId: string, personId: string, role: Role): Membership {
    const membership = { id: randomUUID(), tenantId, personId, role };
    this.memberships.set(membership.id, membership);
    return membership;
  }

  addDocument(personId: string, documentKind: DocumentKind): DocumentRecord {
    const document = {
      id: randomUUID(),
      personId,
      documentKind,
      versionId: randomUUID(),
      available: true,
    };
    this.documents.set(document.id, document);
    this.documentQuality.set(document.id, { documentId: document.id, status: 'passed', reasons: [], analyzedAt: new Date().toISOString(), reviewStatus: 'not_required' });
    return document;
  }

  addStoredDocument(personId: string, documentKind: DocumentKind, file: Omit<StoredDocument, 'documentId'>, quality: Omit<DocumentQuality, 'documentId'>): { document: DocumentRecord; file: StoredDocument } {
    const document = this.addDocument(personId, documentKind);
    const storedFile = { ...file, documentId: document.id };
    this.storedFiles.set(document.id, storedFile);
    this.documentQuality.set(document.id, { ...quality, documentId: document.id });
    return { document, file: storedFile };
  }

  findStoredFile(documentId: string): StoredDocument | undefined {
    return this.storedFiles.get(documentId);
  }

  findDocument(personId: string, documentKind: DocumentKind): DocumentRecord | undefined {
    return [...this.documents.values()].find(
      (document) => document.personId === personId && document.documentKind === documentKind && document.available,
    );
  }

  log(action: string, subjectId: string, tenantId?: string): void {
    this.audit.push({ action, subjectId, ...(tenantId ? { tenantId } : {}), at: new Date().toISOString() });
  }

  createAccount(personId: string, password: string): AuthAccount {
    const person = this.people.get(personId);
    if (!person) throw new Error('Pessoa não encontrada.');
    const account: AuthAccount = { id: randomUUID(), personId, email: person.email, passwordHash: hashPassword(password), createdAt: new Date().toISOString(), mfaEnabled: false, recoveryCodeHashes: [] };
    this.accounts.set(account.id, account);
    return account;
  }

  findAccountByEmail(email: string): AuthAccount | undefined {
    return [...this.accounts.values()].find((account) => account.email === normalizeEmail(email));
  }

  authenticate(email: string, password: string): AuthPrincipal | undefined {
    const account = this.findAccountByEmail(email);
    if (!account || !verifyPassword(password, account.passwordHash)) return undefined;
    const person = this.people.get(account.personId);
    if (!person) return undefined;
    return { account, person, memberships: [...this.memberships.values()].filter((membership) => membership.personId === person.id) };
  }

  createSession(accountId: string, mfaVerifiedAt?: string): string {
    const token = randomBytes(32).toString('base64url');
    const session: AuthSession = { id: randomUUID(), accountId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), ...(mfaVerifiedAt ? { mfaVerifiedAt } : {}) };
    this.sessions.set(session.id, session);
    return token;
  }

  revokeSession(token: string): boolean {
    const tokenHash = hashToken(token);
    const session = [...this.sessions.entries()].find(([, candidate]) => candidate.tokenHash === tokenHash);
    if (!session) return false;
    this.sessions.delete(session[0]);
    return true;
  }

  beginMfaSetup(accountId: string): { secret: string; otpauthUri: string } | undefined {
    const account = this.accounts.get(accountId);
    if (!account || account.mfaEnabled) return undefined;
    const secret = account.mfaSecretCiphertext ? this.decrypt(account.mfaSecretCiphertext) : generateTotpSecret();
    account.mfaSecretCiphertext = this.encrypt(secret);
    return { secret, otpauthUri: otpauthUri(secret, account.email) };
  }

  enableMfa(accountId: string, code: string): string[] | undefined {
    const account = this.accounts.get(accountId);
    if (!account || account.mfaEnabled || !account.mfaSecretCiphertext) return undefined;
    const secret = this.decrypt(account.mfaSecretCiphertext);
    if (!verifyTotp(secret, code)) return undefined;
    const recoveryCodes = generateRecoveryCodes();
    account.mfaEnabled = true;
    account.recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);
    for (const [id, session] of this.sessions) if (session.accountId === accountId) this.sessions.delete(id);
    return recoveryCodes;
  }

  createMfaChallenge(accountId: string): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    this.mfaChallenges.set(hashToken(token), { tokenHash: hashToken(token), accountId, expiresAt });
    return { token, expiresAt };
  }

  completeMfaChallenge(token: string, code: string): string | undefined {
    const challengeKey = hashToken(token);
    const challenge = this.mfaChallenges.get(challengeKey);
    if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
      this.mfaChallenges.delete(challengeKey);
      return undefined;
    }
    const account = this.accounts.get(challenge.accountId);
    if (!account || !account.mfaEnabled || !account.mfaSecretCiphertext) return undefined;
    const secret = this.decrypt(account.mfaSecretCiphertext);
    const isTotp = verifyTotp(secret, code);
    const recoveryHash = hashRecoveryCode(code);
    const recoveryIndex = account.recoveryCodeHashes.indexOf(recoveryHash);
    if (!isTotp && recoveryIndex < 0) return undefined;
    if (recoveryIndex >= 0) account.recoveryCodeHashes.splice(recoveryIndex, 1);
    this.mfaChallenges.delete(challengeKey);
    return this.createSession(account.id, new Date().toISOString());
  }

  createInvitation(tenantId: string, personId: string): string {
    const token = randomBytes(32).toString('base64url');
    const invitation = { id: randomUUID(), tenantId, personId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), createdAt: new Date().toISOString() };
    this.invitations.set(invitation.id, invitation);
    return token;
  }

  findInvitation(token: string): EmployeeInvitation | undefined {
    return [...this.invitations.values()].find((invitation) => invitation.tokenHash === hashToken(token));
  }

  principalFromToken(token: string): AuthPrincipal | undefined {
    const session = [...this.sessions.values()].find((candidate) => candidate.tokenHash === hashToken(token));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return undefined;
    const account = this.accounts.get(session.accountId);
    const person = account ? this.people.get(account.personId) : undefined;
    if (!account || !person) return undefined;
    return { account, person, memberships: [...this.memberships.values()].filter((membership) => membership.personId === person.id) };
  }

  flush(): void {
    if (!this.db) return;
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM access_request_items; DELETE FROM access_requests; DELETE FROM grants; DELETE FROM document_quality; DELETE FROM document_files; DELETE FROM documents; DELETE FROM employee_invitations; DELETE FROM memberships; DELETE FROM auth_sessions; DELETE FROM auth_accounts; DELETE FROM audit_events; DELETE FROM people; DELETE FROM tenants;');
      const insertTenant = this.db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)');
      for (const item of this.tenants.values()) insertTenant.run(item.id, item.name);
      const insertPerson = this.db.prepare('INSERT INTO people (id, name, email) VALUES (?, ?, ?)');
      for (const item of this.people.values()) insertPerson.run(item.id, item.name, item.email);
      const insertMembership = this.db.prepare('INSERT INTO memberships (id, tenant_id, person_id, role) VALUES (?, ?, ?, ?)');
      for (const item of this.memberships.values()) insertMembership.run(item.id, item.tenantId, item.personId, item.role);
      const insertDocument = this.db.prepare('INSERT INTO documents (id, person_id, document_kind, version_id, available) VALUES (?, ?, ?, ?, ?)');
      for (const item of this.documents.values()) insertDocument.run(item.id, item.personId, item.documentKind, item.versionId, item.available ? 1 : 0);
      const insertDocumentFile = this.db.prepare('INSERT INTO document_files (document_id, storage_key, original_name, mime_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const item of this.storedFiles.values()) insertDocumentFile.run(item.documentId, item.storageKey, item.originalName, item.mimeType, item.sizeBytes, item.sha256, item.createdAt);
      const insertDocumentQuality = this.db.prepare('INSERT INTO document_quality (document_id, status, reasons_json, analyzed_at, review_status, review_notes, reviewed_at, reviewed_by_membership_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of this.documentQuality.values()) insertDocumentQuality.run(item.documentId, item.status, JSON.stringify(item.reasons), item.analyzedAt, item.reviewStatus, item.reviewNotes ?? null, item.reviewedAt ?? null, item.reviewedByMembershipId ?? null);
      const insertRequest = this.db.prepare('INSERT INTO access_requests (id, tenant_id, person_id, requested_by_membership_id, purpose, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const insertRequestItem = this.db.prepare('INSERT INTO access_request_items (request_id, document_kind, status) VALUES (?, ?, ?)');
      for (const item of this.requests.values()) {
        insertRequest.run(item.id, item.tenantId, item.personId, item.requestedByMembershipId, item.purpose, item.status, item.expiresAt);
        for (const requestItem of item.items) insertRequestItem.run(item.id, requestItem.documentKind, requestItem.status);
      }
      const insertGrant = this.db.prepare('INSERT INTO grants (id, tenant_id, person_id, access_request_id, document_kind, document_version_id, purpose, granted_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of this.grants.values()) insertGrant.run(item.id, item.tenantId, item.personId, item.accessRequestId, item.documentKind, item.documentVersionId, item.purpose, item.grantedAt, item.expiresAt, item.revokedAt ?? null);
      const insertAudit = this.db.prepare('INSERT INTO audit_events (action, subject_id, tenant_id, at) VALUES (?, ?, ?, ?)');
      for (const item of this.audit) insertAudit.run(item.action, item.subjectId, item.tenantId ?? null, item.at);
      const insertAccount = this.db.prepare('INSERT INTO auth_accounts (id, person_id, email, password_hash, created_at, mfa_enabled, mfa_secret_ciphertext, recovery_codes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of this.accounts.values()) insertAccount.run(item.id, item.personId, item.email, item.passwordHash, item.createdAt, item.mfaEnabled ? 1 : 0, item.mfaSecretCiphertext ?? null, JSON.stringify(item.recoveryCodeHashes));
      const insertSession = this.db.prepare('INSERT INTO auth_sessions (id, account_id, token_hash, expires_at, mfa_verified_at) VALUES (?, ?, ?, ?, ?)');
      for (const item of this.sessions.values()) insertSession.run(item.id, item.accountId, item.tokenHash, item.expiresAt, item.mfaVerifiedAt ?? null);
      const insertInvitation = this.db.prepare('INSERT INTO employee_invitations (id, tenant_id, person_id, token_hash, expires_at, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const item of this.invitations.values()) insertInvitation.run(item.id, item.tenantId, item.personId, item.tokenHash, item.expiresAt, item.createdAt, item.acceptedAt ?? null);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  waitForPersistence(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    this.isClosed = true;
    this.db?.close();
  }

  private hydrate(): void {
    if (!this.db) return;
    for (const row of this.db.prepare('SELECT id, name FROM tenants').all() as Array<{ id: string; name: string }>) this.tenants.set(row.id, row);
    for (const row of this.db.prepare('SELECT id, name, email FROM people').all() as Array<Person>) this.people.set(row.id, row);
    for (const row of this.db.prepare('SELECT id, tenant_id as tenantId, person_id as personId, role FROM memberships').all() as Array<Membership>) this.memberships.set(row.id, row);
    for (const row of this.db.prepare('SELECT id, person_id as personId, document_kind as documentKind, version_id as versionId, available FROM documents').all() as Array<{ id: string; personId: string; documentKind: DocumentKind; versionId: string; available: number }>) this.documents.set(row.id, { id: row.id, personId: row.personId, documentKind: row.documentKind, versionId: row.versionId, available: Boolean(row.available) });
    for (const row of this.db.prepare('SELECT document_id as documentId, storage_key as storageKey, original_name as originalName, mime_type as mimeType, size_bytes as sizeBytes, sha256, created_at as createdAt FROM document_files').all() as Array<StoredDocument>) this.storedFiles.set(row.documentId, row);
    for (const row of this.db.prepare('SELECT document_id as documentId, status, reasons_json as reasonsJson, analyzed_at as analyzedAt, review_status as reviewStatus, review_notes as reviewNotes, reviewed_at as reviewedAt, reviewed_by_membership_id as reviewedByMembershipId FROM document_quality').all() as Array<{ documentId: string; status: DocumentQuality['status']; reasonsJson: string; analyzedAt: string; reviewStatus: DocumentQuality['reviewStatus']; reviewNotes?: string; reviewedAt?: string; reviewedByMembershipId?: string }>) this.documentQuality.set(row.documentId, { documentId: row.documentId, status: row.status, reasons: JSON.parse(row.reasonsJson) as string[], analyzedAt: row.analyzedAt, reviewStatus: row.reviewStatus, ...(row.reviewNotes ? { reviewNotes: row.reviewNotes } : {}), ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}), ...(row.reviewedByMembershipId ? { reviewedByMembershipId: row.reviewedByMembershipId } : {}) });
    for (const document of this.documents.values()) {
      if (!this.documentQuality.has(document.id)) this.documentQuality.set(document.id, { documentId: document.id, status: 'passed', reasons: [], analyzedAt: new Date().toISOString(), reviewStatus: 'not_required' });
    }
    const itemRows = this.db.prepare('SELECT request_id as requestId, document_kind as documentKind, status FROM access_request_items').all() as Array<{ requestId: string; documentKind: DocumentKind; status: string }>;
    for (const row of this.db.prepare('SELECT id, tenant_id as tenantId, person_id as personId, requested_by_membership_id as requestedByMembershipId, purpose, status, expires_at as expiresAt FROM access_requests').all() as Array<Omit<AccessRequest, 'items'> & { id: string }>) {
      this.requests.set(row.id, { ...row, items: itemRows.filter((item) => item.requestId === row.id).map(({ requestId: _requestId, ...item }) => item as AccessRequest['items'][number]) } as AccessRequest);
    }
    for (const row of this.db.prepare('SELECT id, tenant_id as tenantId, person_id as personId, access_request_id as accessRequestId, document_kind as documentKind, document_version_id as documentVersionId, purpose, granted_at as grantedAt, expires_at as expiresAt, revoked_at as revokedAt FROM grants').all() as Array<DocumentGrant>) this.grants.set(row.id, row);
    for (const row of this.db.prepare('SELECT action, subject_id as subjectId, tenant_id as tenantId, at FROM audit_events ORDER BY id').all() as Array<AuditEvent>) this.audit.push(row);
    for (const row of this.db.prepare('SELECT id, person_id as personId, email, password_hash as passwordHash, created_at as createdAt, mfa_enabled as mfaEnabled, mfa_secret_ciphertext as mfaSecretCiphertext, recovery_codes_json as recoveryCodesJson FROM auth_accounts').all() as Array<{ id: string; personId: string; email: string; passwordHash: string; createdAt: string; mfaEnabled: number; mfaSecretCiphertext?: string; recoveryCodesJson?: string }>) this.accounts.set(row.id, { id: row.id, personId: row.personId, email: row.email, passwordHash: row.passwordHash, createdAt: row.createdAt, mfaEnabled: Boolean(row.mfaEnabled), ...(row.mfaSecretCiphertext ? { mfaSecretCiphertext: row.mfaSecretCiphertext } : {}), recoveryCodeHashes: row.recoveryCodesJson ? JSON.parse(row.recoveryCodesJson) as string[] : [] });
    for (const row of this.db.prepare('SELECT id, account_id as accountId, token_hash as tokenHash, expires_at as expiresAt, mfa_verified_at as mfaVerifiedAt FROM auth_sessions').all() as Array<AuthSession>) this.sessions.set(row.id, { id: row.id, accountId: row.accountId, tokenHash: row.tokenHash, expiresAt: row.expiresAt, ...(row.mfaVerifiedAt ? { mfaVerifiedAt: row.mfaVerifiedAt } : {}) });
    for (const row of this.db.prepare('SELECT id, tenant_id as tenantId, person_id as personId, token_hash as tokenHash, expires_at as expiresAt, created_at as createdAt, accepted_at as acceptedAt FROM employee_invitations').all() as Array<EmployeeInvitation>) this.invitations.set(row.id, row);
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.mfaKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decrypt(value: string): string {
    const [ivValue, tagValue, encryptedValue] = value.split('.');
    if (!ivValue || !tagValue || !encryptedValue) throw new Error('Segredo MFA inválido.');
    const decipher = createDecipheriv('aes-256-gcm', this.mfaKey, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  }
}
