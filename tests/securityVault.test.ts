import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptBackup,
  decryptBackup,
  decryptLegacyBackup,
  detectBackupFormat,
  validatePassphrase,
  VaultError,
  PBKDF2_ITERATIONS,
  MIN_PASSPHRASE_LENGTH,
} from '../src/lib/securityVault';

const PASS = 'correct horse battery staple';
const SAMPLE = JSON.stringify({
  version: '1.0',
  reminders: [{ id: 'r1', title: 'Dentist – café ☕ 日本語' }],
  userProfile: { name: 'Test' },
});

function b64ToBytes(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

test('vault: uses global Web Crypto', () => {
  assert.ok(globalThis.crypto?.subtle, 'globalThis.crypto.subtle must exist');
});

test('vault: encrypt/decrypt round trip (incl. unicode)', async () => {
  const enc = await encryptBackup(SAMPLE, PASS);
  assert.equal(await decryptBackup(enc, PASS), SAMPLE);
});

test('vault: envelope is versioned JSON with expected parameters', async () => {
  const enc = await encryptBackup(SAMPLE, PASS);
  const env = JSON.parse(enc);
  assert.equal(env.format, 'docmind-backup');
  assert.equal(env.version, 1);
  assert.equal(env.cipher, 'AES-256-GCM');
  assert.equal(env.kdf, 'PBKDF2-SHA256');
  assert.ok(env.iterations >= 210000);
  assert.equal(env.iterations, PBKDF2_ITERATIONS);
  assert.equal(b64ToBytes(env.salt).length, 16);
  assert.equal(b64ToBytes(env.iv).length, 12);
  assert.ok(b64ToBytes(env.data).length >= SAMPLE.length + 16);
  assert.ok(!enc.includes('Dentist'), 'plaintext must not appear in output');
  assert.equal(detectBackupFormat(enc), 'encrypted');
});

test('vault: wrong passphrase fails with DECRYPT_FAILED', async () => {
  const enc = await encryptBackup(SAMPLE, PASS);
  await assert.rejects(decryptBackup(enc, 'a different passphrase!'), (e: unknown) => {
    assert.ok(e instanceof VaultError);
    assert.equal(e.code, 'DECRYPT_FAILED');
    return true;
  });
});

test('vault: tampered ciphertext fails', async () => {
  const env = JSON.parse(await encryptBackup(SAMPLE, PASS));
  const data = b64ToBytes(env.data);
  data[0] ^= 0x01;
  env.data = data.toString('base64');
  await assert.rejects(decryptBackup(JSON.stringify(env), PASS), { code: 'DECRYPT_FAILED' });
});

test('vault: tampered IV, salt, or truncated data fails', async () => {
  const good = JSON.parse(await encryptBackup(SAMPLE, PASS));

  const ivT = { ...good, iv: (() => { const b = b64ToBytes(good.iv); b[0] ^= 1; return b.toString('base64'); })() };
  await assert.rejects(decryptBackup(JSON.stringify(ivT), PASS), { code: 'DECRYPT_FAILED' });

  const saltT = { ...good, salt: (() => { const b = b64ToBytes(good.salt); b[0] ^= 1; return b.toString('base64'); })() };
  await assert.rejects(decryptBackup(JSON.stringify(saltT), PASS), { code: 'DECRYPT_FAILED' });

  const trunc = { ...good, data: b64ToBytes(good.data).subarray(0, -1).toString('base64') };
  await assert.rejects(decryptBackup(JSON.stringify(trunc), PASS), { code: 'DECRYPT_FAILED' });
});

test('vault: downgrading iteration count in the envelope is rejected', async () => {
  const env = JSON.parse(await encryptBackup(SAMPLE, PASS));
  env.iterations = 1;
  await assert.rejects(decryptBackup(JSON.stringify(env), PASS), { code: 'INVALID_FORMAT' });
});

test('vault: garbage / wrong-format / future-version input gives clear errors', async () => {
  await assert.rejects(decryptBackup('not json at all', PASS), { code: 'INVALID_FORMAT' });
  await assert.rejects(decryptBackup('{"hello":1}', PASS), { code: 'INVALID_FORMAT' });
  const env = JSON.parse(await encryptBackup(SAMPLE, PASS));
  env.version = 99;
  await assert.rejects(decryptBackup(JSON.stringify(env), PASS), { code: 'UNSUPPORTED_VERSION' });
});

test('vault: salt and IV are unique per encryption (and ciphertexts differ)', async () => {
  const runs = await Promise.all(Array.from({ length: 5 }, () => encryptBackup(SAMPLE, PASS)));
  const envs = runs.map((r) => JSON.parse(r));
  assert.equal(new Set(envs.map((e) => e.salt)).size, envs.length);
  assert.equal(new Set(envs.map((e) => e.iv)).size, envs.length);
  assert.equal(new Set(envs.map((e) => e.data)).size, envs.length);
});

test('vault: weak passphrase is rejected on export', async () => {
  const short = 'x'.repeat(MIN_PASSPHRASE_LENGTH - 1);
  assert.ok(validatePassphrase(short));
  assert.equal(validatePassphrase('x'.repeat(MIN_PASSPHRASE_LENGTH)), null);
  await assert.rejects(encryptBackup(SAMPLE, short), { code: 'WEAK_PASSPHRASE' });
});

test('vault: legacy XOR backups still import', () => {
  // Build a legacy blob independently of the library code (old algorithm, hard-coded key).
  const key = 'DOCMIND-VAULT-256';
  // Old code used btoa on the raw string, so restrict to Latin1 here.
  const latin = JSON.stringify({ reminders: [{ id: 'a', title: 'Old backup' }], userProfile: { name: 'Legacy' } });
  let y = '';
  for (let i = 0; i < latin.length; i++) y += String.fromCharCode(latin.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  const legacy = `ENC_AES256::${btoa(y)}`;

  assert.equal(detectBackupFormat(legacy), 'legacy');
  assert.equal(decryptLegacyBackup(legacy), latin);
  assert.equal(decryptLegacyBackup(`  ${legacy}\n`), latin);
});

test('vault: legacy fixed vector decrypts (guards against accidental algorithm change)', () => {
  // Generated with the original (pre-fix) encryptVaultData('{"a":1}')
  const legacy = 'ENC_AES256::P20ib3N/OQ==';
  assert.equal(decryptLegacyBackup(legacy), '{"a":1}');
});

test('vault: malformed legacy input throws VaultError', () => {
  assert.throws(() => decryptLegacyBackup('ENC_AES256::!!!not-base64!!!'), VaultError);
  assert.throws(() => decryptLegacyBackup('plain'), VaultError);
});

test('vault: detectBackupFormat treats other JSON as plain', () => {
  assert.equal(detectBackupFormat('{"reminders":[]}'), 'plain');
  assert.equal(detectBackupFormat('[]'), 'plain');
});
