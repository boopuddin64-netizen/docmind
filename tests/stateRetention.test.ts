import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  DRAFT_PREFIX, DRAFT_TTL_MS, SNAPSHOT_KEY, SNAPSHOT_TTL_MS, STATE_PREFIX, EMPTY_SNAPSHOT,
  clearDraft, clearDrafts, disablePersistence, docSignature, enablePersistenceForTests, flushPendingWrites, isDefaultSnapshot, listStateKeys,
  loadDraft, mergeItems, packItems, persistableDoc, pickStrings, readSnapshot, restoreScroll, sanitizeSnapshot, saveDraftNow, scheduleDraft,
  setStateStorage, writeSnapshot, type KV, type UiSnapshot,
} from '../src/lib/persistedState';
import { clearAppStorage, RESET_STORAGE_KEYS } from '../src/lib/resetData';
import { shouldCheckForUpdate } from '../src/lib/swRegister';

function memStorage(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  } as any;
}

let kv: ReturnType<typeof memStorage>;
beforeEach(() => {
  enablePersistenceForTests();
  kv = memStorage();
  setStateStorage(kv);
});

const NOW = 1_900_000_000_000;
const snap = (over: Partial<UiSnapshot> = {}): UiSnapshot => ({ ...EMPTY_SNAPSHOT, scroll: {}, ...over });

// ───────── snapshot: screen / modal / scroll survive a cold start ─────────
test('snapshot: tab, open detail, open modals, search and per-tab scroll round-trip', () => {
  const s = snap({ tab: 'reminders', scroll: { reminders: 1234.6, home: 80 }, search: 'rent', detailId: 'rem_1', addManual: true, notifications: true });
  assert.equal(writeSnapshot(s, NOW), true);
  const back = readSnapshot(NOW + 60_000)!;
  assert.equal(back.tab, 'reminders');
  assert.deepEqual(back.scroll, { reminders: 1235, home: 80 });
  assert.equal(back.search, 'rent');
  assert.equal(back.detailId, 'rem_1');
  assert.equal(back.addManual, true);
  assert.equal(back.notifications, true);
  assert.equal(back.upload, false);
});

test('snapshot: nothing / expired / corrupt / wrong version / future-dated => undefined (normal cold start)', () => {
  assert.equal(readSnapshot(NOW), undefined);
  writeSnapshot(snap({ tab: 'profile' }), NOW);
  assert.equal(readSnapshot(NOW + SNAPSHOT_TTL_MS + 1), undefined, 'expired');
  assert.ok(readSnapshot(NOW + SNAPSHOT_TTL_MS - 1));
  kv.setItem(SNAPSHOT_KEY, '{not json');
  assert.equal(readSnapshot(NOW), undefined);
  kv.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 99, t: NOW, d: { tab: 'profile' } }));
  assert.equal(readSnapshot(NOW), undefined);
  kv.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 1, t: NOW + 3 * 3600_000, d: { tab: 'profile' } }));
  assert.equal(readSnapshot(NOW), undefined, 'far-future timestamp is rejected');
});

test('snapshot: untrusted content is sanitised (unknown tab, huge/negative scroll, bad ids, preview without a document)', () => {
  const s = sanitizeSnapshot({ tab: 'hacker', scroll: { home: -5, reminders: 1e12, profile: 'x' }, search: 'x'.repeat(999), detailId: { a: 1 }, upload: 'yes', pendingDoc: 'nope' });
  assert.equal(s.tab, 'home');
  assert.deepEqual(s.scroll, {});
  assert.equal(s.search.length, 200);
  assert.equal(s.detailId, null);
  assert.equal(s.upload, false);
  assert.equal(s.pendingDoc, null);
  assert.equal(sanitizeSnapshot({ tab: 'preview' }).tab, 'home', 'preview screen needs its document');
  assert.equal(sanitizeSnapshot({ tab: 'preview', pendingDoc: { eventTitle: 'x' } }).tab, 'preview');
  assert.equal(sanitizeSnapshot({ humanReview: true }).humanReview, false);
  assert.equal(sanitizeSnapshot(null).tab, 'home');
  assert.ok(isDefaultSnapshot(sanitizeSnapshot(undefined)));
});

