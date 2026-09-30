/**
 * UI state retention ("behave like a native app").
 *
 * Mobile browsers freeze, and often DISCARD, a backgrounded PWA; when the user comes back the page cold-starts and every
 * React `useState` is gone (screen, open modal, half-typed form, scroll). This module keeps a small amount of UI state in
 * localStorage so a cold start puts the user back where they were:
 *
 *  - a navigation SNAPSHOT (tab, open modal/detail, search, per-tab scroll)       -> readSnapshot / writeSnapshot
 *  - in-progress form DRAFTS (add reminder, profile edit, review edits, ...)       -> loadDraft / scheduleDraft / clearDrafts
 *
 * Writes are debounced and flushed on `pagehide` / `visibilitychange: hidden` (the last reliable moment on mobile).
 * Entries expire (snapshot 12 h, drafts 24 h), are versioned, validated on read, and every storage call is guarded so quota
 * errors / private mode never break the app. Nothing here reloads the page.
 *
 * Pure of React and of `window` (storage is injectable) so it is unit-tested in Node.
 */

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

export const STATE_PREFIX = 'docmind_ui:';
export const SNAPSHOT_KEY = `${STATE_PREFIX}snapshot`;
export const DRAFT_PREFIX = `${STATE_PREFIX}draft:`;
export const SNAPSHOT_TTL_MS = 12 * 3600_000;
export const DRAFT_TTL_MS = 24 * 3600_000;
const VERSION = 1;
/** Bigger than this (chars) is not persisted: a big scan image must not eat the localStorage quota. */
export const MAX_DATA_URL_CHARS = 100_000;
export const MAX_TEXT_CHARS = 30_000;

let storageOverride: KV | null | undefined;
/** Test hook. `null` disables persistence. */
export function setStateStorage(kv: KV | null | undefined): void {
  storageOverride = kv;
}
function storage(): KV | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // access can throw (blocked cookies / sandboxed iframe)
  }
}

let disabled = false;
/** After "Reset app data" the page is about to reload: nothing may write state back. */
export function disablePersistence(): void {
  disabled = true;
  pending.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
export function enablePersistenceForTests(): void {
  disabled = false;
}

interface Envelope<T> { v: number; t: number; sig?: string; d: T }

function write<T>(key: string, d: T, now: number, sig?: string): boolean {
  const kv = storage();
  if (!kv || disabled) return false;
  try {
    kv.setItem(key, JSON.stringify({ v: VERSION, t: now, ...(sig !== undefined ? { sig } : {}), d } satisfies Envelope<T>));
    return true;
  } catch {
    return false; // quota exceeded / storage unavailable: state retention is best effort
  }
}

function read<T>(key: string, ttl: number, now: number, sig?: string): T | undefined {
  const kv = storage();
  if (!kv) return undefined;
  try {
    const raw = kv.getItem(key);
    if (!raw) return undefined;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || env.v !== VERSION || typeof env.t !== 'number' || !('d' in env)) return undefined;
    if (now - env.t > ttl || env.t - now > 5 * 60_000) return undefined; // expired (or clock went backwards a lot)
    if (sig !== undefined && env.sig !== sig) return undefined; // draft belongs to something else
    return env.d;
  } catch {
    return undefined;
  }
}

// ───────────────────────── drafts ─────────────────────────

const pending = new Map<string, { value: unknown; sig?: string }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 250;

export function loadDraft<T>(name: string, sig?: string, now: number = Date.now()): T | undefined {
  // A not-yet-flushed newer value wins (component remounted within the debounce window).
  const p = pending.get(name);
  if (p && (sig === undefined || p.sig === sig)) return p.value as T;
  return read<T>(DRAFT_PREFIX + name, DRAFT_TTL_MS, now, sig);
}

export function saveDraftNow(name: string, value: unknown, sig?: string, now: number = Date.now()): void {
  pending.delete(name);
  const t = timers.get(name);
  if (t) { clearTimeout(t); timers.delete(name); }
  write(DRAFT_PREFIX + name, value, now, sig);
}

/** Debounced save; the value is also flushed by flushPendingWrites() on pagehide / hidden. */
export function scheduleDraft(name: string, value: unknown, sig?: string): void {
  if (disabled) return;
  pending.set(name, { value, sig });
  const old = timers.get(name);
  if (old) clearTimeout(old);
  timers.set(name, setTimeout(() => {
    timers.delete(name);
    const p = pending.get(name);
    if (p) saveDraftNow(name, p.value, p.sig);
  }, DEBOUNCE_MS));
}

export function flushPendingWrites(now: number = Date.now()): void {
  for (const [name, p] of [...pending]) saveDraftNow(name, p.value, p.sig, now);
}

export function clearDraft(name: string): void {
  pending.delete(name);
  const t = timers.get(name);
  if (t) { clearTimeout(t); timers.delete(name); }
  try { storage()?.removeItem(DRAFT_PREFIX + name); } catch { /* ignore */ }
}

