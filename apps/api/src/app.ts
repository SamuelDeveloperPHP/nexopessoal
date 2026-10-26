import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep as pathSeparator } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { documentKinds, isDocumentKind, isRole, type AccessRequest, type Role } from '@nexopessoal/domain';
import { DemoStore, type AuthPrincipal } from './store.js';
import { analyzeDocument } from './quality.js';

const createTenantSchema = z.object({ name: z.string().trim().min(2).max(120) });
const createPersonSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
});
const createEmployeeSchema = createPersonSchema;
const registerSchema = z.object({
  tenantName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(12).max(200),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(24) });
const invitationSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(12).max(200) });
const membershipSchema = z.object({ personId: z.string().uuid(), role: z.string() });
const documentSchema = z.object({ documentKind: z.string() });
const requestSchema = z.object({
  personId: z.string().uuid(),
  requestedByMembershipId: z.string().uuid(),
  purpose: z.enum(['admission', 'audit', 'custom']),
  items: z.array(z.object({ documentKind: z.string() })).min(1),
  expiresAt: z.string().datetime().optional(),
});
const decisionSchema = z.object({
  personId: z.string().uuid(),
  decisions: z.array(z.object({
    documentKind: z.string(),
    decision: z.enum(['approve', 'deny']),
  })).min(1),
});
const reviewSchema = z.object({ decision: z.enum(['approve', 'reject']), notes: z.string().trim().max(1000).optional() });

