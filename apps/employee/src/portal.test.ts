import assert from 'node:assert/strict';
import test from 'node:test';
import { documentLabels, requestedCount, statusLabel } from './portal.js';

test('resume pendências para o funcionário', () => {
  assert.equal(requestedCount([{ id: '1', tenantId: 't', personId: 'p', purpose: 'admission', status: 'pending', expiresAt: '', items: [{ documentKind: 'cpf', status: 'pending' }, { documentKind: 'aso', status: 'approved' }] }]), 1);
  assert.equal(documentLabels.profile_photo, 'Foto 3x4');
  assert.equal(statusLabel('pending'), 'Aguardando sua resposta');
});
