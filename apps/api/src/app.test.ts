import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from './app.js';
import { totpCode } from './mfa.js';
import { DemoStore } from './store.js';

async function json(response: { body: string }): Promise<Record<string, any>> {
  return JSON.parse(response.body) as Record<string, any>;
}

function multipartDocument(documentKind: string, filename: string, mimeType: string, contents: Buffer) {
  const boundary = '----nexopessoal-test-boundary';
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="documentKind"\r\n\r\n${documentKind}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    contents,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

test('funcionário aprova documento e empresa acessa somente a concessão', async () => {
  const app = createApp();
  const tenantA = await app.inject({ method: 'POST', url: '/tenants', payload: { name: 'Empresa A' } });
  const tenantB = await app.inject({ method: 'POST', url: '/tenants', payload: { name: 'Empresa B' } });
  const personResponse = await app.inject({ method: 'POST', url: '/people', payload: { name: 'Samuel Teste', email: 'samuel@example.test' } });
  const tenant = await json(tenantA);
  const otherTenant = await json(tenantB);
  const person = await json(personResponse);
  const membershipResponse = await app.inject({
    method: 'POST',
    url: `/tenants/${tenant.id}/memberships`,
    payload: { personId: person.id, role: 'hr' },
  });
  const membership = await json(membershipResponse);
  await app.inject({ method: 'POST', url: `/people/${person.id}/documents`, payload: { documentKind: 'cpf' } });

  const requestResponse = await app.inject({
    method: 'POST',
    url: `/tenants/${tenant.id}/access-requests`,
    payload: {
      personId: person.id,
      requestedByMembershipId: membership.id,
      purpose: 'admission',
      items: [{ documentKind: 'cpf' }],
    },
  });
  const accessRequest = await json(requestResponse);
  assert.equal(requestResponse.statusCode, 201);

  const decisionResponse = await app.inject({
    method: 'POST',
    url: `/access-requests/${accessRequest.id}/decision`,
    payload: { personId: person.id, decisions: [{ documentKind: 'cpf', decision: 'approve' }] },
  });
  assert.equal(decisionResponse.statusCode, 200);
  assert.equal((await json(decisionResponse)).status, 'approved');

  const visibleToA = await app.inject({ method: 'GET', url: `/tenants/${tenant.id}/grants?personId=${person.id}` });
  const visibleToB = await app.inject({ method: 'GET', url: `/tenants/${otherTenant.id}/grants?personId=${person.id}` });
  assert.equal((await json(visibleToA)).length, 1);
  assert.equal((await json(visibleToB)).length, 0);
  await app.close();
});

test('perfil somente leitura não pode solicitar documentos', async () => {
  const app = createApp();
  const tenant = await json(await app.inject({ method: 'POST', url: '/tenants', payload: { name: 'Empresa A' } }));
  const person = await json(await app.inject({ method: 'POST', url: '/people', payload: { name: 'Pessoa Teste', email: 'pessoa@example.test' } }));
  const membership = await json(await app.inject({
    method: 'POST',
    url: `/tenants/${tenant.id}/memberships`,
    payload: { personId: person.id, role: 'read_only' },
  }));
  const response = await app.inject({
    method: 'POST',
    url: `/tenants/${tenant.id}/access-requests`,
    payload: {
      personId: person.id,
      requestedByMembershipId: membership.id,
      purpose: 'audit',
      items: [{ documentKind: 'cpf' }],
    },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('funcionário pode revogar concessão', async () => {
  const app = createApp();
  const tenant = await json(await app.inject({ method: 'POST', url: '/tenants', payload: { name: 'Empresa A' } }));
  const person = await json(await app.inject({ method: 'POST', url: '/people', payload: { name: 'Pessoa Teste', email: 'revogar@example.test' } }));
  const membership = await json(await app.inject({
    method: 'POST',
    url: `/tenants/${tenant.id}/memberships`,
    payload: { personId: person.id, role: 'administrator' },
  }));
  await app.inject({ method: 'POST', url: `/people/${person.id}/documents`, payload: { documentKind: 'diploma' } });
  const request = await json(await app.inject({
    method: 'POST',
    url: `/tenants/${tenant.id}/access-requests`,
    payload: {
      personId: person.id,
      requestedByMembershipId: membership.id,
      purpose: 'custom',
      items: [{ documentKind: 'diploma' }],
    },
  }));
  await app.inject({
    method: 'POST',
    url: `/access-requests/${request.id}/decision`,
    payload: { personId: person.id, decisions: [{ documentKind: 'diploma', decision: 'approve' }] },
  });
  const grants = await json(await app.inject({ method: 'GET', url: `/tenants/${tenant.id}/grants` }));
  const revoke = await app.inject({ method: 'POST', url: `/grants/${grants[0].id}/revoke`, payload: { personId: person.id } });
  assert.equal(revoke.statusCode, 200);
  const after = await json(await app.inject({ method: 'GET', url: `/tenants/${tenant.id}/grants` }));
  assert.equal(after.length, 0);
  await app.close();
});

test('reutiliza a identidade global quando a pessoa entra em outra empresa', async () => {
  const app = createApp();
  const firstTenant = await json(await app.inject({ method: 'POST', url: '/tenants', payload: { name: 'Empresa A' } }));
  const secondTenant = await json(await app.inject({ method: 'POST', url: '/tenants', payload: { name: 'Empresa B' } }));
  const first = await json(await app.inject({
    method: 'POST',
    url: `/tenants/${firstTenant.id}/people`,
    payload: { name: 'Pessoa Compartilhada', email: 'compartilhada@example.test' },
  }));
  const second = await json(await app.inject({
    method: 'POST',
    url: `/tenants/${secondTenant.id}/people`,
    payload: { name: 'Pessoa Compartilhada', email: 'compartilhada@example.test' },
  }));
  assert.equal(first.person.id, second.person.id);
  assert.equal(second.reusedPerson, true);
  const peopleB = await json(await app.inject({ method: 'GET', url: `/tenants/${secondTenant.id}/people` }));
  assert.equal(peopleB.length, 1);
  assert.equal(peopleB[0].role, 'employee');
  await app.close();
});

test('protege a API quando a autenticação está ativada', async () => {
  const app = createApp(new DemoStore(), { requireAuth: true });
  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { tenantName: 'Empresa Segura', name: 'Joana RH', email: 'joana@segura.test', password: 'senha-local-com-12' },
  });
  assert.equal(registration.statusCode, 201);
  const session = await json(registration);
  const unauthenticated = await app.inject({ method: 'GET', url: `/tenants/${session.context.tenantId}/access-requests` });
  assert.equal(unauthenticated.statusCode, 401);
  const authenticated = await app.inject({ method: 'GET', url: `/tenants/${session.context.tenantId}/access-requests`, headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(authenticated.statusCode, 200);
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'joana@segura.test', password: 'senha-local-com-12' } });
  assert.equal(login.statusCode, 200);
  const wrongPassword = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'joana@segura.test', password: 'senha-incorreta' } });
  assert.equal(wrongPassword.statusCode, 401);
  await app.close();
});

