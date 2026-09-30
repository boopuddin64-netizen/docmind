/**
 * Resilient Gemini call for /api/scan-document.
 *
 * Evidence (production runtime logs + direct calls with the production key, 2026-09-30): the model regularly answers
 *   - 503 UNAVAILABLE "This model is currently experiencing high demand" (per model, comes and goes within seconds), and
 *   - 429 RESOURCE_EXHAUSTED on the FREE tier ("generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash",
 *     a per-MODEL daily quota),
 * while the old code made exactly ONE call to ONE model and turned any error into a generic 502.
 *
 * Strategy: walk a chain of models. Overloaded / timed-out / network errors are retried once on the same model after a short
 * backoff, then the next model is tried; a quota (429) error moves on to the next model right away (quota is per model);
 * a missing model (404) is skipped; auth / bad-request errors stop immediately. Everything is bounded by a total time budget
 * and a per-attempt timeout, so the function always answers well before the client gives up. The chain is configurable through the
 * optional GEMINI_MODELS env var; the number of calls is capped (see DEFAULT_MAX_ATTEMPTS).
 */

/**
 * Default chain, best quality / reliability first. Each model has its own capacity and its own free-tier quota.
 * The first four are the original chain. The last four were added after probing the models API with the production key
 * (2026-09-30, generateContent + our JSON responseSchema + image input): gemini-3.5-flash, gemini-3-flash-preview,
 * gemini-flash-lite-latest and gemini-3.1-flash-lite all returned a schema-valid answer. Rejected / skipped: gemini-2.5-* (404, no
 * longer available to new users), gemini-3.1-pro-preview (429, no free-tier quota), gemma-4-* (schema OK but ~30 s, over the
 * per-attempt timeout).
 */
export const DEFAULT_SCAN_MODELS: readonly string[] = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];

/** Hard cap on the chain length, however GEMINI_MODELS is set. */
export const MAX_SCAN_MODELS = 10;
/** Hard cap on model calls per scan (the time budget usually stops the walk earlier). */
export const DEFAULT_MAX_ATTEMPTS = 10;
/** The same-model retry is only used while fewer than this many attempts were made, so later models still get a turn. */
const SAME_MODEL_RETRY_UNTIL_ATTEMPT = 4;

/**
 * Parses the optional GEMINI_MODELS env var (comma-separated, e.g. "gemini-3.6-flash, gemini-3.5-flash"). Accepts an optional
 * "models/" prefix, ignores blanks, invalid names and duplicates, and keeps at most MAX_SCAN_MODELS. An unset / empty / fully invalid
 * value gives the default chain.
 */
export function parseModelList(raw: string | undefined | null): string[] {
  if (!raw) return [...DEFAULT_SCAN_MODELS];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const name = part.trim().replace(/^models\//i, "");
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name)) seen.add(name);
  }
  const list = [...seen].slice(0, MAX_SCAN_MODELS);
  return list.length > 0 ? list : [...DEFAULT_SCAN_MODELS];
}

/** The chain in effect: GEMINI_MODELS when set, otherwise DEFAULT_SCAN_MODELS. */
export function resolveScanModels(env: Record<string, string | undefined> = process.env): string[] {
  return parseModelList(env.GEMINI_MODELS);
}

export interface GeminiRetryOptions {
  /** Model chain; default = GEMINI_MODELS env (comma-separated) or DEFAULT_SCAN_MODELS. */
  models?: readonly string[];
  /** Max model calls for the whole scan (default 10). */
  maxAttempts?: number;
  /** Whole-call budget in ms (default 45 s; vercel.json allows the function 60 s and the client waits 75 s). */
  budgetMs?: number;
  /** One model call is aborted after this long (default 20 s). */
  attemptTimeoutMs?: number;
  /** Wait before the same-model retry (default 900 ms, plus jitter). */
  backoffMs?: number;
  /** A new attempt is only started when at least this much budget is left (default 6 s). */
  minAttemptMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called for every failed attempt (server log only). */
  onAttemptFailed?: (info: { model: string; kind: GeminiErrorKind; status?: number; attempt: number }) => void;
}

export type GeminiErrorKind = "quota" | "overloaded" | "timeout" | "network" | "model-missing" | "auth" | "bad-request" | "bad-output" | "unknown";

/** Why the whole call failed, for the HTTP layer: busy = worth retrying soon, failed = this document/model output. */
export type GeminiFailureKind = "busy" | "failed" | "auth";

export class GeminiCallError extends Error {
  constructor(public readonly failure: GeminiFailureKind, public readonly kinds: GeminiErrorKind[], public readonly lastStatus?: number) {
    super(`Gemini call failed (${failure}): ${kinds.join(",")}`);
    this.name = "GeminiCallError";
  }
}

