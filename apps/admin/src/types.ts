export type DocumentKind =
  | 'cpf'
  | 'work_card'
  | 'driver_license'
  | 'certificate'
  | 'diploma'
  | 'vaccination_card'
  | 'aso'
  | 'profile_photo';

export type RequestItem = {
  documentKind: DocumentKind;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';
};

export type AccessRequest = {
  id: string;
  tenantId: string;
  personId: string;
  purpose: 'admission' | 'audit' | 'custom';
  status: 'pending' | 'partially_approved' | 'approved' | 'denied' | 'expired' | 'revoked';
  items: RequestItem[];
  expiresAt: string;
};

export type DocumentQuality = {
  status: 'passed' | 'failed';
  reasons: string[];
  analyzedAt: string;
  reviewStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  reviewNotes?: string;
};

export type DocumentRecord = {
  id: string;
  personId: string;
  documentKind: DocumentKind;
  versionId: string;
  available: boolean;
  file?: { originalName: string; mimeType: string; sizeBytes: number; sha256: string; createdAt: string };
  quality?: DocumentQuality;
};

export type DemoContext = {
  tenantId: string;
  tenantName: string;
  hrMembershipId: string;
  personId: string;
  personName: string;
};

export type AuthSession = {
  token: string;
  context: DemoContext;
};

export type MfaChallenge = {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
};

export type Person = {
  id: string;
  name: string;
  email: string;
  role: string;
  membershipId: string;
};
