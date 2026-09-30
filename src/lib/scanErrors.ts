/**
 * Classification of document-scan failures, so the UI can tell a NETWORK problem (retry helps) from an unsupported file,
 * a too-large file or a genuine AI/reading failure. Pure: no DOM, no Node APIs.
 *
 * The rules, in order:
 *  - device reports offline (navigator.onLine === false)              -> network / offline   (checked BEFORE any request)
 *  - fetch() rejected (TypeError: Failed to fetch / Load failed / NetworkError ...)   -> network / fetch
 *  - our own request timeout (AbortController) or an AbortError/TimeoutError          -> network / timeout
 *  - a lazy chunk (pdf.js / mammoth / SheetJS) could not be downloaded                -> network / chunk
 *  - HTTP 408, or a 5xx / 200 whose body is NOT our JSON envelope (Vercel/proxy/captive-portal HTML or text) -> network / upstream
 *  - our JSON envelope ({ success:false, code?, error }) is the app talking, so it is NOT a network problem:
 *      413 -> too-large, 429 -> rate-limited, 400/422 -> unsupported, 503 SCAN_UNAVAILABLE -> unavailable, other -> ai
 */

export type ScanFailureKind = 'network' | 'too-large' | 'unsupported' | 'rate-limited' | 'unavailable' | 'ai' | 'unknown';
export type NetworkReason = 'offline' | 'fetch' | 'timeout' | 'chunk' | 'upstream';

export const NETWORK_MESSAGE = 'Network problem while reading your document. Check your connection and try again.';
export const OFFLINE_MESSAGE = 'You appear to be offline. Network problem while reading your document. Connect to the internet and try again.';
export const TIMEOUT_MESSAGE = 'Network problem while reading your document: the connection is too slow or was interrupted. Check your connection and try again.';

/** Default request timeout. Vercel functions are capped at 60 s, so a request still open after this is a dead connection. */
export const SCAN_TIMEOUT_MS = 75_000;

export function networkMessage(reason: NetworkReason): string {
  return reason === 'offline' ? OFFLINE_MESSAGE : reason === 'timeout' ? TIMEOUT_MESSAGE : NETWORK_MESSAGE;
}

export class ScanError extends Error {
  readonly kind: ScanFailureKind;
  readonly reason?: NetworkReason;
  constructor(message: string, public readonly status?: number, kind?: ScanFailureKind, reason?: NetworkReason) {
    super(message);
    this.name = 'ScanError';
    this.kind = kind ?? (status !== undefined ? kindForStatus(status) : 'unknown');
    this.reason = reason;
  }
}

/** A ScanError for a connectivity problem, with the matching message. */
export function networkError(reason: NetworkReason, status?: number): ScanError {
  return new ScanError(networkMessage(reason), status, 'network', reason);
}

function kindForStatus(status: number): ScanFailureKind {
  if (status === 413) return 'too-large';
  if (status === 429) return 'rate-limited';
  if (status === 400 || status === 422 || status === 415) return 'unsupported';
  if (status === 408) return 'network';
  return 'unknown';
}

/** Failure of a lazy-loaded chunk (import() while offline / flaky). Messages differ per browser. */
export function isDynamicImportFailure(e: unknown): boolean {
  const name = String((e as any)?.name ?? '');
  const msg = String((e as any)?.message ?? e ?? '');
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Unable to preload CSS/i.test(msg)
  );
}

/** fetch() itself rejected: no response at all. Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError…", Node "fetch failed". */
export function isFetchNetworkFailure(e: unknown): boolean {
  const name = String((e as any)?.name ?? '');
  const msg = String((e as any)?.message ?? '');
  if (name === 'TypeError') return true; // per spec fetch() rejects with TypeError for every network error
  return /Failed to fetch|Load failed|NetworkError|network connection was lost|fetch failed|Network request failed|ERR_INTERNET_DISCONNECTED|ECONNRESET|ENOTFOUND|ETIMEDOUT/i.test(msg);
}

export function isAbortOrTimeout(e: unknown): boolean {
  const name = String((e as any)?.name ?? '');
  return name === 'AbortError' || name === 'TimeoutError';
}

export interface ScanFailure {
  kind: ScanFailureKind;
  message: string;
  reason?: NetworkReason;
  /** Trying the SAME request again can succeed. */
  retryable: boolean;
}

const GENERIC_MESSAGE = 'We could not scan this document. Please try again.';

/**
 * Turns anything thrown while scanning into { kind, message }. `online` is navigator.onLine at the time of the call: a TypeError
 * with the device offline is reported as "offline". Unknown errors keep a generic message and never expose raw exception text.
 */
