import type { AccessRequest, DocumentKind } from './types.js';

export const documentLabels: Record<DocumentKind, string> = {
  cpf: 'CPF', work_card: 'Carteira de trabalho', driver_license: 'CNH', certificate: 'Certificado', diploma: 'Diploma', vaccination_card: 'Carteira de vacinação', aso: 'ASO', profile_photo: 'Foto 3x4',
};

export function statusLabel(status: AccessRequest['status'] | AccessRequest['items'][number]['status']): string {
  const labels: Record<string, string> = { pending: 'Aguardando sua resposta', partially_approved: 'Resposta parcial', approved: 'Compartilhamento aprovado', denied: 'Não compartilhado', expired: 'Expirada', revoked: 'Revogada' };
  return labels[status] ?? status;
}

export function requestedCount(requests: AccessRequest[]): number { return requests.reduce((total, request) => total + request.items.filter((item) => item.status === 'pending').length, 0); }
