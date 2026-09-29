import { Reminder, SecurityAuditLog, SecuritySettings } from '../types';

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  endToEndEncryption: true,
  autoPurgeDays: 90,
  activeVault: 'personal',
  requirePasscode: false,
};

/**
 * Creates a new security audit log entry
 */
export function createAuditLog(
  action: string,
  details: string,
  actor: string = 'User'
): SecurityAuditLog {
  return {
    id: `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: new Date().toISOString(),
    action,
    details,
    actor,
  };
}

// ---------------------------------------------------------------------------
// Backup encryption: AES-256-GCM, key derived from a user passphrase (PBKDF2).
// Uses the Web Crypto API (globalThis.crypto.subtle), available in browsers and
// Node >= 19 (and Node 18 via globalThis.crypto when webcrypto is exposed).
// ---------------------------------------------------------------------------

export const BACKUP_FORMAT = 'docmind-backup';
export const BACKUP_VERSION = 1;
export const PBKDF2_ITERATIONS = 210_000;
/** Upper bound accepted on import so a crafted file cannot hang the tab. */
export const MAX_PBKDF2_ITERATIONS = 5_000_000;
export const MIN_PASSPHRASE_LENGTH = 12;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
const AAD_LABEL = 'docmind-backup-v1';

export type VaultErrorCode =
  | 'WEAK_PASSPHRASE'
  | 'INVALID_FORMAT'
  | 'DECRYPT_FAILED'
  | 'UNSUPPORTED_VERSION'
  | 'CRYPTO_UNAVAILABLE';

export class VaultError extends Error {
  code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: number;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64, 16 bytes
  iv: string; // base64, 12 bytes
  data: string; // base64 ciphertext + 16-byte GCM tag
}

export type BackupFormat = 'encrypted' | 'legacy' | 'plain';

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) {
    throw new VaultError('CRYPTO_UNAVAILABLE', 'Secure encryption is not available in this browser (a secure https:// context is required).');
  }
  return c.subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Returns an error message if the passphrase is unacceptable, otherwise null. */
export function validatePassphrase(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`;
  }
  return null;
}

/**
 * Encrypts plaintext with AES-256-GCM. Key = PBKDF2-HMAC-SHA256(passphrase, random 16-byte salt).
 * Returns a versioned JSON envelope string (binary fields are base64).
 */
export async function encryptBackup(plaintext: string, passphrase: string): Promise<string> {
  const weak = validatePassphrase(passphrase);
  if (weak) throw new VaultError('WEAK_PASSPHRASE', weak);

  const subtle = getSubtle();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(AAD_LABEL) },
    key,
    new TextEncoder().encode(plaintext)
  );

  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ct)),
  };
  return JSON.stringify(envelope);
}

function parseEnvelope(raw: string): BackupEnvelope {
  let env: any;
  try {
    env = JSON.parse(raw);
  } catch {
    throw new VaultError('INVALID_FORMAT', 'This file is not a valid DocuMind backup.');
  }
  if (!env || typeof env !== 'object' || env.format !== BACKUP_FORMAT) {
    throw new VaultError('INVALID_FORMAT', 'This file is not a valid DocuMind backup.');
  }
  if (env.version !== BACKUP_VERSION) {
    throw new VaultError('UNSUPPORTED_VERSION', 'This backup was created by a newer version of DocuMind and cannot be opened.');
  }
  if (
    env.cipher !== 'AES-256-GCM' ||
    env.kdf !== 'PBKDF2-SHA256' ||
    !Number.isInteger(env.iterations) ||
    env.iterations < PBKDF2_ITERATIONS ||
    env.iterations > MAX_PBKDF2_ITERATIONS ||
    typeof env.salt !== 'string' ||
    typeof env.iv !== 'string' ||
    typeof env.data !== 'string'
  ) {
    throw new VaultError('INVALID_FORMAT', 'The backup file is damaged or uses unsupported encryption settings.');
  }
  return env as BackupEnvelope;
}

/**
 * Decrypts an envelope produced by encryptBackup. Throws VaultError('DECRYPT_FAILED')
 * for a wrong passphrase OR tampered/corrupt ciphertext (AES-GCM cannot tell them apart).
 */
