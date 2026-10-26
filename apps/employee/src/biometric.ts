const CREDENTIAL_KEY = 'nexopessoal:biometric-credential';

function encode(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function supportsBiometricUnlock(): Promise<boolean> {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

export function hasBiometricUnlock(): boolean {
  return Boolean(localStorage.getItem(CREDENTIAL_KEY));
}

export async function registerBiometricUnlock(userId: string, userName: string): Promise<void> {
  if (!(await supportsBiometricUnlock())) throw new Error('Este dispositivo não oferece biometria local compatível.');
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)) as unknown as BufferSource,
    rp: { name: 'NexoPessoal' },
    user: { id: new TextEncoder().encode(userId) as unknown as BufferSource, name: userName, displayName: userName },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60_000,
    attestation: 'none',
  } });
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Não foi possível registrar a biometria.');
  localStorage.setItem(CREDENTIAL_KEY, encode(credential.rawId));
}

export async function unlockWithBiometric(): Promise<boolean> {
  const stored = localStorage.getItem(CREDENTIAL_KEY);
  if (!stored || !(await supportsBiometricUnlock())) return false;
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)) as unknown as BufferSource,
    allowCredentials: [{ id: decode(stored) as unknown as BufferSource, type: 'public-key' }],
    userVerification: 'required',
    timeout: 60_000,
  } });
  return credential instanceof PublicKeyCredential;
}
