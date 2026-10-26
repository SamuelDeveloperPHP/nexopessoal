import assert from 'node:assert/strict';
import test from 'node:test';
import { requestStatusLabel, summarize } from './dashboard.js';
import type { AccessRequest } from './types.js';

const requests: AccessRequest[] = [{
  id: 'request-1',
  tenantId: 'tenant-1',
  personId: 'person-1',
  purpose: 'admission',
  status: 'pending',
  expiresAt: '2026-11-01T00:00:00.000Z',
  items: [
    { documentKind: 'cpf', status: 'pending' },
    { documentKind: 'work_card', status: 'approved' },
  ],
}];

test('resume a fila de solicitações para o painel de RH', () => {
  assert.deepEqual(summarize(requests), { open: 1, waitingDocuments: 1, approved: 1, revoked: 0 });
});

test('traduz status técnicos para linguagem do RH', () => {
  assert.equal(requestStatusLabel('pending'), 'Aguardando funcionário');
  assert.equal(requestStatusLabel('approved'), 'Autorizado');
});
