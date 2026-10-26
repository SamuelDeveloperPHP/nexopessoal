import { createHmac, createHash, randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const stepSeconds = 30;

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Segredo TOTP inválido.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, '').trim();
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = ((digest[offset]! & 127) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, timestamp = Date.now()): boolean {
  const normalized = normalizeCode(code);
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const drift of [-1, 0, 1]) {
    if (totpCode(secret, timestamp + drift * stepSeconds * 1000) === normalized) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString('hex').toUpperCase());
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeCode(code).toUpperCase()).digest('hex');
}

export function otpauthUri(secret: string, email: string, issuer = 'NexoPessoal'): string {
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${stepSeconds}`;
}
