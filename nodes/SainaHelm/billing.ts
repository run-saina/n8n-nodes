import { randomBytes } from 'crypto';
import { sleepWithAbort } from 'n8n-workflow';
import type { IDataObject } from 'n8n-workflow';

export const CONSOLE_URL = 'https://saina.run/console/';
export const DEFAULT_BASE_URL = 'https://api.saina.run';

/** RFC 9562 UUIDv7: 48-bit Unix millisecond timestamp, version 7, variant 10, random remainder. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = Math.floor(now);
  for (let i = 5; i >= 0; i--) { bytes[i] = ms % 256; ms = Math.floor(ms / 256); }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7.test(value);
}

/** Converts a contract credit string to a Number only when it is exactly representable. */
export interface Credits { value: number; raw: string }
export class UnsafeCreditValue {
  constructor(public field: string, public raw: string) {}
  get message() {
    return `Saina returned ${this.field} = ${this.raw} credits, which is outside JavaScript's safe integer range (±${Number.MAX_SAFE_INTEGER}). The node does not round credit amounts; read the exact value from the API or contact Saina support.`;
  }
}
export function parseCredits(field: string, raw: unknown): Credits | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) throw new UnsafeCreditValue(field, text);
  const big = BigInt(text);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < -BigInt(Number.MAX_SAFE_INTEGER)) throw new UnsafeCreditValue(field, text);
  return { value: Number(big), raw: text };
}

export function header(headers: IDataObject | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value !== undefined && value !== null) return String(Array.isArray(value) ? value[0] : value);
  }
  return undefined;
}

/** Contract error body fields, plus client-side classification. Never contains request headers or credentials. */
export interface Failure {
  kind: 'api' | 'connection' | 'uncertain' | 'cancelled';
  code: string;
  message?: string;
  httpStatus?: number;
  requestId?: string;
  admitted?: boolean;
  state?: string;
  retry?: string;
  suspension?: { types?: string[]; next_step?: string };
  retryAfterMs?: number;
}
export type Outcome =
  | { ok: true; body: unknown; headers: IDataObject; statusCode: number; attempts: number }
  | { ok: false; failure: Failure; headers?: IDataObject; attempts: number };

export const TERMINAL_CODES = new Set([
  'inference_failed', 'idempotency_conflict', 'idempotency_result_expired', 'idempotency_unverifiable',
  'insufficient_credits', 'account_suspended', 'invalid_api_key', 'key_revoked', 'invalid_request', 'permission_denied',
  'fresh_auth_required', 'not_found',
]);
const ALWAYS_RETRY = new Set(['accounting_unavailable', 'request_in_progress', 'rate_limited']);
const RETRY_IF_NOT_ADMITTED = new Set(['overloaded', 'inference_unavailable']);
const CONNECTION_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_SOCKET_CONNECTION_TIMEOUT']);

export function isRetryable(failure: Failure): boolean {
  if (failure.kind === 'connection' || failure.kind === 'uncertain') return true;
  if (failure.kind !== 'api' || TERMINAL_CODES.has(failure.code)) return false;
  if (failure.retry !== undefined && failure.retry !== 'same_operation') return false;
  if (ALWAYS_RETRY.has(failure.code)) return true;
  return RETRY_IF_NOT_ADMITTED.has(failure.code) && failure.admitted === false;
}

