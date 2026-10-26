import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createAdmission, createEmployeeInvitation, getPersonDocuments, loadDemo, loginSession, logoutSession, refreshDemo, registerSession, reviewDocument, verifyMfaLogin } from './api.js';
import { documentLabels, itemStatusLabel, requestStatusLabel, summarize } from './dashboard.js';
import { MfaSetup } from './MfaSetup.js';
import type { AccessRequest, DemoContext, DocumentKind, DocumentRecord, MfaChallenge } from './types.js';

const admissionDocumentKinds: DocumentKind[] = ['cpf', 'work_card', 'driver_license', 'certificate', 'diploma', 'vaccination_card', 'aso', 'profile_photo'];

function App() {
  const [context, setContext] = useState<DemoContext | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdmission, setShowAdmission] = useState(false);
  const [savingAdmission, setSavingAdmission] = useState(false);
  const [admissionError, setAdmissionError] = useState('');
  const [admission, setAdmission] = useState<{ name: string; email: string; documentKinds: DocumentKind[] }>({
    name: '',
    email: '',
    documentKinds: ['cpf', 'work_card', 'aso'],
  });
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [authForm, setAuthForm] = useState({ tenantName: '', name: '', email: '', password: '' });
  const [invitationToken, setInvitationToken] = useState('');
  const [generatingInvitation, setGeneratingInvitation] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<DocumentRecord[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [reviewingDocument, setReviewingDocument] = useState<string | null>(null);
  const [showMfaSetup, setShowMfaSetup] = useState(false);

  async function hydrate(force = false) {
    setError('');
    force ? setRefreshing(true) : setLoading(true);
    try {
      const result = force ? await refreshDemo() : await loadDemo();
      setContext(result.context);
      setRequests(result.requests);
      setSelectedId((current) => current && result.requests.some((request) => request.id === current) ? current : result.requests[0]?.id ?? null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível carregar o painel.';
      if (message === 'AUTH_REQUIRED' || message.startsWith('Sessão expirada')) setRequiresAuth(true);
      else setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void hydrate(); }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      if (authMode === 'register') await registerSession(authForm);
      else {
        const result = await loginSession({ email: authForm.email, password: authForm.password });
        if ('mfaRequired' in result) { setMfaChallenge(result); return; }
      }
      setRequiresAuth(false);
      await hydrate();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a sessão.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;
    setAuthError('');
    setAuthBusy(true);
    try {
      await verifyMfaLogin(mfaChallenge.challengeToken, mfaCode);
      setMfaChallenge(null);
      setMfaCode('');
      setRequiresAuth(false);
      await hydrate();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : 'Não foi possível validar o MFA.');
    } finally {
      setAuthBusy(false);
    }
  }

  function toggleDocument(documentKind: DocumentKind) {
    setAdmission((current) => ({
      ...current,
      documentKinds: current.documentKinds.includes(documentKind)
        ? current.documentKinds.filter((item) => item !== documentKind)
        : [...current.documentKinds, documentKind],
    }));
  }

  async function submitAdmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || admission.documentKinds.length === 0) return;
    setAdmissionError('');
    setSavingAdmission(true);
    try {
      const result = await createAdmission(context, admission);
      setRequests(result.requests);
      setSelectedId(result.requests.at(-1)?.id ?? null);
      setAdmission({ name: '', email: '', documentKinds: ['cpf', 'work_card', 'aso'] });
      setShowAdmission(false);
    } catch (cause) {
      setAdmissionError(cause instanceof Error ? cause.message : 'Não foi possível criar a admissão.');
    } finally {
      setSavingAdmission(false);
    }
  }

  async function generateInvitation() {
    if (!context || !selected) return;
    setGeneratingInvitation(true);
    setInvitationToken('');
    try {
      const invitation = await createEmployeeInvitation(context, selected.personId);
      setInvitationToken(invitation.token);
    } catch (cause) {
      setAdmissionError(cause instanceof Error ? cause.message : 'Não foi possível gerar o convite.');
    } finally {
      setGeneratingInvitation(false);
    }
  }

  async function reviewSelectedDocument(documentId: string, decision: 'approve' | 'reject') {
    setReviewingDocument(documentId);
    try {
      await reviewDocument(documentId, decision);
      setSelectedDocuments(await getPersonDocuments(selected?.personId ?? ''));
    } catch (cause) {
      setAdmissionError(cause instanceof Error ? cause.message : 'Não foi possível revisar o documento.');
    } finally {
      setReviewingDocument(null);
    }
  }

  const selected = requests.find((request) => request.id === selectedId) ?? requests[0];
  const stats = useMemo(() => summarize(requests), [requests]);

  useEffect(() => {
    if (!selected) { setSelectedDocuments([]); return; }
    let active = true;
    setLoadingDocuments(true);
    void getPersonDocuments(selected.personId).then((documents) => { if (active) setSelectedDocuments(documents); }).catch(() => { if (active) setSelectedDocuments([]); }).finally(() => { if (active) setLoadingDocuments(false); });
    return () => { active = false; };
  }, [selected?.personId]);

  if (loading) return <div className="loading-screen"><span className="loader-dot" />Carregando a central de admissões…</div>;
  if (requiresAuth) return <section className="auth-screen"><div className="auth-card"><div className="brand auth-brand"><span className="brand-mark">n</span><span>nexo<strong>pessoal</strong></span></div>{mfaChallenge ? <><p className="eyebrow">Segundo fator</p><h1>Confirme seu acesso.</h1><p className="auth-subtitle">Informe o código do aplicativo autenticador ou um código de recuperação.</p><form onSubmit={submitMfa}><label className="field"><span>Código MFA</span><input required autoFocus inputMode="numeric" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder="123456 ou código de recuperação" /></label>{authError && <p className="form-error">{authError}</p>}<button className="button primary auth-submit" disabled={authBusy}>{authBusy ? 'Validando…' : 'Confirmar MFA'}</button></form><button className="text-button" onClick={() => { setMfaChallenge(null); setMfaCode(''); setAuthError(''); }}>Voltar ao login</button></> : <><p className="eyebrow">Workspace seguro</p><h1>{authMode === 'register' ? 'Crie o acesso do RH.' : 'Entre no painel de RH.'}</h1><p className="auth-subtitle">A sessão protege a fila de admissões e os dados do workspace.</p><div className="auth-tabs"><button className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setAuthError(''); }}>Criar workspace</button><button className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError(''); }}>Já tenho acesso</button></div><form onSubmit={submitAuth}>{authMode === 'register' && <><label className="field"><span>Empresa</span><input required minLength={2} value={authForm.tenantName} onChange={(event) => setAuthForm({ ...authForm, tenantName: event.target.value })} placeholder="Ex.: Atlas Construções" /></label><label className="field"><span>Seu nome</span><input required minLength={2} value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} placeholder="Ex.: Joana Martins" /></label></>}<label className="field"><span>E-mail corporativo</span><input required type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="rh@empresa.com" /></label><label className="field"><span>Senha</span><input required minLength={12} type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="Mínimo de 12 caracteres" /></label>{authError && <p className="form-error">{authError}</p>}<button className="button primary auth-submit" disabled={authBusy}>{authBusy ? 'Validando…' : authMode === 'register' ? 'Criar e entrar' : 'Entrar no painel'}</button></form><small className="auth-footnote">Ambiente local de desenvolvimento. Não use dados reais.</small></>}</div></section>;
  if (error) return <div className="error-screen"><div><p className="eyebrow">NexoPessoal · ambiente local</p><h1>A API ainda não está disponível.</h1><p>{error}</p><code>npm run start --workspace @nexopessoal/api</code><button className="button primary" onClick={() => void hydrate()}>Tentar novamente</button></div></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">n</span><span>nexo<strong>pessoal</strong></span></div>
        <div className="workspace-label">Workspace</div>
        <div className="workspace-name">{context?.tenantName}<span className="chevron">⌄</span></div>
        <nav className="nav" aria-label="Navegação principal">
          <button className="nav-item active"><span>⌂</span>Visão geral</button>
          <button className="nav-item"><span>◌</span>Funcionários</button>
          <button className="nav-item"><span>▣</span>Solicitações <em>{stats.open}</em></button>
          <button className="nav-item"><span>◫</span>Documentos</button>
          <button className="nav-item"><span>⚙</span>Configurações</button>
        </nav>
        <div className="sidebar-footer">
          <div className="demo-note"><span className="live-dot" /><div><strong>Ambiente local</strong><small>SQLite local · dados fictícios</small></div></div>
          <div className="profile-chip"><span className="avatar small">JM</span><div><strong>Joana Martins</strong><small>Recursos humanos</small></div><span className="more">•••</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Visão geral</strong></div><div className="top-actions"><button className="icon-button" aria-label="Ajuda">?</button><button className="icon-button notification" aria-label="Notificações">♧<i /></button><button className="text-button" onClick={() => setShowMfaSetup(true)}>Ativar MFA</button><button className="text-button logout-button" onClick={() => { logoutSession(); setRequiresAuth(true); }}>Sair</button><span className="avatar">JM</span></div></header>{showMfaSetup && <MfaSetup onDone={() => setShowMfaSetup(false)} />}
        <div className="content-wrap">
          <section className="welcome-row"><div><p className="eyebrow">Operação de pessoas</p><h1>Admissões sem papel perdido.</h1><p className="subtitle">Acompanhe autorizações e documentos em um só lugar.</p></div><div className="welcome-actions"><button className="button primary-action" onClick={() => { setAdmissionError(''); setShowAdmission(true); }}><span>＋</span>Nova admissão</button><button className="button secondary" onClick={() => void hydrate(true)} disabled={refreshing}><span className={refreshing ? 'spin' : ''}>↻</span>{refreshing ? 'Atualizando…' : 'Atualizar demonstração'}</button></div></section>

          <section className="stat-strip" aria-label="Resumo da operação">
            <div className="stat"><span>Solicitações abertas</span><strong>{stats.open.toString().padStart(2, '0')}</strong><small>precisam de resposta</small></div>
            <div className="stat"><span>Documentos pendentes</span><strong>{stats.waitingDocuments.toString().padStart(2, '0')}</strong><small>aguardando o funcionário</small></div>
            <div className="stat"><span>Autorizações ativas</span><strong>{stats.approved.toString().padStart(2, '0')}</strong><small>compartilhadas com segurança</small></div>
            <div className="stat last"><span>Próximo cuidado</span><strong className="date-stat">7 dias</strong><small>prazo padrão da solicitação</small></div>
          </section>

          <div className="section-heading"><div><p className="eyebrow">Fila de trabalho</p><h2>Solicitações recentes</h2></div><button className="text-button">Ver todas <span>→</span></button></div>
          <section className="work-grid">
            <div className="request-panel">
              <div className="table-head"><span>Funcionário</span><span>Finalidade</span><span>Documentos</span><span>Status</span></div>
              {requests.map((request) => (
                <button className={`request-row ${selected?.id === request.id ? 'selected' : ''}`} key={request.id} onClick={() => setSelectedId(request.id)}>
                  <div className="person-cell"><span className="avatar person-avatar">SM</span><div><strong>{context?.personName}</strong><small>Solicitação de admissão</small></div></div>
                  <span className="purpose">Admissão</span>
                  <span className="document-count"><b>{request.items.length}</b> itens</span>
                  <span className={`status ${request.status}`}><i />{requestStatusLabel(request.status)}</span>
                </button>
              ))}
              {requests.length === 0 && <div className="empty-state"><span>○</span><strong>Nenhuma solicitação ainda</strong><p>Quando o RH pedir documentos, eles aparecerão aqui.</p></div>}
            </div>

            <aside className="detail-panel" aria-label="Detalhes da solicitação">
              {selected ? <>
                <div className="detail-top"><div><p className="eyebrow">Detalhe da solicitação</p><h3>{context?.personName}</h3></div><button className="more-button" aria-label="Mais opções">•••</button></div>
                <div className="detail-meta"><span className="status pending"><i />{requestStatusLabel(selected.status)}</span><span>Expira em 7 dias</span></div>
                <div className="detail-divider" />
                <p className="detail-label">Documentos solicitados</p>
                <div className="document-list">{selected.items.map((item) => <div className="document-item" key={item.documentKind}><span className="document-icon">{item.documentKind === 'aso' ? '✚' : '▤'}</span><div><strong>{documentLabels[item.documentKind]}</strong><small>{itemStatusLabel(item.status)}</small></div><span className={`item-dot ${item.status}`} /></div>)}</div>
                <div className="review-heading"><p className="detail-label">Validação dos arquivos</p><span>{loadingDocuments ? 'Carregando…' : `${selectedDocuments.length} arquivo(s)`}</span></div>
                <div className="review-list">{selectedDocuments.map((document) => <div className="review-item" key={document.id}><div><strong>{documentLabels[document.documentKind]}</strong><small className={`quality-label ${document.quality?.status === 'passed' ? 'passed' : 'failed'}`}>{document.quality?.status === 'passed' ? 'Legibilidade aprovada' : 'Revisão necessária'}</small>{document.quality?.reasons.map((reason) => <small className="quality-reason" key={reason}>{reason}</small>)}</div>{document.quality?.status === 'failed' && document.quality.reviewStatus !== 'approved' && <div className="review-actions"><button disabled={reviewingDocument === document.id} onClick={() => void reviewSelectedDocument(document.id, 'approve')}>Aprovar</button><button disabled={reviewingDocument === document.id} onClick={() => void reviewSelectedDocument(document.id, 'reject')}>Reprovar</button></div>}</div>)}</div>
                <div className="detail-callout"><span>i</span><p>O funcionário recebe a solicitação no aplicativo e decide o que compartilhar.</p></div>
                <button className="button full secondary" onClick={() => void generateInvitation()} disabled={generatingInvitation}>{generatingInvitation ? 'Gerando convite…' : 'Gerar convite do funcionário'}</button>
                {invitationToken && <div className="invite-token"><small>Token de teste · válido por 7 dias</small><code>{invitationToken}</code><button className="text-button" onClick={() => navigator.clipboard?.writeText(invitationToken)}>Copiar token</button></div>}
                <button className="button full secondary" onClick={() => navigator.clipboard?.writeText(`Solicitação para ${context?.personName}`)}>Copiar resumo</button>
              </> : <div className="empty-detail"><span>↖</span><p>Selecione uma solicitação para ver os detalhes.</p></div>}
            </aside>
          </section>
          <footer className="page-footer"><span>Última atualização agora</span><span>Workspace protegido · NexoPessoal 0.1</span></footer>
        </div>
      </main>
      {showAdmission && <div className="modal-backdrop" role="presentation" onMouseDown={() => !savingAdmission && setShowAdmission(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-admission-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Nova jornada</p><h2 id="new-admission-title">Cadastrar e solicitar</h2><p>O funcionário receberá os itens selecionados para autorizar no app.</p></div><button className="modal-close" type="button" aria-label="Fechar" onClick={() => setShowAdmission(false)}>×</button></div><form onSubmit={submitAdmission}><label className="field"><span>Nome completo</span><input required minLength={2} value={admission.name} onChange={(event) => setAdmission({ ...admission, name: event.target.value })} placeholder="Ex.: Ana Souza" /></label><label className="field"><span>E-mail</span><input required type="email" value={admission.email} onChange={(event) => setAdmission({ ...admission, email: event.target.value })} placeholder="ana@empresa.com" /></label><fieldset className="document-picker"><legend>Documentos para admissão</legend><div className="checkbox-grid">{admissionDocumentKinds.map((documentKind) => <label className="check-option" key={documentKind}><input type="checkbox" checked={admission.documentKinds.includes(documentKind)} onChange={() => toggleDocument(documentKind)} /><span className="check-box">✓</span><span>{documentLabels[documentKind]}</span></label>)}</div></fieldset>{admissionError && <p className="form-error">{admissionError}</p>}<div className="modal-actions"><button className="button secondary" type="button" onClick={() => setShowAdmission(false)} disabled={savingAdmission}>Cancelar</button><button className="button primary-action" type="submit" disabled={savingAdmission || admission.documentKinds.length === 0}>{savingAdmission ? 'Criando…' : 'Criar e solicitar'}</button></div></form></section></div>}
    </div>
  );
}

export default App;
