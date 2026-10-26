import mysql, { type Pool } from 'mysql2/promise';
import type { AccessRequest, DocumentGrant, DocumentKind, DocumentQuality, Role } from '@nexopessoal/domain';
import { DemoStore, type AuthAccount, type AuthSession, type AuditEvent, type EmployeeInvitation, type Membership, type Person, type StoredDocument, type Tenant } from './store.js';

export type MySqlStoreOptions = {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  mfaKey?: string;
};

const schema = [
  `CREATE TABLE IF NOT EXISTS tenants (id VARCHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS people (id VARCHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(320) NOT NULL UNIQUE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS memberships (id VARCHAR(36) PRIMARY KEY, tenant_id VARCHAR(36) NOT NULL, person_id VARCHAR(36) NOT NULL, role VARCHAR(32) NOT NULL, INDEX memberships_tenant_idx (tenant_id), INDEX memberships_person_idx (person_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS documents (id VARCHAR(36) PRIMARY KEY, person_id VARCHAR(36) NOT NULL, document_kind VARCHAR(64) NOT NULL, version_id VARCHAR(36) NOT NULL, available TINYINT(1) NOT NULL, INDEX documents_person_idx (person_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS document_files (document_id VARCHAR(36) PRIMARY KEY, storage_key VARCHAR(255) NOT NULL, original_name VARCHAR(120) NOT NULL, mime_type VARCHAR(120) NOT NULL, size_bytes BIGINT NOT NULL, sha256 CHAR(64) NOT NULL, created_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS document_quality (document_id VARCHAR(36) PRIMARY KEY, status VARCHAR(16) NOT NULL, reasons_json LONGTEXT NOT NULL, analyzed_at VARCHAR(40) NOT NULL, review_status VARCHAR(24) NOT NULL, review_notes VARCHAR(1000), reviewed_at VARCHAR(40), reviewed_by_membership_id VARCHAR(36)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS access_requests (id VARCHAR(36) PRIMARY KEY, tenant_id VARCHAR(36) NOT NULL, person_id VARCHAR(36) NOT NULL, requested_by_membership_id VARCHAR(36) NOT NULL, purpose VARCHAR(16) NOT NULL, status VARCHAR(24) NOT NULL, expires_at VARCHAR(40) NOT NULL, INDEX requests_tenant_idx (tenant_id), INDEX requests_person_idx (person_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS access_request_items (request_id VARCHAR(36) NOT NULL, document_kind VARCHAR(64) NOT NULL, status VARCHAR(16) NOT NULL, PRIMARY KEY (request_id, document_kind)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS grants (id VARCHAR(36) PRIMARY KEY, tenant_id VARCHAR(36) NOT NULL, person_id VARCHAR(36) NOT NULL, access_request_id VARCHAR(36) NOT NULL, document_kind VARCHAR(64) NOT NULL, document_version_id VARCHAR(36) NOT NULL, purpose VARCHAR(16) NOT NULL, granted_at VARCHAR(40) NOT NULL, expires_at VARCHAR(40) NOT NULL, revoked_at VARCHAR(40), INDEX grants_tenant_idx (tenant_id), INDEX grants_person_idx (person_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS audit_events (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, action VARCHAR(120) NOT NULL, subject_id VARCHAR(36) NOT NULL, tenant_id VARCHAR(36), at VARCHAR(40) NOT NULL, INDEX audit_tenant_idx (tenant_id), INDEX audit_at_idx (at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS auth_accounts (id VARCHAR(36) PRIMARY KEY, person_id VARCHAR(36) NOT NULL UNIQUE, email VARCHAR(320) NOT NULL UNIQUE, password_hash VARCHAR(200) NOT NULL, created_at VARCHAR(40) NOT NULL, mfa_enabled TINYINT(1) NOT NULL DEFAULT 0, mfa_secret_ciphertext VARCHAR(500), recovery_codes_json LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (id VARCHAR(36) PRIMARY KEY, account_id VARCHAR(36) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, expires_at VARCHAR(40) NOT NULL, mfa_verified_at VARCHAR(40), INDEX sessions_account_idx (account_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS employee_invitations (id VARCHAR(36) PRIMARY KEY, tenant_id VARCHAR(36) NOT NULL, person_id VARCHAR(36) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, expires_at VARCHAR(40) NOT NULL, created_at VARCHAR(40) NOT NULL, accepted_at VARCHAR(40)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export class MySqlStore extends DemoStore {
  private readonly pool: Pool;
  private pending: Promise<void> = Promise.resolve();

  private constructor(pool: Pool, mfaKey?: string) {
    super(mfaKey ? { mfaKey } : {});
    this.pool = pool;
  }

  static async create(options: MySqlStoreOptions): Promise<MySqlStore> {
    const pool = options.url
      ? mysql.createPool(options.url)
      : mysql.createPool({
        ...(options.host ? { host: options.host } : {}),
        ...(options.port ? { port: options.port } : {}),
        ...(options.user ? { user: options.user } : {}),
        ...(options.password ? { password: options.password } : {}),
        ...(options.database ? { database: options.database } : {}),
        connectionLimit: options.connectionLimit ?? 10,
        waitForConnections: true,
      });
    const store = new MySqlStore(pool, options.mfaKey);
    try {
      await store.migrate();
      await store.hydrateFromMySql();
      return store;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  override flush(): void {
    this.pending = this.pending.catch(() => undefined).then(() => this.persistSnapshot());
  }

  override waitForPersistence(): Promise<void> {
    return this.pending;
  }

  override close(): void {
    super.close();
    void this.pool.end();
  }

  private async migrate(): Promise<void> {
    for (const statement of schema) await this.pool.query(statement);
  }

  private async hydrateFromMySql(): Promise<void> {
    const [tenants] = await this.pool.query('SELECT id, name FROM tenants');
    for (const row of tenants as Tenant[]) this.tenants.set(row.id, row);
    const [people] = await this.pool.query('SELECT id, name, email FROM people');
    for (const row of people as Person[]) this.people.set(row.id, row);
    const [memberships] = await this.pool.query('SELECT id, tenant_id AS tenantId, person_id AS personId, role FROM memberships');
    for (const row of memberships as Membership[]) this.memberships.set(row.id, row);
    const [documents] = await this.pool.query('SELECT id, person_id AS personId, document_kind AS documentKind, version_id AS versionId, available FROM documents');
    for (const row of documents as Array<{ id: string; personId: string; documentKind: DocumentKind; versionId: string; available: number }>) this.documents.set(row.id, { ...row, available: Boolean(row.available) });
    const [files] = await this.pool.query('SELECT document_id AS documentId, storage_key AS storageKey, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes, sha256, created_at AS createdAt FROM document_files');
    for (const row of files as StoredDocument[]) this.storedFiles.set(row.documentId, row);
    const [qualities] = await this.pool.query('SELECT document_id AS documentId, status, reasons_json AS reasonsJson, analyzed_at AS analyzedAt, review_status AS reviewStatus, review_notes AS reviewNotes, reviewed_at AS reviewedAt, reviewed_by_membership_id AS reviewedByMembershipId FROM document_quality');
    for (const row of qualities as Array<{ documentId: string; status: DocumentQuality['status']; reasonsJson: string; analyzedAt: string; reviewStatus: DocumentQuality['reviewStatus']; reviewNotes: string | null; reviewedAt: string | null; reviewedByMembershipId: string | null }>) {
      this.documentQuality.set(row.documentId, {
        documentId: row.documentId,
        status: row.status,
        reasons: JSON.parse(row.reasonsJson) as string[],
        analyzedAt: row.analyzedAt,
        reviewStatus: row.reviewStatus,
        ...(row.reviewNotes ? { reviewNotes: row.reviewNotes } : {}),
        ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
        ...(row.reviewedByMembershipId ? { reviewedByMembershipId: row.reviewedByMembershipId } : {}),
      });
    }
    const [requestItems] = await this.pool.query('SELECT request_id AS requestId, document_kind AS documentKind, status FROM access_request_items');
    const itemsByRequest = new Map<string, AccessRequest['items']>();
    for (const row of requestItems as Array<{ requestId: string; documentKind: DocumentKind; status: AccessRequest['items'][number]['status'] }>) {
      const items = itemsByRequest.get(row.requestId) ?? [];
      items.push({ documentKind: row.documentKind, status: row.status });
      itemsByRequest.set(row.requestId, items);
    }
    const [requests] = await this.pool.query('SELECT id, tenant_id AS tenantId, person_id AS personId, requested_by_membership_id AS requestedByMembershipId, purpose, status, expires_at AS expiresAt FROM access_requests');
    for (const row of requests as Array<Omit<AccessRequest, 'items'>>) this.requests.set(row.id, { ...row, items: itemsByRequest.get(row.id) ?? [] });
    const [grants] = await this.pool.query('SELECT id, tenant_id AS tenantId, person_id AS personId, access_request_id AS accessRequestId, document_kind AS documentKind, document_version_id AS documentVersionId, purpose, granted_at AS grantedAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM grants');
    for (const row of grants as Array<DocumentGrant & { revokedAt: string | null }>) this.grants.set(row.id, { ...row, ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}) });
    const [audit] = await this.pool.query('SELECT action, subject_id AS subjectId, tenant_id AS tenantId, at FROM audit_events ORDER BY id');
    for (const row of audit as Array<AuditEvent & { tenantId: string | null }>) this.audit.push({ action: row.action, subjectId: row.subjectId, at: row.at, ...(row.tenantId ? { tenantId: row.tenantId } : {}) });
    const [accounts] = await this.pool.query('SELECT id, person_id AS personId, email, password_hash AS passwordHash, created_at AS createdAt, mfa_enabled AS mfaEnabled, mfa_secret_ciphertext AS mfaSecretCiphertext, recovery_codes_json AS recoveryCodesJson FROM auth_accounts');
    for (const row of accounts as Array<{ id: string; personId: string; email: string; passwordHash: string; createdAt: string; mfaEnabled: number; mfaSecretCiphertext: string | null; recoveryCodesJson: string }>) this.accounts.set(row.id, { id: row.id, personId: row.personId, email: row.email, passwordHash: row.passwordHash, createdAt: row.createdAt, mfaEnabled: Boolean(row.mfaEnabled), recoveryCodeHashes: JSON.parse(row.recoveryCodesJson) as string[], ...(row.mfaSecretCiphertext ? { mfaSecretCiphertext: row.mfaSecretCiphertext } : {}) });
    const [sessions] = await this.pool.query('SELECT id, account_id AS accountId, token_hash AS tokenHash, expires_at AS expiresAt, mfa_verified_at AS mfaVerifiedAt FROM auth_sessions');
    for (const row of sessions as Array<AuthSession & { mfaVerifiedAt: string | null }>) this.sessions.set(row.id, { id: row.id, accountId: row.accountId, tokenHash: row.tokenHash, expiresAt: row.expiresAt, ...(row.mfaVerifiedAt ? { mfaVerifiedAt: row.mfaVerifiedAt } : {}) });
    const [invitations] = await this.pool.query('SELECT id, tenant_id AS tenantId, person_id AS personId, token_hash AS tokenHash, expires_at AS expiresAt, created_at AS createdAt, accepted_at AS acceptedAt FROM employee_invitations');
    for (const row of invitations as Array<EmployeeInvitation & { acceptedAt: string | null }>) this.invitations.set(row.id, { id: row.id, tenantId: row.tenantId, personId: row.personId, tokenHash: row.tokenHash, expiresAt: row.expiresAt, createdAt: row.createdAt, ...(row.acceptedAt ? { acceptedAt: row.acceptedAt } : {}) });
    for (const document of this.documents.values()) if (!this.documentQuality.has(document.id)) this.documentQuality.set(document.id, { documentId: document.id, status: 'passed', reasons: [], analyzedAt: new Date().toISOString(), reviewStatus: 'not_required' });
  }

  private async persistSnapshot(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM access_request_items');
      await connection.query('DELETE FROM access_requests');
      await connection.query('DELETE FROM grants');
      await connection.query('DELETE FROM document_quality');
      await connection.query('DELETE FROM document_files');
      await connection.query('DELETE FROM documents');
      await connection.query('DELETE FROM employee_invitations');
      await connection.query('DELETE FROM memberships');
      await connection.query('DELETE FROM auth_sessions');
      await connection.query('DELETE FROM auth_accounts');
      await connection.query('DELETE FROM audit_events');
      await connection.query('DELETE FROM people');
      await connection.query('DELETE FROM tenants');
      for (const item of this.tenants.values()) await connection.execute('INSERT INTO tenants (id, name) VALUES (?, ?)', [item.id, item.name]);
      for (const item of this.people.values()) await connection.execute('INSERT INTO people (id, name, email) VALUES (?, ?, ?)', [item.id, item.name, item.email]);
      for (const item of this.memberships.values()) await connection.execute('INSERT INTO memberships (id, tenant_id, person_id, role) VALUES (?, ?, ?, ?)', [item.id, item.tenantId, item.personId, item.role]);
      for (const item of this.documents.values()) await connection.execute('INSERT INTO documents (id, person_id, document_kind, version_id, available) VALUES (?, ?, ?, ?, ?)', [item.id, item.personId, item.documentKind, item.versionId, item.available ? 1 : 0]);
      for (const item of this.storedFiles.values()) await connection.execute('INSERT INTO document_files (document_id, storage_key, original_name, mime_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [item.documentId, item.storageKey, item.originalName, item.mimeType, item.sizeBytes, item.sha256, item.createdAt]);
      for (const item of this.documentQuality.values()) await connection.execute('INSERT INTO document_quality (document_id, status, reasons_json, analyzed_at, review_status, review_notes, reviewed_at, reviewed_by_membership_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [item.documentId, item.status, JSON.stringify(item.reasons), item.analyzedAt, item.reviewStatus, item.reviewNotes ?? null, item.reviewedAt ?? null, item.reviewedByMembershipId ?? null]);
      for (const item of this.requests.values()) {
        await connection.execute('INSERT INTO access_requests (id, tenant_id, person_id, requested_by_membership_id, purpose, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [item.id, item.tenantId, item.personId, item.requestedByMembershipId, item.purpose, item.status, item.expiresAt]);
        for (const requestItem of item.items) await connection.execute('INSERT INTO access_request_items (request_id, document_kind, status) VALUES (?, ?, ?)', [item.id, requestItem.documentKind, requestItem.status]);
      }
      for (const item of this.grants.values()) await connection.execute('INSERT INTO grants (id, tenant_id, person_id, access_request_id, document_kind, document_version_id, purpose, granted_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [item.id, item.tenantId, item.personId, item.accessRequestId, item.documentKind, item.documentVersionId, item.purpose, item.grantedAt, item.expiresAt, item.revokedAt ?? null]);
      for (const item of this.audit) await connection.execute('INSERT INTO audit_events (action, subject_id, tenant_id, at) VALUES (?, ?, ?, ?)', [item.action, item.subjectId, item.tenantId ?? null, item.at]);
      for (const item of this.accounts.values()) await connection.execute('INSERT INTO auth_accounts (id, person_id, email, password_hash, created_at, mfa_enabled, mfa_secret_ciphertext, recovery_codes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [item.id, item.personId, item.email, item.passwordHash, item.createdAt, item.mfaEnabled ? 1 : 0, item.mfaSecretCiphertext ?? null, JSON.stringify(item.recoveryCodeHashes)]);
      for (const item of this.sessions.values()) await connection.execute('INSERT INTO auth_sessions (id, account_id, token_hash, expires_at, mfa_verified_at) VALUES (?, ?, ?, ?, ?)', [item.id, item.accountId, item.tokenHash, item.expiresAt, item.mfaVerifiedAt ?? null]);
      for (const item of this.invitations.values()) await connection.execute('INSERT INTO employee_invitations (id, tenant_id, person_id, token_hash, expires_at, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [item.id, item.tenantId, item.personId, item.tokenHash, item.expiresAt, item.createdAt, item.acceptedAt ?? null]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