test('snapshot: big scan images are not persisted (quota), text is bounded, rawJson dropped; nested items handled', () => {
  const doc = { eventTitle: 'x', documentUrl: 'data:image/jpeg;base64,' + 'A'.repeat(500_000), fullText: 'y'.repeat(200_000), rawJson: { big: 1 }, extractedItems: [{ documentUrl: 'data:' + 'B'.repeat(200_000), eventTitle: 'i' }] };
  const p = persistableDoc(doc)!;
  assert.equal(p.documentUrl, undefined);
  assert.equal(p.fullText.length, 30_000);
  assert.equal(p.rawJson, undefined);
  assert.equal(p.extractedItems[0].documentUrl, undefined);
  assert.equal(p.extractedItems[0].eventTitle, 'i');
  assert.equal(persistableDoc({ documentUrl: 'data:small' })!.documentUrl, 'data:small');
  writeSnapshot(snap({ tab: 'preview', pendingDoc: doc }), NOW);
  assert.ok((kv.getItem(SNAPSHOT_KEY) || '').length < 100_000);
});

test('storage failures never throw (quota exceeded / storage blocked)', () => {
  setStateStorage({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } });
  assert.equal(writeSnapshot(snap(), NOW), false);
  assert.equal(readSnapshot(NOW), undefined);
  assert.equal(loadDraft('x'), undefined);
  assert.doesNotThrow(() => { saveDraftNow('x', { a: 1 }); clearDraft('x'); clearDrafts('x'); flushPendingWrites(); });
  setStateStorage(null);
  assert.equal(writeSnapshot(snap(), NOW), false);
});

// ───────── drafts: in-progress forms ─────────
test('draft: saved, restored, signature-bound, expiring; cleared explicitly', () => {
  saveDraftNow('addManual', { eventTitle: 'Half typed' }, undefined, NOW);
  assert.deepEqual(loadDraft('addManual', undefined, NOW + 1000), { eventTitle: 'Half typed' });
  assert.equal(loadDraft('addManual', undefined, NOW + DRAFT_TTL_MS + 1), undefined);
  saveDraftNow('reminderEdit', { shortNote: 'edited' }, 'rem_1', NOW);
  assert.deepEqual(loadDraft('reminderEdit', 'rem_1', NOW), { shortNote: 'edited' });
  assert.equal(loadDraft('reminderEdit', 'rem_2', NOW), undefined, 'a draft never leaks onto another reminder');
  clearDraft('addManual');
  assert.equal(kv.getItem(DRAFT_PREFIX + 'addManual'), null);
});

test('draft: debounced writes are flushed when the page is hidden (pagehide / visibilitychange)', async () => {
  scheduleDraft('addManual', { eventTitle: 'typing…' });
  assert.equal(kv.getItem(DRAFT_PREFIX + 'addManual'), null, 'not written yet (debounce)');
  assert.deepEqual(loadDraft('addManual'), { eventTitle: 'typing…' }, 'but a remount within the debounce window still sees it');
  flushPendingWrites(NOW);
  assert.ok(kv.getItem(DRAFT_PREFIX + 'addManual'));
  scheduleDraft('other', { a: 1 });
  await new Promise((r) => setTimeout(r, 320));
  assert.ok(kv.getItem(DRAFT_PREFIX + 'other'), 'debounce timer writes too');
});

test('draft: clearDrafts(prefix) removes stored and pending entries; discarded scans drop their edit drafts', () => {
  saveDraftNow('previewEdit', { x: 1 }); saveDraftNow('reviewEdit', { x: 1 }); saveDraftNow('addManual', { x: 1 });
  scheduleDraft('previewEdit2', { x: 1 });
  clearDrafts('previewEdit'); clearDrafts('reviewEdit');
  assert.equal(kv.getItem(DRAFT_PREFIX + 'previewEdit'), null);
  assert.equal(kv.getItem(DRAFT_PREFIX + 'reviewEdit'), null);
  assert.equal(loadDraft('previewEdit2'), undefined);
  assert.ok(kv.getItem(DRAFT_PREFIX + 'addManual'));
});