export function classifyScanFailure(e: unknown, opts: { online?: boolean } = {}): ScanFailure {
  const online = opts.online !== false;
  if (e instanceof ScanError) {
    const reason = e.kind === 'network' ? (!online && e.reason !== 'offline' ? 'offline' : e.reason ?? 'upstream') : undefined;
    return {
      kind: e.kind,
      message: e.kind === 'network' ? networkMessage(reason!) : e.message,
      reason,
      retryable: e.kind === 'network' || e.kind === 'ai' || e.kind === 'unknown' || e.kind === 'rate-limited',
    };
  }
  if (isAbortOrTimeout(e)) return net(online ? 'timeout' : 'offline');
  if (isDynamicImportFailure(e)) return net(online ? 'chunk' : 'offline');
  if (isFetchNetworkFailure(e)) return net(online ? 'fetch' : 'offline');
  // Errors with a user-safe message from the browser-side readers (PrepareError, PdfReadError, OfficeReadError, PayloadTooLargeError).
  const name = String((e as any)?.name ?? '');
  const safe = e instanceof Error && e.message ? e.message : '';
  if (name === 'PayloadTooLargeError') return { kind: 'too-large', message: safe, retryable: false };
  if (name === 'PrepareError' || name === 'PdfReadError' || name === 'OfficeReadError') {
    return { kind: 'unsupported', message: safe || GENERIC_MESSAGE, retryable: false };
  }
  return { kind: 'unknown', message: GENERIC_MESSAGE, retryable: true };
}

function net(reason: NetworkReason): ScanFailure {
  return { kind: 'network', message: networkMessage(reason), reason, retryable: true };
}

// ───────────────────────── HTTP response → ScanError ─────────────────────────

export interface ResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<any>;
}

const FRIENDLY_BY_STATUS: Record<number, string> = {
  400: 'We could not read that file. Please try a clear photo, PDF or document.',
  413: 'That file is too large to upload (limit about 3 MB). Try a smaller file, or a smaller photo.',
  429: 'Too many scans in a short time. Please wait a few minutes and try again.',
  503: 'Document scanning is not available right now.',
};

/**
 * Reads a scan response. Returns the extracted data on success; throws a classified ScanError otherwise. A body that is not our
 * JSON envelope (gateway HTML/plain text, captive portal, truncated JSON) is an infrastructure/network failure, not an AI failure.
 */
export async function readScanResponse(response: ResponseLike): Promise<any> {
  const type = response.headers.get('content-type') || '';
  const isJson = /\bjson\b/i.test(type);
  if (!response.ok) {
    if (response.status === 413 || response.status === 429) {
      throw new ScanError(FRIENDLY_BY_STATUS[response.status], response.status);
    }
    if (response.status === 408 || (response.status >= 500 && !isJson) || (!isJson && response.status !== 400 && response.status !== 422)) {
      throw networkError('upstream', response.status);
    }
    let body: any = null;
    if (isJson) {
      try { body = await response.json(); } catch { /* fall through */ }
    }
    if (isJson && body === null) throw networkError('upstream', response.status); // cut-off body
    const serverMsg = typeof body?.error === 'string' ? body.error : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    const message = serverMsg || FRIENDLY_BY_STATUS[response.status] || GENERIC_MESSAGE;
    if (code === 'SCAN_UNAVAILABLE' || response.status === 503) throw new ScanError(message, response.status, 'unavailable');
    if (response.status === 400 || response.status === 422 || code === 'UNREADABLE_DOCUMENT') throw new ScanError(message, response.status, 'unsupported');
    throw new ScanError(message, response.status, 'ai');
  }
  if (!isJson) throw networkError('upstream', response.status);
  let body: any;
  try { body = await response.json(); } catch { throw networkError('upstream', response.status); }
  if (!body || body.success !== true || !body.data || typeof body.data !== 'object') {
    throw new ScanError(typeof body?.error === 'string' && body.error ? body.error : 'The scan did not return any results.', response.status, 'ai');
  }
  return body.data;
}

// ───────────────────────── request with timeout ─────────────────────────

export interface ScanRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Injectable for tests; defaults to navigator.onLine. */
  isOnline?: () => boolean;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * POSTs the scan request and returns the extracted data. One AbortController covers connecting, uploading AND reading the reply,
 * so a stalled mobile connection ends with a clear timeout error instead of an endless spinner.
 * Throws ScanError only (never a raw TypeError / AbortError / SyntaxError).
 */
export async function requestScan(body: unknown, opts: ScanRequestOptions = {}): Promise<any> {
  const isOnline = opts.isOnline ?? browserOnline;
  if (!isOnline()) throw networkError('offline'); // up front: no request, no waiting
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.timeoutMs ?? SCAN_TIMEOUT_MS);
  try {
    const response = await doFetch('/api/scan-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await readScanResponse(response);
  } catch (e) {
    if (e instanceof ScanError) throw e;
    if (timedOut || isAbortOrTimeout(e)) throw networkError(isOnline() ? 'timeout' : 'offline');
    if (isFetchNetworkFailure(e)) throw networkError(isOnline() ? 'fetch' : 'offline');
    throw e; // programming error: surfaced by classifyScanFailure as "unknown"
  } finally {
    clearTimeout(timer);
  }
}
