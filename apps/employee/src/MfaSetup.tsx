import { useEffect, useState, type FormEvent } from 'react';
import { beginMfaSetup, enableMfa } from './api.js';

export function MfaSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; issuer: string; account: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => { void beginMfaSetup().then(setSetup).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar o MFA.')).finally(() => setBusy(false)); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { setRecoveryCodes(await enableMfa(code)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Código MFA inválido.'); } finally { setBusy(false); }
  }

  return <div className="security-panel"><div className="panel-heading"><div><p className="eyebrow">Proteção da conta</p><h2>Ativar MFA</h2></div><button className="header-user button-reset" onClick={onDone}>Fechar</button></div>{busy && !setup && <p>Preparando configuração…</p>}{setup && recoveryCodes.length === 0 && <><p>Adicione esta conta ao Google Authenticator, Microsoft Authenticator ou outro app TOTP.</p><label><span>URI de configuração</span><textarea readOnly value={setup.otpauthUri} /></label><p className="mfa-secret"><strong>Segredo manual:</strong> {setup.secret}</p><form onSubmit={submit}><label><span>Código do aplicativo</span><input required inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" /></label>{error && <p className="error-message">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Validando…' : 'Ativar MFA'}</button></form></>}{recoveryCodes.length > 0 && <><p>Guarde estes códigos em um local seguro. Cada código pode ser usado uma única vez.</p><div className="recovery-grid">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div><button className="primary" onClick={onDone}>Concluir</button></>}</div>;
}