test('draft fields are validated: only listed string keys survive, truncated', () => {
  const d = pickStrings({ a: 'ok', b: 5, c: { x: 1 }, evil: '<script>', long: 'z'.repeat(9999) }, ['a', 'b', 'c', 'long'] as const, 100);
  assert.deepEqual(Object.keys(d).sort(), ['a', 'long']);
  assert.equal(d.long!.length, 100);
  assert.deepEqual(pickStrings('nope', ['a'] as const), {});
});

test('extracted-document edit drafts apply to the same document only, by index, string fields only', () => {
  const raw = [{ eventTitle: 'Rent', appointmentDate: '01/11/2026', appointmentTime: '', hospitalName: 'LL', patientName: 'Me', documentUrl: 'data:x', accuracy: 90 }, { eventTitle: 'Water', appointmentDate: '02/11/2026' }];
  const sig = docSignature(raw);
  assert.notEqual(sig, docSignature([raw[0]]));
  const edited = [{ ...raw[0], eventTitle: 'Rent (edited)' }, raw[1]];
  const packed = packItems(edited, 1);
  assert.ok(!('documentUrl' in packed.items[0]) && !('accuracy' in packed.items[0]), 'images and numbers are never drafted');
  const merged = mergeItems(raw as any[], packed)!;
  assert.equal(merged.items[0].eventTitle, 'Rent (edited)');
  assert.equal(merged.items[0].documentUrl, 'data:x', 'non-draft fields come from the fresh extraction');
  assert.equal(merged.sel, 1);
  assert.equal(mergeItems(raw as any[], { items: [{}], sel: 0 }), undefined, 'different item count => draft ignored');
  assert.equal(mergeItems(raw as any[], 'garbage'), undefined);
  assert.equal(mergeItems(raw as any[], { items: [{}, {}], sel: 99 })!.sel, 0);
});

// ───────── reset ─────────
test('Reset app data removes the UI snapshot and every draft, and stops later flushes (pagehide) from writing them back', () => {
  writeSnapshot(snap({ tab: 'profile' }), NOW);
  saveDraftNow('addManual', { eventTitle: 'x' });
  kv.setItem('docreminder_items', '[]');
  kv.setItem('unrelated_other_app_key', '1');
  scheduleDraft('profileEdit', { profileName: 'x' });
  assert.equal(listStateKeys(kv).length, 2);
  clearAppStorage(kv);
  assert.deepEqual([...kv.map.keys()], ['unrelated_other_app_key']);
  flushPendingWrites(); // what pagehide does right before the reload
  assert.equal(writeSnapshot(snap(), NOW), false);
  assert.deepEqual([...kv.map.keys()], ['unrelated_other_app_key'], 'nothing written back after the reset');
  assert.ok(RESET_STORAGE_KEYS.length >= 6);
  assert.ok(STATE_PREFIX.endsWith(':'));
});

test('disablePersistence blocks new drafts', () => {
  disablePersistence();
  scheduleDraft('x', { a: 1 });
  assert.equal(loadDraft('x'), undefined);
});

// ───────── scroll restore ─────────
test('restoreScroll waits for the page to become tall enough, then scrolls; gives up gracefully; can be cancelled', () => {
  let height = 500;
  const calls: number[] = [];
  const queue: Array<() => void> = [];
  const env = { getHeight: () => height, viewport: () => 600, scrollTo: (y: number) => void calls.push(y), requestFrame: (cb: () => void) => void queue.push(cb) };
  const run = () => { const q = queue.splice(0); q.forEach((f) => f()); };
  restoreScroll(1000, env);
  run(); run();
  assert.deepEqual(calls, [], 'page still too short');
  height = 1700; // list rendered
  run();
  assert.deepEqual(calls, [1000]);

  calls.length = 0; height = 700; queue.length = 0;
  restoreScroll(5000, env, 3);
  for (let i = 0; i < 6; i++) run();
  assert.deepEqual(calls, [100], 'gives up after maxFrames and scrolls as far as possible');

  calls.length = 0; queue.length = 0; height = 100;
  const cancel = restoreScroll(300, env);
  cancel();
  height = 5000; run(); run();
  assert.deepEqual(calls, []);
});

