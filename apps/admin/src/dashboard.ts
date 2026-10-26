import type { AccessRequest, DocumentKind } from './types.js';

export const documentLabels: Record<DocumentKind, string> = {
  cpf: 'CPF',
  work_card: 'Carteira de trabalho',
  driver_license: 'CNH',
  certificate: 'Certificado',
  diploma: 'Diploma',
  vaccination_card: 'Carteira de vacinação',
  aso: 'ASO',
  profile_photo: 'Foto 3×4',
};

export function summarize(requests: AccessRequest[]) {
  return {
    open: requests.filter((request) => ['pending', 'partially_approved'].includes(request.status)).length,
    waitingDocuments: requests.reduce(
      (total, request) => total + request.items.filter((item) => item.status === 'pending').length,
      0,
    ),
    approved: requests.reduce(
      (total, request) => total + request.items.filter((item) => item.status === 'approved').length,
      0,
    ),
    revoked: requests.reduce(
      (total, request) => total + request.items.filter((item) => item.status === 'revoked').length,
      0,
    ),
  };
}

export function requestStatusLabel(status: AccessRequest['status']) {
  const labels: Record<AccessRequest['status'], string> = {
    pending: 'Aguardando funcionário',
    partially_approved: 'Parcialmente autorizado',
    approved: 'Autorizado',
    denied: 'Recusado',
    expired: 'Expirado',
    revoked: 'Revogado',
  };
  return labels[status];
}

export function itemStatusLabel(status: AccessRequest['items'][number]['status']) {
  const labels: Record<AccessRequest['items'][number]['status'], string> = {
    pending: 'Aguardando',
    approved: 'Autorizado',
    denied: 'Recusado',
    expired: 'Expirado',
    revoked: 'Revogado',
  };
  return labels[status];
}
