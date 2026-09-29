/**
 * End-to-end: real server process (server.ts → same Express API app as the Vercel function), REAL web-push
 * encryption/VAPID signing, delivered to a local fake push service (HTTPS, self-signed). No browser/client is
 * connected when the push is sent — the server alone must deliver it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import webpush from 'web-push';

const b64u = (b: Buffer) => b.toString('base64url');

/** RFC 8188 (aes128gcm) + RFC 8291 decrypt, i.e. what the browser does with the received push. */
function decryptWebPush(body: Buffer, uaPrivate: crypto.KeyObject, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const asKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), asPublic]), format: 'der', type: 'spki' });
  const shared = crypto.diffieHellman({ privateKey: uaPrivate, publicKey: asKey });
  const hkdf = (s: Buffer, ikm: Buffer, info: Buffer, len: number) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len));
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--; // strip padding + delimiter (0x02)
  return plain.subarray(0, end).toString('utf8');
}

const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('e2e: server delivers a real encrypted Web Push while no client is connected; no duplicates', { timeout: 90_000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-e2e-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  } catch {
    t.skip('openssl not available for the fake HTTPS push service');
    return;
  }

  // Fake push service
  const received: Array<{ url: string; headers: any; body: Buffer }> = [];
  const pushSrv = https.createServer({ key: await fs.readFile(path.join(dir, 'k.pem')), cert: await fs.readFile(path.join(dir, 'c.pem')) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ url: req.url!, headers: req.headers, body: Buffer.concat(chunks) }); res.statusCode = 201; res.end(); });
  });
  await new Promise<void>((r) => pushSrv.listen(0, r));
  const pushPort = (pushSrv.address() as net.AddressInfo).port;

  // "Browser" keys
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const uaPublic = ecdh.getPublicKey();
  const uaPrivate = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(ecdh.getPrivateKey()), x: b64u(uaPublic.subarray(1, 33)), y: b64u(uaPublic.subarray(33, 65)) } });
  const authSecret = crypto.randomBytes(16);

  const vapid = webpush.generateVAPIDKeys();
  const port = await freePort();
  const env = {
    ...process.env, NODE_ENV: 'production', PORT: String(port), NODE_TLS_REJECT_UNAUTHORIZED: '0',
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:e2e@example.com',
    CRON_SECRET: 'e2e-secret', PUSH_ALLOW_LOCAL_TEST_ENDPOINTS: '1', PUSH_STORE_PATH: path.join(dir, 'store.json'), PUSH_LOCAL_SCHEDULER: '0',
  };
  // Production mode serves ./dist; only the API matters here, so the SPA fallback may 404/500 without dist.
  const server: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env, stdio: 'pipe', cwd: process.cwd() });
  let log = '';
  server.stdout!.on('data', (d) => (log += d)); server.stderr!.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/push/public-key`)).ok) break; } catch { /* starting */ } await sleep(200); }
    const keyRes = await (await fetch(`${base}/api/push/public-key`)).json();
    assert.equal(keyRes.publicKey, vapid.publicKey);

    // A client subscribes, syncs one reminder due in ~1.5s, then DISCONNECTS (nothing else talks to the server but the cron call).
    const sub = { endpoint: `https://localhost:${pushPort}/push/abc`, keys: { p256dh: b64u(uaPublic), auth: b64u(authSecret) } };
    const s = await (await fetch(`${base}/api/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub }) })).json();
    assert.ok(s.token && s.subscriptionId);
    const dueAt = Date.now() + 1500;
    const sync = await fetch(`${base}/api/push/sync-reminders`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ subscriptionId: s.subscriptionId, tzOffsetMinutes: -60, reminders: [{ id: 'rem-1', title: 'Renew passport', dueAt, leadMinutes: 0 }] }),
    });
    assert.equal(sync.status, 200);

    const dispatch = (auth?: string) => fetch(`${base}/api/dispatch-alerts`, { method: 'POST', headers: auth ? { authorization: auth } : {} });
    assert.equal((await dispatch()).status, 401, 'cron endpoint rejects missing secret');
    assert.equal((await dispatch('Bearer wrong')).status, 401, 'cron endpoint rejects wrong secret');

    let r = await (await dispatch('Bearer e2e-secret')).json();
    assert.equal(r.sent, 0, 'not due yet');
    assert.equal(received.length, 0);

    await sleep(1800);
    r = await (await dispatch('Bearer e2e-secret')).json();
    assert.equal(r.sent, 1);
    assert.equal(received.length, 1, 'push service received exactly one message while no client was connected');

    const msg = received[0];
    assert.equal(msg.url, '/push/abc');
    assert.equal(msg.headers['content-encoding'], 'aes128gcm');
    assert.match(String(msg.headers.authorization), /^vapid t=.+, k=.+$/);
    assert.equal(msg.headers.urgency, 'high');
    const payload = JSON.parse(decryptWebPush(msg.body, uaPrivate, uaPublic, authSecret));
    assert.equal(payload.title, 'Renew passport');
    assert.equal(payload.tag, 'rem-1');
    assert.equal(payload.reminderId, 'rem-1');
    assert.deepEqual(Object.keys(payload).sort(), ['body', 'dueAt', 'eventKey', 'reminderId', 'tag', 'title', 'url', 'v']);

    // Overlapping / repeated cron hits must not re-send
    const more = await Promise.all([dispatch('Bearer e2e-secret'), dispatch('Bearer e2e-secret'), dispatch('Bearer e2e-secret')]);
    for (const m of more) assert.equal((await m.json()).sent, 0);
    assert.equal(received.length, 1);

    // Restart the server: still no duplicate (sent-marker persisted)
    server.kill('SIGTERM');
    await new Promise((res) => server.once('exit', res));
    const server2 = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env, stdio: 'ignore', cwd: process.cwd() });
    try {
      for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/push/public-key`)).ok) break; } catch { /* starting */ } await sleep(200); }
      const after = await (await dispatch('Bearer e2e-secret')).json();
      assert.equal(after.sent, 0);
      assert.equal(received.length, 1);
    } finally { server2.kill('SIGTERM'); }
  } catch (e) {
    console.error('server log:\n' + log);
    throw e;
  } finally {
    server.kill('SIGTERM');
    pushSrv.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