/** Removes every draft whose name starts with `prefix` (e.g. 'addManual.' after the form was submitted). */
export function clearDrafts(prefix: string): void {
  for (const n of [...pending.keys()]) if (n.startsWith(prefix)) clearDraft(n);
  const kv = storage();
  if (!kv || typeof kv.length !== 'number' || !kv.key) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < kv.length; i++) {
      const k = kv.key(i);
      if (k && k.startsWith(DRAFT_PREFIX + prefix)) doomed.push(k);
    }
    for (const k of doomed) kv.removeItem(k);
  } catch { /* ignore */ }
}

/** True when at least one unexpired form draft exists (pending in memory or stored). Used to hold back a refresh. */
export function hasLiveDrafts(now: number = Date.now()): boolean {
  if (pending.size > 0) return true;
  const kv = storage();
  if (!kv || typeof kv.length !== 'number' || !kv.key) return false;
  try {
    for (let i = 0; i < kv.length; i++) {
      const k = kv.key(i);
      if (k && k.startsWith(DRAFT_PREFIX) && read<unknown>(k, DRAFT_TTL_MS, now) !== undefined) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** Every key this module owns (used by "Reset app data"). */
export function listStateKeys(kv: Pick<KV, 'length' | 'key'>): string[] {
  const out: string[] = [];
  try {
    if (typeof kv.length !== 'number' || !kv.key) return out;
    for (let i = 0; i < kv.length; i++) {
      const k = kv.key(i);
      if (k && k.startsWith(STATE_PREFIX)) out.push(k);
    }
  } catch { /* ignore */ }
  return out;
}

// ───────────────────────── navigation snapshot ─────────────────────────

export const TABS = ['home', 'reminders', 'profile', 'preview', 'vault'] as const;
export type SnapshotTab = (typeof TABS)[number];

export interface UiSnapshot {
  tab: SnapshotTab;
  /** window.scrollY per tab */
  scroll: Partial<Record<SnapshotTab, number>>;
  search: string;
  detailId: string | null;
  snoozePickerId: string | null;
  upload: boolean;
  addManual: boolean;
  notifications: boolean;
  vault: boolean;
  humanReview: boolean;
  /** Extracted document waiting for review / preview (large fields stripped, see persistableDoc). */
  pendingDoc: Record<string, any> | null;
  duplicate: { newDoc: Record<string, any>; existingId: string; similarityScore: number; reason: string; open: boolean } | null;
}

export const EMPTY_SNAPSHOT: UiSnapshot = Object.freeze({
  tab: 'home', scroll: {}, search: '', detailId: null, snoozePickerId: null,
  upload: false, addManual: false, notifications: false, vault: false, humanReview: false, pendingDoc: null, duplicate: null,
}) as UiSnapshot;

/** Copy of an extracted document that is safe to persist (no multi-MB image data URLs, bounded text). */
export function persistableDoc<T extends Record<string, any> | null | undefined>(doc: T): Record<string, any> | null {
  if (!doc || typeof doc !== 'object') return null;
  const strip = (d: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = { ...d };
    if (typeof out.documentUrl === 'string' && out.documentUrl.length > MAX_DATA_URL_CHARS) delete out.documentUrl;
    if (typeof out.fullText === 'string' && out.fullText.length > MAX_TEXT_CHARS) out.fullText = out.fullText.slice(0, MAX_TEXT_CHARS);
    delete out.rawJson;
    if (Array.isArray(out.extractedItems)) out.extractedItems = out.extractedItems.map((i: any) => (i && typeof i === 'object' ? strip(i) : i));
    return out;
  };
  return strip(doc);
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v: unknown) => v === true;
const idOrNull = (v: unknown) => (typeof v === 'string' && v && v.length <= 100 ? v : null);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validates untrusted (stored) data: anything unexpected falls back to a safe default, never throws. */
export function sanitizeSnapshot(raw: unknown): UiSnapshot {
  if (!isObj(raw)) return { ...EMPTY_SNAPSHOT, scroll: {} };
  const tab = (TABS as readonly string[]).includes(raw.tab) ? (raw.tab as SnapshotTab) : 'home';
  const scroll: UiSnapshot['scroll'] = {};
  if (isObj(raw.scroll)) {
    for (const t of TABS) {
      const y = raw.scroll[t];
      if (typeof y === 'number' && Number.isFinite(y) && y > 0 && y < 1e7) scroll[t] = Math.round(y);
    }
  }
  const pendingDoc = isObj(raw.pendingDoc) ? raw.pendingDoc : null;
  const dup = isObj(raw.duplicate) && isObj(raw.duplicate.newDoc) && idOrNull(raw.duplicate.existingId)
    ? { newDoc: raw.duplicate.newDoc, existingId: raw.duplicate.existingId as string, similarityScore: Number(raw.duplicate.similarityScore) || 0, reason: str(raw.duplicate.reason), open: bool(raw.duplicate.open) }
    : null;
  return {
    // The preview screen cannot exist without its document.
    tab: tab === 'preview' && !pendingDoc ? 'home' : tab,
    scroll,
    search: str(raw.search, 200),
    detailId: idOrNull(raw.detailId),
    snoozePickerId: idOrNull(raw.snoozePickerId),
    upload: bool(raw.upload),
    addManual: bool(raw.addManual),
    notifications: bool(raw.notifications),
    vault: bool(raw.vault),
    humanReview: bool(raw.humanReview) && !!pendingDoc,
    pendingDoc,
    duplicate: dup,
  };
}

export function isDefaultSnapshot(s: UiSnapshot): boolean {
  return s.tab === 'home' && !s.search && !s.detailId && !s.snoozePickerId && !s.upload && !s.addManual && !s.notifications && !s.vault
    && !s.humanReview && !s.pendingDoc && !s.duplicate && Object.keys(s.scroll).length === 0;
}

export function writeSnapshot(snapshot: UiSnapshot, now: number = Date.now()): boolean {
  const s = { ...snapshot, pendingDoc: persistableDoc(snapshot.pendingDoc), duplicate: snapshot.duplicate ? { ...snapshot.duplicate, newDoc: persistableDoc(snapshot.duplicate.newDoc) ?? {} } : null };
  return write(SNAPSHOT_KEY, s, now);
}

/** undefined when there is nothing (fresh / expired / corrupt) => normal cold start. */
export function readSnapshot(now: number = Date.now()): UiSnapshot | undefined {
  const raw = read<unknown>(SNAPSHOT_KEY, SNAPSHOT_TTL_MS, now);
  return raw === undefined ? undefined : sanitizeSnapshot(raw);
}

/** Keeps only the string fields listed in `keys` (drafts are untrusted input: wrong types are dropped, not trusted). */
export function pickStrings<K extends string>(raw: unknown, keys: readonly K[], max = 5000): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of keys) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string') out[k] = v.slice(0, max);
  }
  return out;
}

