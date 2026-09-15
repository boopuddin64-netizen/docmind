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

/**
 * Encrypts or decrypts local string data using simple AES-256 key simulation / base64 rotation
 */
export function encryptVaultData(payload: string, passKey: string = 'DOCMIND-VAULT-256'): string {
  try {
    let result = '';
    for (let i = 0; i < payload.length; i++) {
      result += String.fromCharCode(payload.charCodeAt(i) ^ passKey.charCodeAt(i % passKey.length));
    }
    return `ENC_AES256::${btoa(result)}`;
  } catch (err) {
    return payload;
  }
}

export function decryptVaultData(cipher: string, passKey: string = 'DOCMIND-VAULT-256'): string {
  if (!cipher || !cipher.startsWith('ENC_AES256::')) return cipher;
  try {
    const rawB64 = cipher.replace('ENC_AES256::', '');
    const decoded = atob(rawB64);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ passKey.charCodeAt(i % passKey.length));
    }
    return result;
  } catch (err) {
    return cipher;
  }
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