export async function decryptBackup(raw: string, passphrase: string): Promise<string> {
  const env = parseEnvelope(raw.trim());
  let salt: Uint8Array;
  let iv: Uint8Array;
  let data: Uint8Array;
  try {
    salt = base64ToBytes(env.salt);
    iv = base64ToBytes(env.iv);
    data = base64ToBytes(env.data);
  } catch {
    throw new VaultError('INVALID_FORMAT', 'The backup file is damaged.');
  }
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || data.length < 16) {
    throw new VaultError('INVALID_FORMAT', 'The backup file is damaged.');
  }

  const key = await deriveKey(passphrase, salt, env.iterations);
  try {
    const pt = await getSubtle().decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(AAD_LABEL) },
      key,
      data
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new VaultError('DECRYPT_FAILED', 'Wrong passphrase, or the backup file is corrupt or has been modified.');
  }
}

// ---------------------------------------------------------------------------
// Legacy (read-only) support
// ---------------------------------------------------------------------------

/**
 * Backups created before the encryption fix used a repeating-key XOR + base64 with
 * this hard-coded key. That is obfuscation, NOT encryption. It is kept only so that
 * existing backup files can still be imported; it is never used to create backups.
 */
export const LEGACY_VAULT_KEY = 'DOCMIND-VAULT-256';
export const LEGACY_PREFIX = 'ENC_AES256::';

/** Decrypts a legacy `ENC_AES256::<base64>` backup. Throws VaultError on malformed input. */
export function decryptLegacyBackup(cipher: string): string {
  const trimmed = cipher.trim();
  if (!trimmed.startsWith(LEGACY_PREFIX)) {
    throw new VaultError('INVALID_FORMAT', 'Not a legacy DocuMind backup.');
  }
  let decoded: string;
  try {
    decoded = atob(trimmed.slice(LEGACY_PREFIX.length));
  } catch {
    throw new VaultError('INVALID_FORMAT', 'The backup file is damaged.');
  }
  let result = '';
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(decoded.charCodeAt(i) ^ LEGACY_VAULT_KEY.charCodeAt(i % LEGACY_VAULT_KEY.length));
  }
  return result;
}

/** Identifies a backup file's format without decrypting it. */
export function detectBackupFormat(raw: string): BackupFormat {
  const t = raw.trim();
  if (t.startsWith(LEGACY_PREFIX)) return 'legacy';
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object' && o.format === BACKUP_FORMAT) return 'encrypted';
    } catch {
      /* fall through */
    }
  }
  return 'plain';
}

/**
 * Filters reminders by active multi-tenant vault
 */
export function filterRemindersByVault(
  reminders: Reminder[],
  activeVault: 'personal' | 'household'
): Reminder[] {
  return reminders.filter((r) => {
    if (!r.vaultId) return true; // Default to all if unassigned
    return r.vaultId === activeVault;
  });
}

/**
 * Auto-purges old completed or scanned documents if autoPurgeDays is set (> 0)
 */
export function autoPurgeOldDocuments(
  reminders: Reminder[],
  autoPurgeDays: number
): { cleanedReminders: Reminder[]; purgedCount: number } {
  if (autoPurgeDays <= 0) {
    return { cleanedReminders: reminders, purgedCount: 0 };
  }

  const now = new Date().getTime();
  const cutoffTime = now - autoPurgeDays * 24 * 60 * 60 * 1000;
  let purgedCount = 0;

  const cleaned = reminders.map((r) => {
    const createdTime = new Date(r.createdAt).getTime();
    if (r.isCompleted && createdTime < cutoffTime && r.documentUrl) {
      purgedCount++;
      return {
        ...r,
        documentUrl: undefined, // Strip sensitive scan image after purge timer
        auditLogs: [
          ...(r.auditLogs || []),
          createAuditLog('Auto-Purge Document Image', `Document scan auto-purged after ${autoPurgeDays} days for privacy Compliance.`, 'System Vault'),
        ],
      };
    }
    return r;
  });

  return { cleanedReminders: cleaned, purgedCount };
}
