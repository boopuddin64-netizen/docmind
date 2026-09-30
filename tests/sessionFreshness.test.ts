import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import {
  HIDDEN_REFRESH_AFTER_MS, SESSION_AGE_MIN_HIDDEN_MS, SESSION_MAX_AGE_MS, decideFreshness, installSessionFreshness, type FreshnessDeps,
} from '../src/lib/sessionFreshness';

const MIN = 60_000;
const H = 3600_000;

test('thresholds: 30 min hidden, 8 h session age, 1 min minimum away for the age rule', () => {
  assert.equal(HIDDEN_REFRESH_AFTER_MS, 30 * MIN);
  assert.equal(SESSION_MAX_AGE_MS, 8 * H);
  assert.equal(SESSION_AGE_MIN_HIDDEN_MS, MIN);
});

test('decide: short trips away never refresh; a long absence does', () => {
  const base = { sessionStart: 0, busy: false };
  assert.equal(decideFreshness({ ...base, now: 10 * MIN, hiddenAt: 9 * MIN }), 'none');
  assert.equal(decideFreshness({ ...base, now: 10 * MIN + 29 * MIN, hiddenAt: 10 * MIN }), 'none');
  assert.equal(decideFreshness({ ...base, now: 10 * MIN + 30 * MIN, hiddenAt: 10 * MIN }), 'refresh');
  assert.equal(decideFreshness({ ...base, now: 3 * H, hiddenAt: H }), 'refresh');
});

test('decide: not hidden => nothing (e.g. focus event without a prior hide)', () => {
  assert.equal(decideFreshness({ now: 20 * H, hiddenAt: null, sessionStart: 0, busy: false }), 'none');
});

test('decide: an 8h+ old session refreshes on the next return, but never interrupts a sub-minute app switch', () => {
  assert.equal(decideFreshness({ now: 9 * H, hiddenAt: 9 * H - 30_000, sessionStart: 0, busy: false }), 'none');
  assert.equal(decideFreshness({ now: 9 * H, hiddenAt: 9 * H - 2 * MIN, sessionStart: 0, busy: false }), 'refresh');
  assert.equal(decideFreshness({ now: 7 * H, hiddenAt: 7 * H - 5 * MIN, sessionStart: 0, busy: false }), 'none');
});

test('decide: a modal / unsaved draft defers instead of refreshing', () => {
  assert.equal(decideFreshness({ now: 2 * H, hiddenAt: 0, sessionStart: 0, busy: true }), 'defer');
  assert.equal(decideFreshness({ now: 2 * MIN, hiddenAt: MIN, sessionStart: 0, busy: true }), 'none');
});

test('decide: clock going backwards / NaN => nothing', () => {
  assert.equal(decideFreshness({ now: 1000, hiddenAt: 5 * H, sessionStart: 0, busy: false }), 'none');
  assert.equal(decideFreshness({ now: NaN, hiddenAt: 0, sessionStart: 0, busy: false }), 'none');
});

function harness(busy = false) {
  let now = 1_000_000;
  let visible = true;
  const log = { saved: 0, refreshed: 0, deferred: 0, order: [] as string[] };
  const doc = new Map<string, () => void>();
  const win = new Map<string, () => void>();
  const deps: FreshnessDeps = {
    now: () => now,
    isVisible: () => visible,
    isBusy: () => busy,
    saveState: () => { log.saved++; log.order.push('save'); },
    refresh: () => { log.refreshed++; log.order.push('refresh'); },
    defer: () => { log.deferred++; },
    addDocListener: (t, f) => void doc.set(t, f),
    removeDocListener: (t) => void doc.delete(t),
    addWinListener: (t, f) => void win.set(t, f),
    removeWinListener: (t) => void win.delete(t),
  };
  const off = installSessionFreshness(deps);
  return {
    log, doc, win, off,
    hide: () => { visible = false; doc.get('visibilitychange')?.(); },
    show: () => { visible = true; doc.get('visibilitychange')?.(); },
    advance: (ms: number) => { now += ms; },
    setBusy: (b: boolean) => { busy = b; },
  };
}

test('flow (standalone PWA): background 5 min => nothing; background 45 min => state saved, then refresh', () => {
  const h = harness();
  h.hide(); h.advance(5 * MIN); h.show();
  assert.equal(h.log.refreshed, 0);
  h.hide(); h.advance(45 * MIN); h.show();
  assert.equal(h.log.refreshed, 1);
  assert.deepEqual(h.log.order, ['save', 'refresh']);
});

test('flow: pagehide + pageshow (bfcache resume in iOS standalone) also triggers after a long absence, once', () => {
  const h = harness();
  h.win.get('pagehide')!(); h.advance(2 * H);
  h.win.get('pageshow')!();
  h.doc.get('visibilitychange')!(); // visible again right after pageshow: hiddenAt already consumed
  assert.equal(h.log.refreshed, 1);
});

test('flow: busy (modal or draft open) => banner deferred, no reload, and asked only once per absence', () => {
  const h = harness(true);
  h.hide(); h.advance(2 * H); h.show();
  assert.equal(h.log.refreshed, 0);
  assert.equal(h.log.deferred, 1);
  h.show();
  assert.equal(h.log.deferred, 1);
});

test('flow: cleanup removes every listener', () => {
  const h = harness();
  h.off();
  assert.equal(h.doc.size + h.win.size, 0);
});

test('wiring: App installs the freshness hook with drafts + modals as busy, and swRegister exposes refresh / banner helpers', async () => {
  const app = await fs.readFile('src/App.tsx', 'utf8');
  assert.match(app, /installSessionFreshness/);
  assert.match(app, /hasLiveDrafts\(\)/);
  const sw = await fs.readFile('src/lib/swRegister.ts', 'utf8');
  assert.match(sw, /export function refreshApp/);
  assert.match(sw, /export function announceRefreshAvailable/);
});