test('expõe readiness seguro e revoga a sessão no logout', async () => {
  const app = createApp(new DemoStore(), { requireAuth: true, runtimeMode: 'staging' });
  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { tenantName: 'Empresa Logout', name: 'Pessoa Logout', email: 'logout@example.test', password: 'senha-local-com-12' },
  });
  const session = await json(registration);
  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.equal((await json(ready)).status, 'ready');
  assert.equal(ready.headers['x-content-type-options'], 'nosniff');
  const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(logout.statusCode, 204);
  const afterLogout = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(afterLogout.statusCode, 401);
  await app.close();
});

test('bloqueia reset de demonstração quando a autenticação está ativada', async () => {
  const app = createApp(new DemoStore(), { requireAuth: true });
  const reset = await app.inject({ method: 'POST', url: '/demo/reset' });
  assert.equal(reset.statusCode, 401);
  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { tenantName: 'Empresa Sem Reset', name: 'Pessoa Sem Reset', email: 'no-reset@example.test', password: 'senha-local-com-12' },
  });
  const session = await json(registration);
  const protectedReset = await app.inject({ method: 'POST', url: '/demo/reset', headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(protectedReset.statusCode, 404);
  await app.close();
});

test('impede que perfis sem gestão criem funcionários ou alterem vínculos', async () => {
  const app = createApp(new DemoStore(), { requireAuth: true });
  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { tenantName: 'Empresa Perfis', name: 'RH Perfis', email: 'rh-perfis@example.test', password: 'senha-local-com-12' },
  });
  const session = await json(registration);
  const employee = await json(await app.inject({
    method: 'POST',
    url: `/tenants/${session.context.tenantId}/people`,
    headers: { authorization: `Bearer ${session.token}` },
    payload: { name: 'Funcionário Perfil', email: 'funcionario-perfil@example.test' },
  }));
  const readOnlyMembership = await app.inject({
    method: 'POST',
    url: `/tenants/${session.context.tenantId}/memberships`,
    headers: { authorization: `Bearer ${session.token}` },
    payload: { personId: employee.person.id, role: 'read_only' },
  });
  assert.equal(readOnlyMembership.statusCode, 201);
  const invitation = await json(await app.inject({
    method: 'POST',
    url: `/tenants/${session.context.tenantId}/people/${employee.person.id}/invitation`,
    headers: { authorization: `Bearer ${session.token}` },
  }));
  const readOnlySession = await json(await app.inject({ method: 'POST', url: '/auth/accept-invitation', payload: { token: invitation.token, password: 'senha-read-only-12' } }));
  const asReadOnly = await app.inject({
    method: 'POST',
    url: `/tenants/${session.context.tenantId}/people`,
    headers: { authorization: `Bearer ${readOnlySession.token}` },
    payload: { name: 'Outro Funcionário', email: 'outro-perfil@example.test' },
  });
  assert.equal(asReadOnly.statusCode, 403);
  const invalidMembership = await app.inject({
    method: 'POST',
    url: `/tenants/${session.context.tenantId}/memberships`,
    headers: { authorization: `Bearer ${readOnlySession.token}` },
    payload: { personId: employee.person.id, role: 'manager' },
  });
  assert.equal(invalidMembership.statusCode, 403);
  await app.close();
});