export function parseRetryAfter(value: string | undefined, now: number = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function isFullResponse(value: unknown): value is { body: unknown; headers?: IDataObject; statusCode: number } {
  return !!value && typeof value === 'object' && typeof (value as IDataObject).statusCode === 'number' && 'body' in value;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try { return JSON.parse(body); } catch { return undefined; }
}

export function classifyResponse(response: unknown): Omit<Extract<Outcome, { ok: true }>, 'attempts'> | Omit<Extract<Outcome, { ok: false }>, 'attempts'> {
  // Tolerate helpers that return only the body (no status/headers).
  if (!isFullResponse(response)) return { ok: true, body: response, headers: {}, statusCode: 200 };
  const headers = response.headers ?? {};
  const statusCode = response.statusCode;
  const body = parseBody(response.body);
  if (statusCode >= 200 && statusCode < 300) return { ok: true, body, headers, statusCode };
  const retryAfterMs = parseRetryAfter(header(headers, 'retry-after'));
  const error = body && typeof body === 'object' ? (body as IDataObject).error : undefined;
  if (error && typeof error === 'object' && typeof (error as IDataObject).code === 'string') {
    const e = error as IDataObject;
    return { ok: false, headers, failure: {
      kind: 'api', code: e.code as string, httpStatus: statusCode,
      message: typeof e.message === 'string' ? e.message : undefined,
      requestId: typeof e.request_id === 'string' ? e.request_id : header(headers, 'x-request-id'),
      admitted: typeof e.admitted === 'boolean' ? e.admitted : undefined,
      state: typeof e.state === 'string' ? e.state : undefined,
      retry: typeof e.retry === 'string' ? e.retry : undefined,
      suspension: e.suspension && typeof e.suspension === 'object' ? e.suspension as Failure['suspension'] : undefined,
      retryAfterMs,
    } };
  }
  // A proxy/gateway failure without a contract body leaves the outcome unknown; retrying with the same key is safe.
  const uncertain = [502, 503, 504].includes(statusCode);
  return { ok: false, headers, failure: { kind: uncertain ? 'uncertain' : 'api', code: uncertain ? 'uncertain_response' : `http_${statusCode}`, httpStatus: statusCode, requestId: header(headers, 'x-request-id'), retryAfterMs } };
}

export function classifyThrown(error: unknown, signal?: AbortSignal): Failure {
  if (signal?.aborted) return { kind: 'cancelled', code: 'cancelled' };
  // n8n wraps transport errors in NodeApiError; the original error (with its code) is kept as `cause`.
  const e = (error ?? {}) as { code?: unknown; cause?: { code?: unknown; cause?: { code?: unknown } }; message?: unknown };
  const code = [e.code, e.cause?.code, e.cause?.cause?.code].find(c => typeof c === 'string' && CONNECTION_CODES.has(c)) as string | undefined;
  const message = typeof e.message === 'string' ? e.message : '';
  if (code || /timeout|timed out|socket hang up|network error|refused the connection|connection .*closed/i.test(message)) {
    return { kind: 'connection', code: code ?? 'connection_error' };
  }
  // Unknown client-side failures are not retried; the raw error is never exposed because it may echo request headers.
  return { kind: 'api', code: 'request_failed' };
}

export const retryTiming = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  /** A Retry-After longer than this stops automatic retries instead of blocking the workflow. */
  maxRetryAfterMs: 60_000,
  random: () => Math.random(),
  sleep: (ms: number, signal?: AbortSignal) => sleepWithAbort(ms, signal),
};

export function retryDelay(attempt: number, retryAfterMs?: number): number | null {
  if (retryAfterMs !== undefined && retryAfterMs > retryTiming.maxRetryAfterMs) return null;
  const backoff = Math.min(retryTiming.maxDelayMs, retryTiming.baseDelayMs * 2 ** attempt);
  const jittered = backoff / 2 + retryTiming.random() * (backoff / 2);
  return Math.round(Math.max(jittered, retryAfterMs ?? 0));
}

/**
 * Sends the same request (same Idempotency-Key, same body) up to 1 + maxRetries times.
 * Only transport loss, uncertain responses, and contract-retryable codes are retried.
 */
export async function sendWithRetries(send: () => Promise<unknown>, maxRetries: number, signal?: AbortSignal): Promise<Outcome> {
  for (let attempt = 0; ; attempt++) {
    let outcome: Outcome;
    try {
      outcome = { ...classifyResponse(await send()), attempts: attempt + 1 };
    } catch (error) {
      outcome = { ok: false, failure: classifyThrown(error, signal), attempts: attempt + 1 };
    }
    if (outcome.ok || attempt >= maxRetries || !isRetryable(outcome.failure)) return outcome;
    const delay = retryDelay(attempt, outcome.failure.retryAfterMs);
    if (delay === null) return outcome;
    await retryTiming.sleep(delay, signal);
  }
}