// ───────── no forced reloads / safe update flow ─────────
const ROOT = path.resolve(import.meta.dirname, '..');
async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('static: the only location.reload() calls are the two explicit user actions (reset / restore backup) and the update "Refresh" tap', async () => {
  const hits: string[] = [];
  for (const f of await sources(path.join(ROOT, 'src'))) {
    const src = await fs.readFile(f, 'utf8');
    if (/location\s*\.\s*(reload|replace)\s*\(|location\.href\s*=|history\.go\(/.test(src)) hits.push(path.relative(ROOT, f));
  }
  assert.deepEqual(hits.sort(), ['src/components/ProfileScreen.tsx', 'src/components/ResetAndBackupModal.tsx', 'src/lib/swRegister.ts']);
});

test('static: no handler reloads on focus / visibilitychange / pageshow / resume (the long-session rule lives in sessionFreshness.ts, tested there); no unload/beforeunload handlers (bfcache-safe)', async () => {
  for (const f of [...(await sources(path.join(ROOT, 'src'))), path.join(ROOT, 'index.html'), path.join(ROOT, 'public/sw.js')]) {
    const src = await fs.readFile(f, 'utf8');
    assert.doesNotMatch(src, /['"](unload|beforeunload)['"]/, `${path.relative(ROOT, f)} must not use unload/beforeunload (breaks bfcache)`);
  }
  const app = await fs.readFile(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.doesNotMatch(app, /reload\s*\(/);
  const sw = await fs.readFile(path.join(ROOT, 'src/lib/swRegister.ts'), 'utf8');
  // the single reload is guarded by an explicit user request
  assert.match(sw, /if \(!userRequested \|\| refreshing\) return;\s*refreshing = true;\s*window\.location\.reload\(\);/);
  const vis = sw.slice(sw.indexOf("addEventListener('visibilitychange'"));
  assert.doesNotMatch(vis.slice(0, vis.indexOf('});') + 3), /reload/);
  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /reload|serviceWorker/);
});

test('service worker: install does NOT skipWaiting; only a SKIP_WAITING message (user tapped Refresh) does; activation still claims clients', async () => {
  const src = await fs.readFile(path.join(ROOT, 'public/sw.js'), 'utf8');
  const listeners: Record<string, (e: any) => void> = {};
  let skipped = 0;
  const self: any = { location: { origin: 'https://app.example' }, addEventListener: (t: string, f: any) => { listeners[t] = f; }, skipWaiting() { skipped++; }, registration: {}, clients: { claim: async () => {} } };
  vm.runInNewContext(src, { self, URL, Response: class {}, console, caches: { open: async () => ({ add: async () => {} }), keys: async () => [], delete: async () => true, match: async () => undefined }, fetch: async () => ({}) });
  let p: Promise<unknown> = Promise.resolve();
  listeners.install({ waitUntil: (x: Promise<unknown>) => { p = x; } });
  await p;
  assert.equal(skipped, 0, 'a new version waits instead of taking over a page that is in use');
  listeners.message({ data: { type: 'something-else' } });
  listeners.message({ data: null });
  assert.equal(skipped, 0);
  listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipped, 1);
  assert.match(src, /docmind-pwa-v11/);
});

test('update checks are throttled and tolerate a clock that moved backwards', () => {
  assert.equal(shouldCheckForUpdate(1000, 1000 + 29 * 60_000), false);
  assert.equal(shouldCheckForUpdate(1000, 1000 + 30 * 60_000), true);
  assert.equal(shouldCheckForUpdate(5000, 1000), true);
  assert.equal(shouldCheckForUpdate(NaN, 1000), true);
});