test('exige TOTP no login e aceita código de recuperação de uso único', async () => {
  const app = createApp(new DemoStore({ mfaKey: 'test-mfa-key' }), { requireAuth: true });
  const registration = await app.inject({ method: 'POST', url: '/auth/register', payload: { tenantName: 'Empresa MFA', name: 'Pessoa MFA', email: 'mfa@example.test', password: 'senha-local-com-12' } });
  assert.equal(registration.statusCode, 201);
  const firstSession = await json(registration);
  const setup = await app.inject({ method: 'POST', url: '/auth/mfa/setup', headers: { authorization: `Bearer ${firstSession.token}` } });
  assert.equal(setup.statusCode, 200);
  const setupPayload = await json(setup);
  assert.match(setupPayload.otpauthUri, /^otpauth:\/\/totp\//);
  const enabled = await app.inject({ method: 'POST', url: '/auth/mfa/enable', headers: { authorization: `Bearer ${firstSession.token}` }, payload: { code: totpCode(setupPayload.secret) } });
  assert.equal(enabled.statusCode, 200);
  const enabledPayload = await json(enabled);
  assert.equal(enabledPayload.recoveryCodes.length, 8);
  const oldSession = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${firstSession.token}` } });
  assert.equal(oldSession.statusCode, 401);

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'mfa@example.test', password: 'senha-local-com-12' } });
  assert.equal(login.statusCode, 202);
  const challenge = await json(login);
  const verified = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { challengeToken: challenge.challengeToken, code: enabledPayload.recoveryCodes[0] } });
  assert.equal(verified.statusCode, 200);
  const verifiedPayload = await json(verified);
  assert.equal(verifiedPayload.mfa.enabled, true);
  const reused = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { challengeToken: challenge.challengeToken, code: enabledPayload.recoveryCodes[0] } });
  assert.equal(reused.statusCode, 401);
  await app.close();
});

test('restaura tenants, pessoas e solicitações a partir do SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexopessoal-'));
  const dbPath = join(directory, 'test.sqlite');
  const firstStore = new DemoStore({ dbPath });
  const firstApp = createApp(firstStore);
  const tenant = await json(await firstApp.inject({ method: 'POST', url: '/tenants', payload: { name: 'Empresa Persistente' } }));
  const person = await json(await firstApp.inject({ method: 'POST', url: '/people', payload: { name: 'Pessoa Persistente', email: 'persistente@test.test' } }));
  const membership = await json(await firstApp.inject({ method: 'POST', url: `/tenants/${tenant.id}/memberships`, payload: { personId: person.id, role: 'hr' } }));
  await firstApp.inject({ method: 'POST', url: `/people/${person.id}/documents`, payload: { documentKind: 'cpf' } });
  await firstApp.inject({ method: 'POST', url: `/tenants/${tenant.id}/access-requests`, payload: { personId: person.id, requestedByMembershipId: membership.id, purpose: 'admission', items: [{ documentKind: 'cpf' }] } });
  await firstApp.close();
  firstStore.close();

  const secondStore = new DemoStore({ dbPath });
  const secondApp = createApp(secondStore);
  const people = await json(await secondApp.inject({ method: 'GET', url: `/tenants/${tenant.id}/people` }));
  const requests = await json(await secondApp.inject({ method: 'GET', url: `/tenants/${tenant.id}/access-requests` }));
  assert.equal(people[0].email, 'persistente@test.test');
  assert.equal(requests.length, 1);
  await secondApp.close();
  secondStore.close();
  rmSync(directory, { recursive: true, force: true });
});

test('aceita apenas arquivos com assinatura válida e entrega o arquivo ao titular', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexopessoal-files-'));
  const app = createApp(new DemoStore(), { requireAuth: true, storageRoot: directory });
  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { tenantName: 'Empresa Arquivos', name: 'Titular Teste', email: 'titular@arquivos.test', password: 'senha-local-com-12' },
  });
  const session = await json(registration);
  const pdf = multipartDocument('cpf', 'cpf.pdf', 'application/pdf', Buffer.from('%PDF-1.7\narquivo ficticio'));
  const upload = await app.inject({ method: 'POST', url: `/people/${session.person.id}/documents/upload`, headers: { authorization: `Bearer ${session.token}`, 'content-type': pdf.contentType }, payload: pdf.body });
  assert.equal(upload.statusCode, 201);
  const uploaded = await json(upload);
  assert.equal(uploaded.file.mimeType, 'application/pdf');
  assert.equal(uploaded.file.sizeBytes, Buffer.byteLength('%PDF-1.7\narquivo ficticio'));
  const content = await app.inject({ method: 'GET', url: `/documents/${uploaded.id}/content`, headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(content.statusCode, 200);
  assert.match(content.body, /^%PDF-1\.7/);
  const invalid = multipartDocument('cpf', 'fake.jpg', 'image/jpeg', Buffer.from('not-an-image'));
  const rejected = await app.inject({ method: 'POST', url: `/people/${session.person.id}/documents/upload`, headers: { authorization: `Bearer ${session.token}`, 'content-type': invalid.contentType }, payload: invalid.body });
  assert.equal(rejected.statusCode, 415);
  const unauthenticated = await app.inject({ method: 'GET', url: `/documents/${uploaded.id}/content` });
  assert.equal(unauthenticated.statusCode, 401);
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

test('cria convite tokenizado e permite ao funcionário criar a própria sessão', async () => {
  const app = createApp(new DemoStore(), { requireAuth: true });
  const hr = await json(await app.inject({ method: 'POST', url: '/auth/register', payload: { tenantName: 'Empresa Convites', name: 'RH Convites', email: 'rh@convites.test', password: 'senha-local-com-12' } }));
  const employee = await json(await app.inject({ method: 'POST', url: `/tenants/${hr.context.tenantId}/people`, headers: { authorization: `Bearer ${hr.token}` }, payload: { name: 'Funcionário Convidado', email: 'funcionario@convites.test' } }));
  await app.inject({ method: 'POST', url: `/tenants/${hr.context.tenantId}/access-requests`, headers: { authorization: `Bearer ${hr.token}` }, payload: { personId: employee.person.id, requestedByMembershipId: hr.context.membershipId, purpose: 'admission', items: [{ documentKind: 'cpf' }] } });
  const invitationResponse = await app.inject({ method: 'POST', url: `/tenants/${hr.context.tenantId}/people/${employee.person.id}/invitation`, headers: { authorization: `Bearer ${hr.token}` } });
  assert.equal(invitationResponse.statusCode, 201);
  const invitation = await json(invitationResponse);
  const accepted = await app.inject({ method: 'POST', url: '/auth/accept-invitation', payload: { token: invitation.token, password: 'senha-funcionario-12' } });
  assert.equal(accepted.statusCode, 200);
  const employeeSession = await json(accepted);
  assert.equal(employeeSession.context.personId, employee.person.id);
  const requests = await app.inject({ method: 'GET', url: `/people/${employee.person.id}/access-requests`, headers: { authorization: `Bearer ${employeeSession.token}` } });
  assert.equal(requests.statusCode, 200);
  assert.equal((await json(requests)).length, 1);
  const reused = await app.inject({ method: 'POST', url: '/auth/accept-invitation', payload: { token: invitation.token, password: 'outra-senha-12' } });
  assert.equal(reused.statusCode, 409);
  await app.close();
});

test('bloqueia concessão de documento reprovado até a revisão do RH', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexopessoal-quality-'));
  const app = createApp(new DemoStore(), { requireAuth: true, storageRoot: directory });
  const hr = await json(await app.inject({ method: 'POST', url: '/auth/register', payload: { tenantName: 'Empresa Qualidade', name: 'RH Qualidade', email: 'rh@qualidade.test', password: 'senha-local-com-12' } }));
  const employee = await json(await app.inject({ method: 'POST', url: `/tenants/${hr.context.tenantId}/people`, headers: { authorization: `Bearer ${hr.token}` }, payload: { name: 'Pessoa Qualidade', email: 'pessoa@qualidade.test' } }));
  const request = await json(await app.inject({ method: 'POST', url: `/tenants/${hr.context.tenantId}/access-requests`, headers: { authorization: `Bearer ${hr.token}` }, payload: { personId: employee.person.id, requestedByMembershipId: hr.context.membershipId, purpose: 'admission', items: [{ documentKind: 'cpf' }] } }));
  const invitation = await json(await app.inject({ method: 'POST', url: `/tenants/${hr.context.tenantId}/people/${employee.person.id}/invitation`, headers: { authorization: `Bearer ${hr.token}` } }));
  const employeeSession = await json(await app.inject({ method: 'POST', url: '/auth/accept-invitation', payload: { token: invitation.token, password: 'senha-funcionario-12' } }));
  const invalidPdf = multipartDocument('cpf', 'cpf.pdf', 'application/pdf', Buffer.from('%PDF-1.7 sem marcador'));
  const upload = await json(await app.inject({ method: 'POST', url: `/people/${employee.person.id}/documents/upload`, headers: { authorization: `Bearer ${employeeSession.token}`, 'content-type': invalidPdf.contentType }, payload: invalidPdf.body }));
  assert.equal(upload.quality.status, 'failed');
  const blocked = await app.inject({ method: 'POST', url: `/access-requests/${request.id}/decision`, headers: { authorization: `Bearer ${employeeSession.token}` }, payload: { personId: employee.person.id, decisions: [{ documentKind: 'cpf', decision: 'approve' }] } });
  assert.equal(blocked.statusCode, 422);
  const review = await app.inject({ method: 'POST', url: `/documents/${upload.id}/review`, headers: { authorization: `Bearer ${hr.token}` }, payload: { decision: 'approve', notes: 'Conferido manualmente no ambiente de teste.' } });
  assert.equal(review.statusCode, 200);
  const approved = await app.inject({ method: 'POST', url: `/access-requests/${request.id}/decision`, headers: { authorization: `Bearer ${employeeSession.token}` }, payload: { personId: employee.person.id, decisions: [{ documentKind: 'cpf', decision: 'approve' }] } });
  assert.equal(approved.statusCode, 200);
  const grants = await app.inject({ method: 'GET', url: `/tenants/${hr.context.tenantId}/grants`, headers: { authorization: `Bearer ${hr.token}` } });
  assert.equal((await json(grants)).length, 1);
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