export class BadModelOutputError extends Error {
  constructor(message = "Scan model returned an unusable result") {
    super(message);
    this.name = "BadModelOutputError";
  }
}

export function classifyGeminiError(e: unknown): { kind: GeminiErrorKind; status?: number; retryAfterMs?: number } {
  if (e instanceof BadModelOutputError) return { kind: "bad-output" };
  const anyE = e as any;
  const name = String(anyE?.name ?? "");
  const msg = String(anyE?.message ?? "");
  const status = typeof anyE?.status === "number" ? anyE.status : typeof anyE?.code === "number" ? anyE.code : undefined;
  if (name === "AttemptTimeoutError" || name === "AbortError" || name === "TimeoutError") return { kind: "timeout" };
  if (status === 429) {
    const m = /retry in ([\d.]+)\s*s/i.exec(msg);
    return { kind: "quota", status, retryAfterMs: m ? Math.ceil(Number(m[1]) * 1000) : undefined };
  }
  if (status !== undefined && status >= 500) return { kind: "overloaded", status };
  if (status === 404) return { kind: "model-missing", status };
  if (status === 401 || status === 403 || (status === 400 && /API key|permission|billing/i.test(msg))) return { kind: "auth", status };
  if (status === 400) return { kind: "bad-request", status };
  if (name === "TypeError" || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) return { kind: "network" };
  return { kind: "unknown", status };
}

class AttemptTimeoutError extends Error {
  constructor() {
    super("Model call timed out");
    this.name = "AttemptTimeoutError";
  }
}

export interface GenerateRequest {
  contents: any;
  config?: Record<string, any>;
}

/**
 * Calls generateContent with retries/fallback and parses the JSON object the model returns. Resolves with the parsed object and
 * the model that produced it; rejects with GeminiCallError.
 */
export async function generateWithFallback(
  ai: { models: { generateContent: (args: any) => Promise<{ text?: string }> } },
  request: GenerateRequest,
  opts: GeminiRetryOptions = {},
): Promise<{ data: any; model: string; attempts: number }> {
  const models = opts.models && opts.models.length > 0 ? opts.models : resolveScanModels();
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.budgetMs ?? 45_000;
  const attemptTimeout = opts.attemptTimeoutMs ?? 20_000;
  const backoff = opts.backoffMs ?? 900;
  const minAttempt = opts.minAttemptMs ?? 6_000;
  const started = now();
  const remaining = () => budget - (now() - started);
  const kinds: GeminiErrorKind[] = [];
  let lastStatus: number | undefined;
  let attempts = 0;

  const runOnce = async (model: string) => {
    const controller = new AbortController();
    const limit = Math.max(1, Math.min(attemptTimeout, remaining()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => { controller.abort(); rej(new AttemptTimeoutError()); }, limit);
    });
    try {
      const response = await Promise.race([
        ai.models.generateContent({ model, contents: request.contents, config: { ...request.config, abortSignal: controller.signal } }),
        timeout,
      ]);
      let data: any;
      try { data = JSON.parse(response.text || "{}"); } catch { throw new BadModelOutputError(); }
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new BadModelOutputError();
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  outer: for (const model of models) {
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      if (attempts > 0 && (remaining() < minAttempt || attempts >= maxAttempts)) break outer;
      attempts++;
      try {
        const data = await runOnce(model);
        return { data, model, attempts };
      } catch (e) {
        const info = classifyGeminiError(e);
        kinds.push(info.kind);
        if (info.status !== undefined) lastStatus = info.status;
        opts.onAttemptFailed?.({ model, kind: info.kind, status: info.status, attempt: attempts });
        if (info.kind === "auth") throw new GeminiCallError("auth", kinds, lastStatus);
        if (info.kind === "bad-request" || info.kind === "unknown") throw new GeminiCallError("failed", kinds, lastStatus);
        // Quota is per model, a missing model never comes back, unusable output deserves a different model: move on at once.
        if (info.kind === "quota") {
          const isLast = model === models[models.length - 1];
          if (isLast && tryNo === 0 && info.retryAfterMs !== undefined && info.retryAfterMs <= 8_000 && remaining() > info.retryAfterMs + minAttempt) {
            await sleep(info.retryAfterMs + 250);
            continue; // per-minute limit on the last model: one patient retry
          }
          break;
        }
        if (info.kind === "model-missing" || info.kind === "bad-output") break;
        // overloaded / timeout / network: one more try on the same model after a short backoff, then the next model.
        if (tryNo === 0 && attempts < SAME_MODEL_RETRY_UNTIL_ATTEMPT && remaining() > backoff + minAttempt) await sleep(backoff + Math.floor(Math.random() * 300));
        else break;
      }
    }
  }
  const busy = kinds.some((k) => k === "quota" || k === "overloaded" || k === "timeout" || k === "network");
  throw new GeminiCallError(busy ? "busy" : "failed", kinds, lastStatus);
}
