import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { acceptInvitation, decide, getSession, loadPortal, login, logout, uploadDocument, verifyMfaLogin } from './api.js';
import { hasBiometricUnlock, registerBiometricUnlock, supportsBiometricUnlock, unlockWithBiometric } from './biometric.js';
import { offlineEnabled, setOffline, syncOfflineOperations } from './api.js';
import { documentLabels, requestedCount, statusLabel } from './portal.js';
import { MfaSetup } from './MfaSetup.js';
import type { AccessRequest, DocumentKind, DocumentRecord, MfaChallenge } from './types.js';
import './styles.css';

const kinds: DocumentKind[] = ['cpf', 'work_card', 'driver_license', 'certificate', 'diploma', 'vaccination_card', 'aso', 'profile_photo'];

function App() {
  const initialToken = new URLSearchParams(window.location.search).get('invite') ?? '';
  const [session, setSession] = useState(getSession());
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [mode, setMode] = useState<'invite' | 'login'>(initialToken ? 'invite' : 'login');
  const [token, setToken] = useState(initialToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState<DocumentKind | null>(null);
  const [error, setError] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [offline, setOfflineState] = useState(offlineEnabled());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricRegistered, setBiometricRegistered] = useState(hasBiometricUnlock());
  const [biometricUnlocked, setBiometricUnlocked] = useState(!hasBiometricUnlock());
  const [syncMessage, setSyncMessage] = useState('');
  const [showMfaSetup, setShowMfaSetup] = useState(false);

  async function refresh() {
    try {
      if (offlineEnabled() && biometricRegistered && !biometricUnlocked) {
        if (!(await unlockWithBiometric())) throw new Error('Confirme sua biometria para abrir o cofre offline.');
        setBiometricUnlocked(true);
      }
      const result = await loadPortal(); setRequests(result.requests); setDocuments(result.documents);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seus dados.'); }
  }
  useEffect(() => {
    if (!session) return;
    void refresh();
    void supportsBiometricUnlock().then(setBiometricAvailable);
    const sync = async () => {
      try { const count = await syncOfflineOperations(); if (count > 0) { setSyncMessage(`${count} operação(ões) sincronizada(s).`); await refresh(); } } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar.'); }
    };
    window.addEventListener('online', sync);
    void sync();
    return () => window.removeEventListener('online', sync);
  }, [session]);

  async function toggleOffline() {
    const next = !offline;
    if (next && biometricRegistered && !(await unlockWithBiometric())) { setError('Confirme sua biometria para ativar o modo offline.'); return; }
    if (next && biometricRegistered) setBiometricUnlocked(true);
    setOffline(next); setOfflineState(next); setSyncMessage(next ? 'Modo offline ativado.' : 'Modo online ativado.');
    if (!next) { try { await syncOfflineOperations(); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar.'); } }
  }

  async function enableBiometric() {
    if (!session) return;
    try { await registerBiometricUnlock(session.context.personId, session.context.personName); setBiometricRegistered(true); setSyncMessage('Biometria local ativada neste dispositivo.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível ativar a biometria.'); }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const next = mode === 'invite' ? await acceptInvitation(token, password) : await login(email, password); if ('mfaRequired' in next) { setMfaChallenge(next); return; } setSession(next); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a sessão.'); } finally { setBusy(false); }
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault();
    if (!mfaChallenge) return;
    setBusy(true); setError('');
    try { const next = await verifyMfaLogin(mfaChallenge.challengeToken, mfaCode); setMfaChallenge(null); setMfaCode(''); setSession(next); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível validar o MFA.'); } finally { setBusy(false); }
  }

  async function handleUpload(kind: DocumentKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusyKind(kind); setError('');
    try { await uploadDocument(kind, file); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o documento.'); } finally { setBusyKind(null); event.target.value = ''; }
  }

  async function handleDecision(request: AccessRequest, kind: DocumentKind, decision: 'approve' | 'deny') {
    setBusyKind(kind); setError('');
    try { await decide(request.id, [{ documentKind: kind, decision }]); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar sua decisão.'); } finally { setBusyKind(null); }
  }

  const pending = useMemo(() => requestedCount(requests), [requests]);
  if (!session) return <main className="auth-page"><section className="auth-card"><div className="logo"><span>n</span> nexo<strong>pessoal</strong></div>{mfaChallenge ? <><p className="eyebrow">Segundo fator</p><h1>Confirme seu acesso.</h1><p className="lead">Informe o código do aplicativo autenticador ou um código de recuperação.</p><form onSubmit={submitMfa}><label><span>Código MFA</span><input required autoFocus inputMode="numeric" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder="123456 ou código de recuperação" /></label>{error && <p className="error-message">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Validando…' : 'Confirmar MFA'}</button></form><button className="header-user button-reset" onClick={() => { setMfaChallenge(null); setMfaCode(''); setError(''); }}>Voltar ao login</button></> : <><p className="eyebrow">Portal do funcionário</p><h1>{mode === 'invite' ? 'Seu espaço de documentos.' : 'Acesse seus documentos.'}</h1><p className="lead">Envie arquivos com segurança e escolha o que cada empresa pode consultar.</p><div className="tabs"><button className={mode === 'invite' ? 'active' : ''} onClick={() => setMode('invite')}>Aceitar convite</button><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Entrar</button></div><form onSubmit={submitAuth}>{mode === 'invite' ? <label><span>Token do convite</span><input required value={token} onChange={(event) => setToken(event.target.value)} placeholder="Cole o token recebido" /> </label> : <label><span>E-mail</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="seu@email.com" /></label>}<label><span>Senha</span><input required minLength={12} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 12 caracteres" /></label>{error && <p className="error-message">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Aguarde…' : mode === 'invite' ? 'Criar acesso' : 'Entrar'}</button></form><small>Ambiente local de desenvolvimento. Use somente dados fictícios.</small></>}</section></main>;

  return <main className="portal"><header className="portal-header"><div className="logo"><span>n</span> nexo<strong>pessoal</strong></div><div className="header-user"><div><strong>{session.context.personName}</strong><small>{session.context.tenantName}</small></div><div className="security-actions"><button onClick={() => setShowMfaSetup(true)}>Ativar MFA</button><button onClick={() => void toggleOffline()}>{offline ? 'Online' : 'Offline'}</button>{biometricAvailable && <button onClick={() => void enableBiometric()} disabled={biometricRegistered}>{biometricRegistered ? 'Biometria ativa' : 'Ativar biometria'}</button>}<button onClick={() => { logout(); setSession(null); }}>Sair</button></div></div></header>{showMfaSetup && <MfaSetup onDone={() => setShowMfaSetup(false)} />}{(syncMessage || error) && <div className="error-message banner">{syncMessage || error}</div>}<section className="hero"><div><p className="eyebrow">Meu espaço</p><h1>Olá, {session.context.personName.split(' ')[0]}.</h1><p>Você tem <strong>{pending}</strong> documento(s) aguardando sua atenção.</p></div><div className="hero-badge">{pending === 0 ? 'Tudo em dia' : 'Ação necessária'}<span>{pending}</span></div></section><section className="requests"><div className="section-head"><div><p className="eyebrow">Solicitações</p><h2>Empresas pedindo acesso</h2></div><span className="security-note">🔒 Você decide o compartilhamento</span></div>{requests.length === 0 && <div className="empty">Nenhuma solicitação no momento.</div>}{requests.map((request) => <article className="request-card" key={request.id}><div className="request-heading"><div><h3>Solicitação de {request.purpose === 'admission' ? 'admissão' : 'documentos'}</h3><span>Expira em {new Date(request.expiresAt).toLocaleDateString('pt-BR')}</span></div><b className={`request-status ${request.status}`}>{statusLabel(request.status)}</b></div><div className="document-grid">{request.items.map((item) => { const uploadedDocument = documents.find((document) => document.documentKind === item.documentKind && document.file); const uploaded = Boolean(uploadedDocument); const qualityReady = Boolean(uploadedDocument?.quality && (uploadedDocument.quality.status === 'passed' || uploadedDocument.quality.reviewStatus === 'approved')); const actionBusy = busyKind === item.documentKind; return <div className="document-card" key={item.documentKind}><div className="document-title"><span className="doc-icon">▤</span><div><strong>{documentLabels[item.documentKind]}</strong><small>{uploaded ? qualityReady ? 'Legibilidade aprovada' : 'Arquivo enviado · revisão necessária' : statusLabel(item.status)}</small></div></div>{uploadedDocument?.quality?.status === 'failed' && <small className="quality-warning">{uploadedDocument.quality.reasons[0] ?? 'O arquivo precisa ser revisado.'}</small>}{item.status === 'pending' && <><label className="upload-button">{actionBusy ? 'Processando…' : uploaded ? 'Trocar arquivo' : 'Enviar arquivo'}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={actionBusy} onChange={(event) => void handleUpload(item.documentKind, event)} /></label><div className="decision-actions"><button disabled={actionBusy || !qualityReady} onClick={() => void handleDecision(request, item.documentKind, 'approve')}>Aprovar</button><button disabled={actionBusy} onClick={() => void handleDecision(request, item.documentKind, 'deny')}>Recusar</button></div></>}</div>; })}</div><p className="privacy-copy">A empresa só acessará os documentos que você aprovar. Você poderá revogar o acesso depois.</p></article>)}</section></main>;
}

export default App;