export function clearSnapshot(): void {
  try { storage()?.removeItem(SNAPSHOT_KEY); } catch { /* ignore */ }
}

// ───────────────────────── scroll restore ─────────────────────────

export interface ScrollEnv {
  getHeight(): number;
  viewport(): number;
  scrollTo(y: number): void;
  requestFrame(cb: () => void): void;
}

/**
 * Scrolls to `y` once the page is tall enough (content renders after the tab mounts, lists after data). Gives up after
 * `maxFrames` and scrolls as far as possible. Returns a cancel function (user scrolled / tab changed).
 */
export function restoreScroll(y: number, env: ScrollEnv, maxFrames = 30, onDone?: () => void): () => void {
  let cancelled = false;
  let frames = 0;
  const step = () => {
    if (cancelled) return;
    const reachable = env.getHeight() - env.viewport();
    if (reachable >= y || frames >= maxFrames) {
      env.scrollTo(Math.min(y, Math.max(0, reachable)));
      onDone?.();
      return;
    }
    frames++;
    env.requestFrame(step);
  };
  env.requestFrame(step);
  return () => { cancelled = true; };
}

// ───────────────────────── extracted-document edit drafts ─────────────────────────

/** The only fields a user edits on the review / preview screens (short strings; images and full text are never drafted). */
export const ITEM_FIELDS = ['hospitalName', 'patientName', 'diagnosis', 'appointmentDate', 'appointmentTime', 'eventTitle', 'shortNote', 'category'] as const;
export interface ItemsDraft { sel: number; items: Array<Partial<Record<(typeof ITEM_FIELDS)[number], string>>> }

/** Identity of a scanned document, so a draft is only applied to the document it was made for. */
export function docSignature(items: Array<Record<string, any>>): string {
  const first = items[0] || {};
  return JSON.stringify([items.length, first.eventTitle, first.appointmentDate, first.appointmentTime, first.hospitalName, first.patientName]);
}

export function packItems(items: Array<Record<string, any>>, sel: number): ItemsDraft {
  return { sel, items: items.map((it) => pickStrings(it, ITEM_FIELDS, 1000)) };
}

/** Applies a stored draft over the freshly extracted items (by index). Returns undefined when the draft does not fit. */
export function mergeItems<T extends Record<string, any>>(raw: T[], draft: unknown): { items: T[]; sel: number } | undefined {
  if (!isObj(draft) || !Array.isArray(draft.items) || draft.items.length !== raw.length) return undefined;
  const items = raw.map((r, i) => ({ ...r, ...pickStrings(draft.items[i], ITEM_FIELDS, 1000) }));
  const sel = Number.isInteger(draft.sel) && draft.sel >= 0 && draft.sel < raw.length ? draft.sel : 0;
  return { items, sel };
}