export function guidance(failure: Failure): string {
  switch (failure.code) {
    case 'insufficient_credits': return `Buy credits at ${CONSOLE_URL} and run the item again.`;
    case 'account_suspended': return failure.suspension?.next_step === 'buy_credits'
      ? `The account is suspended for an unpaid balance. Buy credits at ${CONSOLE_URL}.`
      : `The account is suspended. Review it at ${CONSOLE_URL} or contact Saina support.`;
    case 'invalid_api_key': return `Check the API key in the Saina Helm API credential. Hosted keys are created at ${CONSOLE_URL}.`;
    case 'key_revoked': return `This API key was revoked. Create a new key at ${CONSOLE_URL} and update the credential.`;
    case 'permission_denied': return 'This API key is not allowed to use this route.';
    case 'invalid_request': return 'Check Context, Question, Answers, and the Idempotency Key (a UUIDv7 no older than 24 hours).';
    case 'rate_limited': return 'Rate limit reached and automatic retries were exhausted. Reduce concurrency or try again later.';
    case 'overloaded':
    case 'inference_unavailable': return failure.admitted === false
      ? 'Saina is temporarily unavailable and the request was not admitted. Try again later.'
      : 'The request was admitted but did not complete. Run it again as a new operation (new Idempotency Key).';
    case 'accounting_unavailable': return 'Billing is temporarily unavailable. Retry later with the same Idempotency Key.';
    case 'request_in_progress': return 'A request with this Idempotency Key is still running. Retry later with the same key to get its result.';
    case 'inference_failed': return 'Inference failed and was not charged. Run it again with a new Idempotency Key.';
    case 'idempotency_conflict': return 'This Idempotency Key was already used with a different request. Use a new key for a new request.';
    case 'idempotency_result_expired': return 'The stored result for this Idempotency Key is no longer available and nothing was run again. Use a new key to run it again.';
    case 'idempotency_unverifiable': return 'Saina cannot verify this Idempotency Key after a recovery. Use a new key to run it again.';
    case 'fresh_auth_required': return 'Sign in to the console again to continue.';
    case 'cancelled': return 'The execution was cancelled.';
    default: return failure.kind === 'connection' || failure.kind === 'uncertain'
      ? 'The outcome is unknown. Retrying with the same Idempotency Key is safe and will not charge twice.'
      : 'Check your endpoint, credentials, and inputs.';
  }
}

/** Fields safe to place in execution output or error context. */
export function failureFields(failure: Failure, idempotencyKey: string, attempts: number): IDataObject {
  const out: IDataObject = { code: failure.code, message: failure.message ?? null, http_status: failure.httpStatus ?? null, request_id: failure.requestId ?? null,
    admitted: failure.admitted ?? null, state: failure.state ?? null, retry: failure.retry ?? null, idempotency_key: idempotencyKey, attempts, guidance: guidance(failure) };
  if (failure.suspension) out.suspension = failure.suspension as IDataObject;
  return out;
}

/** Response metadata from X-Saina-* headers. Throws UnsafeCreditValue instead of rounding large credit amounts. */
export function billingMetadata(headers: IDataObject, idempotencyKey: string, attempts: number): IDataObject {
  const charged = parseCredits('credits_charged', header(headers, 'x-saina-credits-charged'));
  const balance = parseCredits('balance', header(headers, 'x-saina-balance'));
  return {
    request_id: header(headers, 'x-request-id') ?? null,
    idempotency_key: idempotencyKey,
    credits_charged: charged?.value ?? null,
    credits_charged_raw: charged?.raw ?? null,
    balance: balance?.value ?? null,
    balance_raw: balance?.raw ?? null,
    price_version: header(headers, 'x-saina-price-version') ?? null,
    replayed: header(headers, 'x-saina-replayed')?.toLowerCase() === 'true',
    attempts,
  };
}