const companyRoles = new Set<Role>(['administrator', 'hr', 'manager']);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const supportedFileTypes = new Map([
  ['application/pdf', { extension: '.pdf', signature: (buffer: Buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' }],
  ['image/jpeg', { extension: '.jpg', signature: (buffer: Buffer) => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) }],
  ['image/png', { extension: '.png', signature: (buffer: Buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ['image/webp', { extension: '.webp', signature: (buffer: Buffer) => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' }],
]);
type AppOptions = {
  requireAuth?: boolean;
  storageRoot?: string;
  corsOrigins?: string[];
  allowDemoReset?: boolean;
  runtimeMode?: 'demo' | 'staging' | 'production';
};
type AuthenticatedRequest = FastifyRequest & { principal?: AuthPrincipal };

function principalOf(request: FastifyRequest): AuthPrincipal | undefined {
  return (request as AuthenticatedRequest).principal;
}

function sessionPayload(token: string, principal: AuthPrincipal, store: DemoStore) {
  const membership = principal.memberships.find((item) => companyRoles.has(item.role)) ?? principal.memberships[0];
  return {
    token,
    person: principal.person,
    memberships: principal.memberships,
    mfa: { enabled: principal.account.mfaEnabled },
    context: membership ? {
      tenantId: membership.tenantId,
      membershipId: membership.id,
      tenantName: store.tenants.get(membership.tenantId)?.name ?? 'Empresa',
      personId: principal.person.id,
      personName: principal.person.name,
    } : undefined,
  };
}

function badRequest(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, message: string) {
  return reply.code(400).send({ error: message });
}

export function createApp(store = new DemoStore(), options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: options.corsOrigins ?? true });
  void app.register(multipart, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 4, parts: 8 } });
  const requireAuth = options.requireAuth ?? false;
  const allowDemoReset = options.allowDemoReset ?? !requireAuth;
  const runtimeMode = options.runtimeMode ?? (requireAuth ? 'staging' : 'demo');
  const storageRoot = resolve(options.storageRoot ?? './data/documents');

  app.addHook('onSend', async (request, reply, payload) => {
    await store.waitForPersistence();
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(self), microphone=(), geolocation=()');
    reply.header('cache-control', 'no-store');
    if (request.url.startsWith('/auth/')) reply.header('pragma', 'no-cache');
    return payload;
  });

  function canAccessPerson(request: FastifyRequest, personId: string): boolean {
    if (!requireAuth) return true;
    const principal = principalOf(request);
    if (!principal) return false;
    return principal.person.id === personId || Array.from(store.memberships.values()).some((membership) => membership.personId === personId && principal.memberships.some((mine) => mine.tenantId === membership.tenantId));
  }

  function principalMembership(request: FastifyRequest, tenantId: string) {
    const principal = principalOf(request);
    return principal?.memberships.find((membership) => membership.tenantId === tenantId);
  }

  function hasTenantRole(request: FastifyRequest, tenantId: string, roles: Set<Role>): boolean {
    if (!requireAuth) return true;
    const principal = principalOf(request);
    return Boolean(principal?.memberships.some((membership) => membership.tenantId === tenantId && roles.has(membership.role)));
  }

  function publicDocument(documentId: string) {
    const document = [...store.documents.values()].find((item) => item.id === documentId);
    if (!document) return undefined;
    const file = store.findStoredFile(document.id);
    return { ...document, file: file ? { originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256, createdAt: file.createdAt } : undefined, quality: store.documentQuality.get(document.id) };
  }

  function canShareDocument(documentId: string): boolean {
    const quality = store.documentQuality.get(documentId);
    return Boolean(quality && (quality.status === 'passed' || quality.reviewStatus === 'approved'));
  }

  app.addHook('preHandler', async (request, reply) => {
    const publicRoute = request.url.startsWith('/health') || request.url.startsWith('/ready') || request.url.startsWith('/auth/register') || request.url.startsWith('/auth/login') || request.url.startsWith('/auth/accept-invitation') || request.url.startsWith('/auth/mfa/verify');
    if (!requireAuth || publicRoute) return;
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
    const principal = token ? store.principalFromToken(token) : undefined;
    if (!principal) return reply.code(401).send({ error: 'Sessão ausente ou expirada.' });
    (request as AuthenticatedRequest).principal = principal;
    const tenantId = (request.params as { tenantId?: string } | undefined)?.tenantId;
    if (tenantId && !principal.memberships.some((membership) => membership.tenantId === tenantId)) {
      return reply.code(403).send({ error: 'Você não participa desta empresa.' });
    }
  });

  app.get('/health', async () => ({ status: 'ok', mode: runtimeMode }));

  app.get('/ready', async (_request, reply) => {
    if (store.closed) return reply.code(503).send({ status: 'not_ready' });
    return { status: 'ready', mode: runtimeMode };
  });

  app.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Informe empresa, nome, e-mail e uma senha com pelo menos 12 caracteres.');
    if (store.findPersonByEmail(parsed.data.email) || store.findAccountByEmail(parsed.data.email)) {
      return reply.code(409).send({ error: 'Este e-mail já possui uma identidade no NexoPessoal.' });
    }
    const tenant = store.addTenant(parsed.data.tenantName);
    const person = store.addPerson(parsed.data.name, parsed.data.email);
    const membership = store.addMembership(tenant.id, person.id, 'administrator');
    const account = store.createAccount(person.id, parsed.data.password);
    const token = store.createSession(account.id);
    store.log('auth.registered', account.id, tenant.id);
    store.flush();
    return reply.code(201).send({ token, context: { tenantId: tenant.id, tenantName: tenant.name, membershipId: membership.id, personId: person.id, personName: person.name }, person, memberships: [membership] });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'E-mail ou senha inválidos.');
    const principal = store.authenticate(parsed.data.email, parsed.data.password);
    if (!principal) return reply.code(401).send({ error: 'E-mail ou senha inválidos.' });
    if (principal.account.mfaEnabled) {
      const challenge = store.createMfaChallenge(principal.account.id);
      return reply.code(202).send({ mfaRequired: true, challengeToken: challenge.token, expiresAt: challenge.expiresAt });
    }
    const token = store.createSession(principal.account.id);
    store.flush();
    return sessionPayload(token, principal, store);
  });

  app.post('/auth/mfa/verify', async (request, reply) => {
    const body = request.body as { challengeToken?: unknown; code?: unknown };
    if (typeof body?.challengeToken !== 'string' || body.challengeToken.length < 20) return badRequest(reply, 'Desafio MFA inválido.');
    const parsed = mfaCodeSchema.safeParse({ code: body.code });
    if (!parsed.success) return badRequest(reply, 'Informe o código MFA de seis dígitos ou um código de recuperação.');
    const token = store.completeMfaChallenge(body.challengeToken, parsed.data.code);
    if (!token) return reply.code(401).send({ error: 'Código MFA inválido ou desafio expirado.' });
    const principal = store.principalFromToken(token);
    if (!principal) return reply.code(500).send({ error: 'Não foi possível concluir a sessão MFA.' });
    store.flush();
    return sessionPayload(token, principal, store);
  });

  app.post('/auth/accept-invitation', async (request, reply) => {
    const parsed = invitationSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Convite ou senha inválidos. A senha precisa ter pelo menos 12 caracteres.');
    const invitation = store.findInvitation(parsed.data.token);
    if (!invitation) return reply.code(404).send({ error: 'Convite não encontrado.' });
    if (invitation.acceptedAt) return reply.code(409).send({ error: 'Este convite já foi utilizado.' });
    if (Date.parse(invitation.expiresAt) <= Date.now()) return reply.code(410).send({ error: 'Este convite expirou.' });
    const person = store.people.get(invitation.personId);
    if (!person) return reply.code(404).send({ error: 'Funcionário não encontrado.' });
    if (store.findAccountByEmail(person.email)) return reply.code(409).send({ error: 'Este funcionário já possui acesso.' });
    const account = store.createAccount(person.id, parsed.data.password);
    invitation.acceptedAt = new Date().toISOString();
    const token = store.createSession(account.id);
    store.log('auth.invitation.accepted', account.id, invitation.tenantId);
    store.flush();
    const principal = store.authenticate(person.email, parsed.data.password);
    if (!principal) return reply.code(500).send({ error: 'Não foi possível iniciar a sessão.' });
    return sessionPayload(token, principal, store);
  });

  app.get('/auth/me', async (request, reply) => {
    const principal = principalOf(request);
    if (!principal) return reply.code(401).send({ error: 'Sessão ausente ou expirada.' });
    return sessionPayload('active', principal, store);
  });

  app.post('/auth/mfa/setup', async (request, reply) => {
    const principal = principalOf(request);
    if (!principal) return reply.code(401).send({ error: 'Sessão ausente ou expirada.' });
    if (principal.account.mfaEnabled) return reply.code(409).send({ error: 'O MFA já está ativo nesta conta.' });
    const setup = store.beginMfaSetup(principal.account.id);
    if (!setup) return reply.code(409).send({ error: 'Não foi possível iniciar a configuração do MFA.' });
    store.flush();
    return { ...setup, issuer: 'NexoPessoal', account: principal.account.email };
  });

  app.post('/auth/mfa/enable', async (request, reply) => {
    const principal = principalOf(request);
    if (!principal) return reply.code(401).send({ error: 'Sessão ausente ou expirada.' });
    const parsed = mfaCodeSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Informe o código exibido no aplicativo autenticador.');
    const recoveryCodes = store.enableMfa(principal.account.id, parsed.data.code);
    if (!recoveryCodes) return reply.code(422).send({ error: 'Código inválido ou configuração MFA ainda não iniciada.' });
    const token = store.createSession(principal.account.id, new Date().toISOString());
    const updated = store.principalFromToken(token);
    if (!updated) return reply.code(500).send({ error: 'Não foi possível atualizar a sessão MFA.' });
    store.log('auth.mfa.enabled', principal.account.id);
    store.flush();
    return { ...sessionPayload(token, updated, store), recoveryCodes };
  });

  app.post('/auth/logout', async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
    if (token) store.revokeSession(token);
    store.flush();
    return reply.code(204).send();
  });

  app.post('/demo/reset', async (_request, reply) => {
    if (!allowDemoReset) return reply.code(404).send({ error: 'Rota indisponível neste ambiente.' });
    store.tenants.clear();
    store.people.clear();
    store.memberships.clear();
    store.documents.clear();
    store.storedFiles.clear();
    store.documentQuality.clear();
    store.requests.clear();
    store.grants.clear();
    store.audit.length = 0;
    store.accounts.clear();
    store.sessions.clear();
    store.invitations.clear();
    store.flush();
    return reply.code(204).send();
  });

  app.post('/tenants', async (request, reply) => {
    const parsed = createTenantSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Nome da empresa inválido.');
    const tenant = store.addTenant(parsed.data.name);
    store.flush();
    return reply.code(201).send(tenant);
  });

  app.post('/people', async (request, reply) => {
    const parsed = createPersonSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Dados da pessoa inválidos.');
    const person = store.addPerson(parsed.data.name, parsed.data.email);
    store.flush();
    return reply.code(201).send(person);
  });

  app.get('/tenants/:tenantId/people', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    if (!store.tenants.has(tenantId)) return reply.code(404).send({ error: 'Empresa não encontrada.' });
    return [...store.memberships.values()]
      .filter((membership) => membership.tenantId === tenantId)
      .map((membership) => ({
        ...store.people.get(membership.personId),
        role: membership.role,
        membershipId: membership.id,
      }))
      .filter((person) => person.id);
  });

  app.post('/tenants/:tenantId/people', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parsed = createEmployeeSchema.safeParse(request.body);
    if (!store.tenants.has(tenantId)) return reply.code(404).send({ error: 'Empresa não encontrada.' });
    if (!hasTenantRole(request, tenantId, companyRoles)) return reply.code(403).send({ error: 'Somente RH, gestor ou administrador pode cadastrar funcionários.' });
    if (!parsed.success) return badRequest(reply, 'Nome ou e-mail do funcionário inválido.');
    const existingPerson = store.findPersonByEmail(parsed.data.email);
    const person = existingPerson ?? store.addPerson(parsed.data.name, parsed.data.email);
    const membership = store.findMembership(tenantId, person.id) ?? store.addMembership(tenantId, person.id, 'employee');
    store.flush();
    return reply.code(201).send({ person, membership, reusedPerson: Boolean(existingPerson) });
  });

  app.post('/tenants/:tenantId/people/:personId/invitation', async (request, reply) => {
    const { tenantId, personId } = request.params as { tenantId: string; personId: string };
    const principal = principalOf(request);
    if (requireAuth && (!principal || !principal.memberships.some((membership) => membership.tenantId === tenantId && companyRoles.has(membership.role)))) {
      return reply.code(403).send({ error: 'Somente RH, gestor ou administrador pode gerar convites.' });
    }
    if (!store.tenants.has(tenantId) || !store.people.has(personId) || !store.findMembership(tenantId, personId)) return reply.code(404).send({ error: 'Empresa ou funcionário não encontrado.' });
    const person = store.people.get(personId);
    if (person && store.findAccountByEmail(person.email)) return reply.code(409).send({ error: 'Este funcionário já possui acesso.' });
    const token = store.createInvitation(tenantId, personId);
    const invitation = store.findInvitation(token);
    store.log('employee.invitation.created', personId, tenantId);
    store.flush();
    return reply.code(201).send({ token, expiresAt: invitation?.expiresAt });
  });

  app.post('/tenants/:tenantId/memberships', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parsed = membershipSchema.safeParse(request.body);
    if (!store.tenants.has(tenantId) || !parsed.success || !isRole(parsed.data.role)) {
      return badRequest(reply, 'Empresa, pessoa ou perfil inválido.');
    }
    if (!hasTenantRole(request, tenantId, new Set<Role>(['administrator']))) return reply.code(403).send({ error: 'Somente o administrador pode gerenciar perfis da empresa.' });
    if (!store.people.has(parsed.data.personId)) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    const membership = store.addMembership(tenantId, parsed.data.personId, parsed.data.role);
    store.flush();
    return reply.code(201).send(membership);
  });

  app.post('/people/:personId/documents', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    const parsed = documentSchema.safeParse(request.body);
    if (!store.people.has(personId)) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    if (!parsed.success || !isDocumentKind(parsed.data.documentKind)) {
      return badRequest(reply, `Tipo de documento inválido. Use: ${documentKinds.join(', ')}.`);
    }
    if (!canAccessPerson(request, personId)) {
      return reply.code(403).send({ error: 'Você não pode alterar documentos desta pessoa.' });
    }
    const document = store.addDocument(personId, parsed.data.documentKind);
    store.flush();
    return reply.code(201).send(document);
  });

  app.post('/people/:personId/documents/upload', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    if (!store.people.has(personId)) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    if (!canAccessPerson(request, personId)) return reply.code(403).send({ error: 'Você não pode enviar documentos desta pessoa.' });

    let part;
    try {
      part = await request.file();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('file size')) return reply.code(413).send({ error: 'O arquivo excede o limite de 10 MB.' });
      return reply.code(400).send({ error: 'Não foi possível ler o upload.' });
    }
    if (!part) return reply.code(400).send({ error: 'Envie um arquivo no campo file.' });
    const documentKindField = part.fields.documentKind;
    const documentKind = documentKindField && 'value' in documentKindField ? String(documentKindField.value) : '';
    if (!isDocumentKind(documentKind)) return badRequest(reply, `Tipo de documento inválido. Use: ${documentKinds.join(', ')}.`);
    if (!supportedFileTypes.has(part.mimetype)) return reply.code(415).send({ error: 'Formato não permitido. Envie PDF, JPEG, PNG ou WebP.' });

    let contents: Buffer;
    try {
      contents = await part.toBuffer();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('file size')) return reply.code(413).send({ error: 'O arquivo excede o limite de 10 MB.' });
      return reply.code(400).send({ error: 'Não foi possível ler o conteúdo do arquivo.' });
    }
    const type = supportedFileTypes.get(part.mimetype);
    if (!type || !type.signature(contents)) return reply.code(415).send({ error: 'O conteúdo do arquivo não corresponde ao formato informado.' });
    if (contents.length === 0) return reply.code(400).send({ error: 'O arquivo está vazio.' });

    const storageKey = join(personId, `${randomUUID()}${type.extension}`);
    const filePath = join(storageRoot, storageKey);
    const originalName = basename(part.filename || `documento${type.extension}`).slice(0, 120) || `documento${type.extension}`;
    const createdAt = new Date().toISOString();
    await mkdir(dirname(filePath), { recursive: true });
    try {
      await writeFile(filePath, contents, { flag: 'wx' });
      const { document } = store.addStoredDocument(personId, documentKind, {
        storageKey,
        originalName,
        mimeType: part.mimetype,
        sizeBytes: contents.length,
        sha256: createHash('sha256').update(contents).digest('hex'),
        createdAt,
      }, analyzeDocument(part.mimetype, contents, documentKind));
      store.log('document.uploaded', document.id);
      store.flush();
      return reply.code(201).send(publicDocument(document.id));
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  });

  app.get('/people/:personId/documents', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    if (!store.people.has(personId)) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    if (!canAccessPerson(request, personId)) return reply.code(403).send({ error: 'Você não pode consultar documentos desta pessoa.' });
    return [...store.documents.values()].filter((document) => document.personId === personId).map((document) => publicDocument(document.id));
  });

  app.get('/documents/:documentId/content', async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const document = [...store.documents.values()].find((item) => item.id === documentId);
    const file = document ? store.findStoredFile(document.id) : undefined;
    if (!document || !file) return reply.code(404).send({ error: 'Arquivo não encontrado.' });
    if (requireAuth) {
      const principal = principalOf(request);
      const owner = principal?.person.id === document.personId;
      const granted = principal && [...store.grants.values()].some((grant) => grant.personId === document.personId && grant.documentKind === document.documentKind && grant.documentVersionId === document.versionId && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now() && principal.memberships.some((membership) => membership.tenantId === grant.tenantId));
      if (!owner && !granted) return reply.code(403).send({ error: 'Este documento não foi compartilhado com seu workspace.' });
    }
    const root = `${storageRoot}${pathSeparator}`;
    const filePath = resolve(storageRoot, file.storageKey);
    if (!filePath.startsWith(root)) return reply.code(500).send({ error: 'Armazenamento inválido.' });
    const safeName = file.originalName.replace(/["\r\n]/g, '_');
    return reply.type(file.mimeType).header('content-disposition', `inline; filename="${safeName}"`).send(createReadStream(filePath));
  });

  app.post('/documents/:documentId/review', async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const parsed = reviewSchema.safeParse(request.body);
    const document = store.documents.get(documentId);
    const principal = principalOf(request);
    if (!document) return reply.code(404).send({ error: 'Documento não encontrado.' });
    if (!parsed.success) return badRequest(reply, 'Decisão ou observação de revisão inválida.');
    const personTenantIds = new Set(Array.from(store.memberships.values()).filter((membership) => membership.personId === document.personId).map((membership) => membership.tenantId));
    const reviewer = principal && principal.memberships.find((membership) => personTenantIds.has(membership.tenantId) && companyRoles.has(membership.role));
    if (requireAuth && !reviewer) return reply.code(403).send({ error: 'Somente RH, gestor ou administrador pode revisar este documento.' });
    const quality = store.documentQuality.get(documentId);
    if (!quality) return reply.code(409).send({ error: 'Documento sem análise de qualidade.' });
    quality.reviewStatus = parsed.data.decision === 'approve' ? 'approved' : 'rejected';
    if (parsed.data.notes) quality.reviewNotes = parsed.data.notes;
    quality.reviewedAt = new Date().toISOString();
    if (reviewer) quality.reviewedByMembershipId = reviewer.id;
    document.available = parsed.data.decision === 'approve';
    store.log(`document.review.${parsed.data.decision === 'approve' ? 'approved' : 'rejected'}`, documentId, reviewer?.tenantId);
    store.flush();
    return publicDocument(documentId);
  });

  app.post('/tenants/:tenantId/access-requests', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Solicitação inválida.');
    const membership = store.memberships.get(parsed.data.requestedByMembershipId);
    if (!membership || membership.tenantId !== tenantId) return reply.code(403).send({ error: 'Acesso fora da empresa.' });
    if (requireAuth) {
      const principalMembershipRecord = principalMembership(request, tenantId);
      if (!principalMembershipRecord || principalMembershipRecord.id !== membership.id) return reply.code(403).send({ error: 'A solicitação deve ser criada pelo seu próprio vínculo.' });
    }
    if (!companyRoles.has(membership.role)) return reply.code(403).send({ error: 'Perfil sem permissão para solicitar documentos.' });
    if (!store.people.has(parsed.data.personId) || !store.findMembership(tenantId, parsed.data.personId)) return reply.code(404).send({ error: 'Pessoa não encontrada nesta empresa.' });

    const uniqueKinds = [...new Set(parsed.data.items.map((item) => item.documentKind))];
    const validKinds = uniqueKinds.filter(isDocumentKind);
    if (validKinds.length !== uniqueKinds.length) return badRequest(reply, 'A solicitação contém documento inválido.');

    const requestRecord: AccessRequest = {
      id: randomUUID(),
      tenantId,
      personId: parsed.data.personId,
      requestedByMembershipId: parsed.data.requestedByMembershipId,
      purpose: parsed.data.purpose,
      items: validKinds.map((documentKind) => ({ documentKind, status: 'pending' })),
      status: 'pending',
      expiresAt: parsed.data.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    store.requests.set(requestRecord.id, requestRecord);
    store.log('access_request.created', requestRecord.id, tenantId);
    store.flush();
    return reply.code(201).send(requestRecord);
  });

  app.get('/people/:personId/access-requests', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    if (!canAccessPerson(request, personId)) return reply.code(403).send({ error: 'Você não pode consultar as solicitações desta pessoa.' });
    return [...store.requests.values()].filter((item) => item.personId === personId);
  });

  app.get('/tenants/:tenantId/access-requests', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    if (!store.tenants.has(tenantId)) return reply.code(404).send({ error: 'Empresa não encontrada.' });
    return [...store.requests.values()].filter((item) => item.tenantId === tenantId);
  });

  app.post('/access-requests/:requestId/decision', async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const accessRequest = store.requests.get(requestId);
    const parsed = decisionSchema.safeParse(request.body);
    if (!accessRequest) return reply.code(404).send({ error: 'Solicitação não encontrada.' });
    if (!parsed.success || parsed.data.personId !== accessRequest.personId) return reply.code(403).send({ error: 'Decisão não autorizada.' });
    const principal = principalOf(request);
    if (requireAuth && principal && principal.person.id !== accessRequest.personId) return reply.code(403).send({ error: 'Somente o funcionário pode decidir esta solicitação.' });
    for (const decision of parsed.data.decisions.filter((item) => item.decision === 'approve')) {
      if (!isDocumentKind(decision.documentKind)) return badRequest(reply, 'Documento inválido.');
      const document = store.findDocument(accessRequest.personId, decision.documentKind);
      if (!document || !canShareDocument(document.id)) return reply.code(422).send({ error: 'Envie um documento legível ou aguarde a revisão do RH antes de aprovar.' });
    }

    for (const decision of parsed.data.decisions) {
      const item = accessRequest.items.find((candidate) => candidate.documentKind === decision.documentKind);
      if (!item) return badRequest(reply, 'Documento não faz parte da solicitação.');
      item.status = decision.decision === 'approve' ? 'approved' : 'denied';
      if (decision.decision === 'approve') {
        const document = store.findDocument(accessRequest.personId, item.documentKind);
        if (document && canShareDocument(document.id)) {
          const grant = {
            id: randomUUID(),
            tenantId: accessRequest.tenantId,
            personId: accessRequest.personId,
            accessRequestId: accessRequest.id,
            documentKind: item.documentKind,
            documentVersionId: document.versionId,
            purpose: accessRequest.purpose,
            grantedAt: new Date().toISOString(),
            expiresAt: accessRequest.expiresAt,
          };
          store.grants.set(grant.id, grant);
          store.log('document.granted', grant.id, accessRequest.tenantId);
        }
      }
    }

    const statuses = accessRequest.items.map((item) => item.status);
    accessRequest.status = statuses.every((status) => status === 'approved')
      ? 'approved'
      : statuses.every((status) => status === 'denied')
        ? 'denied'
        : 'partially_approved';
    store.log('access_request.decided', accessRequest.id, accessRequest.tenantId);
    store.flush();
    return accessRequest;
  });

  app.get('/tenants/:tenantId/grants', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const query = request.query as { personId?: string };
    if (!store.tenants.has(tenantId)) return reply.code(404).send({ error: 'Empresa não encontrada.' });
    return [...store.grants.values()].filter((grant) => grant.tenantId === tenantId && (!query.personId || grant.personId === query.personId) && !grant.revokedAt);
  });

  app.post('/grants/:grantId/revoke', async (request, reply) => {
    const { grantId } = request.params as { grantId: string };
    const grant = store.grants.get(grantId);
    const body = z.object({ personId: z.string().uuid() }).safeParse(request.body);
    if (!grant) return reply.code(404).send({ error: 'Concessão não encontrada.' });
    if (!body.success || body.data.personId !== grant.personId) return reply.code(403).send({ error: 'Revogação não autorizada.' });
    const principal = principalOf(request);
    if (requireAuth && principal && principal.person.id !== grant.personId) return reply.code(403).send({ error: 'Somente o titular pode revogar esta concessão.' });
    grant.revokedAt = new Date().toISOString();
    store.log('document.revoked', grant.id, grant.tenantId);
    store.flush();
    return grant;
  });

  return app;
}
