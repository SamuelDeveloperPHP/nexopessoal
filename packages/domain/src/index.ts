export const roles = [
  'administrator',
  'hr',
  'manager',
  'employee',
  'read_only',
] as const;

export type Role = (typeof roles)[number];

export const documentKinds = [
  'cpf',
  'work_card',
  'driver_license',
  'certificate',
  'diploma',
  'vaccination_card',
  'aso',
  'profile_photo',
] as const;

export type DocumentKind = (typeof documentKinds)[number];

export const requestStatuses = [
  'pending',
  'partially_approved',
  'approved',
  'denied',
  'expired',
  'revoked',
] as const;

export type RequestStatus = (typeof requestStatuses)[number];

export type AccessRequestItem = {
  documentKind: DocumentKind;
  requestedVersionId?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';
};

export type AccessRequest = {
  id: string;
  tenantId: string;
  personId: string;
  requestedByMembershipId: string;
  purpose: 'admission' | 'audit' | 'custom';
  items: AccessRequestItem[];
  status: RequestStatus;
  expiresAt: string;
};

export type DocumentRecord = {
  id: string;
  personId: string;
  documentKind: DocumentKind;
  versionId: string;
  available: boolean;
};

export type DocumentQuality = {
  documentId: string;
  status: 'passed' | 'failed';
  reasons: string[];
  analyzedAt: string;
  reviewStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  reviewNotes?: string;
  reviewedAt?: string;
  reviewedByMembershipId?: string;
};

export type DocumentGrant = {
  id: string;
  tenantId: string;
  personId: string;
  accessRequestId: string;
  documentKind: DocumentKind;
  documentVersionId: string;
  purpose: AccessRequest['purpose'];
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export function isRole(value: string): value is Role {
  return (roles as readonly string[]).includes(value);
}

export function isDocumentKind(value: string): value is DocumentKind {
  return (documentKinds as readonly string[]).includes(value);
}
