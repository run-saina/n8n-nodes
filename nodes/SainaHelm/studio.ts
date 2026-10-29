// Shared Studio contract helpers for the Saina Decision (v3) and Saina Trace nodes.
import type { IAllExecuteFunctions, IExecuteFunctions, IDataObject, IHttpRequestOptions, INodePropertyOptions, NodeParameterValueType } from 'n8n-workflow';

export const CLIENT_HEADER = { 'X-Saina-Client': 'n8n' };
export const QUESTION_TYPES: Record<string, string> = { noul: 'Yes / No', choice: 'Choose one', score: 'Rate on a scale' };
const ID = /^[A-Za-z0-9_.-]{1,120}$/;

export interface DiscoveryModel { name: string; question_types?: string[]; inputs?: string[]; max_questions?: number }
export interface Discovery {
  saina: { models: DiscoveryModel[] };
  providers: Array<{ id: string; name: string; adapter: string; models: DiscoveryModel[] }>;
  endpoints: Array<{ name: string; display_name: string; published_version: number; production_version: number | null; versions: number[]; questions_mode: string; inputs?: IDataObject }>;
}
export interface Decision { decision_id: string; status: string; answers: Record<string, { status?: string; [key: string]: unknown }>; error?: { code: string; message: string }; [key: string]: unknown }

export function serviceOrigin(baseUrl: unknown): string {
  let base: URL | null = null;
  try { base = new URL(String(baseUrl)); } catch { base = null; }
  if (!base) throw new Error('Invalid API Base URL');
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Use an HTTP(S) base URL without credentials, query, or fragment');
  return base.toString().replace(/\/$/, '');
}

export async function studioRequest(ctx: IAllExecuteFunctions, origin: string, method: 'GET' | 'POST', path: string, body?: IDataObject, timeout = 60): Promise<unknown> {
  const options: IHttpRequestOptions = { method, url: origin + path, headers: CLIENT_HEADER, json: true, timeout: timeout * 1000, disableFollowRedirect: true };
  if (body) options.body = body;
  return ctx.helpers.httpRequestWithAuthentication.call(ctx, 'sainaApi', options);
}

export async function discover(ctx: IAllExecuteFunctions, origin: string): Promise<Discovery> {
  const data = await studioRequest(ctx, origin, 'GET', '/v1/studio/discovery') as Partial<Discovery>;
  return { saina: { models: data?.saina?.models ?? [] }, providers: data?.providers ?? [], endpoints: data?.endpoints ?? [] };
}

// Dropdown entries. Saina is always first; Endpoint appears only when the account has a published endpoint.
export function providerOptions(d: Discovery): INodePropertyOptions[] {
  const options: INodePropertyOptions[] = [{ name: 'Saina', value: 'saina', description: 'Saina models on this account' }];
  for (const p of d.providers) if (p.id !== 'saina') options.push({ name: p.name, value: p.id, description: p.adapter });
  if (d.endpoints.length) options.push({ name: 'Endpoint', value: 'endpoint', description: 'A published Studio endpoint; its questions and thresholds are fixed by the version' });
  return options;
}
export function modelOptions(d: Discovery, provider: string): INodePropertyOptions[] {
  const models = provider === 'saina' ? d.saina.models : d.providers.find(p => p.id === provider)?.models ?? [];
  return models.map(m => ({ name: m.name, value: m.name, description: [(m.question_types ?? []).map(t => QUESTION_TYPES[t] ?? t).join(', '), (m.inputs ?? ['text']).join(' + ')].filter(Boolean).join(' · ') }));
}
export function endpointOptions(d: Discovery): INodePropertyOptions[] {
  return d.endpoints.map(e => ({ name: e.display_name || e.name, value: e.name, description: e.name + (e.production_version ? ' · production v' + e.production_version : ' · not promoted') }));
}
export function versionOptions(d: Discovery, endpoint: string): INodePropertyOptions[] {
  const e = d.endpoints.find(x => x.name === endpoint);
  if (!e) return [{ name: 'Production', value: 'production' }];
  const production = e.production_version ?? e.published_version;
  return [{ name: 'Production' + (production ? ' (v' + production + ')' : ''), value: 'production', description: 'Follows promotions' }, ...[...e.versions].reverse().map(v => ({ name: 'v' + v, value: String(v), description: 'Pinned' }))];
}

// The playground sends a JSON object or array as JSON and anything else as text.
export function parseState(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  const s = text.trim();
  if (/^[[{]/.test(s)) { try { return JSON.parse(s); } catch { /* sent as text */ } }
  return s;
}

export interface QuestionRow { id?: string; instructions: string; type: string; criteria?: string; minProbability?: number; noAtOrBelow?: number; yesAtOrAbove?: number }
export function buildQuestions(rows: QuestionRow[]): { questions: IDataObject; thresholds: IDataObject } {
  if (!rows.length || rows.length > 32) throw new Error('Add 1–32 questions');
  const questions: IDataObject = {}, thresholds: IDataObject = {};
  rows.forEach((row, index) => {
    const instructions = String(row.instructions ?? '').trim();
    if (!instructions) throw new Error('Question ' + (index+1) + ' needs instructions');
    const id = String(row.id ?? '').trim() || 'question_' + (index+1);
    if (!ID.test(id) || questions[id]) throw new Error('Question IDs must be unique and use letters, numbers, dots, underscores or hyphens');
    const lines = String(row.criteria ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const question: IDataObject = { type: row.type, instructions };
    if (row.type === 'choice') {
      if (lines.length < 2) throw new Error('Choose one needs 2–255 options, one per line as key: description');
      const criteria: IDataObject = {};
      for (const line of lines) {
        const [key, ...rest] = line.split(':');
        const name = key.trim();
        if (!name || name.length > 128 || criteria[name] !== undefined) throw new Error('Option names must be unique, nonblank and at most 128 characters');
        criteria[name] = rest.join(':').trim() || name;
      }
      question.criteria = criteria;
      if (row.minProbability) thresholds[id] = { min_selected_probability: row.minProbability };
    } else if (row.type === 'score') {
      if (lines.length < 2 || lines.length > 10) throw new Error('A scale needs 2–10 ordered levels, one per line');
      question.criteria = lines;
    } else if (row.type === 'noul') {
      if (row.noAtOrBelow || row.yesAtOrAbove) {
        const low = row.noAtOrBelow ?? 0, high = row.yesAtOrAbove ?? 1;
        if (!(low >= 0 && high <= 1 && low < high)) throw new Error('No and Yes cutoffs must satisfy 0 ≤ No < Yes ≤ 1');
        thresholds[id] = { no_at_or_below: low, yes_at_or_above: high };
      }
    } else throw new Error('Select a supported answer format');
    questions[id] = question;
  });
  return { questions, thresholds };
}

// Attachments become data URLs, the only media form the API accepts.
export async function attachments(ctx: IExecuteFunctions, item: number, binaryProperties: unknown, urls: unknown): Promise<string[]> {
  const out: string[] = [];
  for (const name of String(binaryProperties ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const meta = ctx.helpers.assertBinaryData(item, name);
    const buffer = await ctx.helpers.getBinaryDataBuffer(item, name);
    out.push('data:' + (meta.mimeType || 'application/octet-stream') + ';base64,' + buffer.toString('base64'));
  }
  let list: unknown = urls;
  if (typeof list === 'string' && list.trim()) { try { list = JSON.parse(list); } catch { list = [list]; } }
  for (const value of Array.isArray(list) ? list : []) {
    if (typeof value !== 'string' || !value.startsWith('data:')) throw new Error('Attachment URLs must be data: URLs');
    out.push(value);
  }
  return out;
}

export function readDecision(raw: unknown): Decision {
  const d = raw as Decision;
  if (!d || typeof d !== 'object' || typeof d.decision_id !== 'string' || typeof d.status !== 'string' || !d.answers || typeof d.answers !== 'object') throw new Error('Invalid decision response');
  return d;
}
export const accepted = (d: Decision) => d.status === 'completed' && Object.values(d.answers).every(a => a && a.status !== 'abstained');
// Provider payloads are large and repeat the input; the workflow keeps the decision itself.
export function compactDecision(d: Decision): IDataObject {
  const { raw_response, normalized_response, provider_request, ...rest } = d as IDataObject & Decision;
  void raw_response; void normalized_response; void provider_request;
  return rest as IDataObject;
}
export function parseJson(value: NodeParameterValueType | object, label: string): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  let parsed: unknown, valid = true;
  try { parsed = JSON.parse(value); } catch { valid = false; }
  if (!valid) throw new Error(label + ' must be valid JSON');
  return parsed;
}
export const identifier = (value: unknown, label: string) => {
  const s = String(value ?? '').trim();
  if (!ID.test(s)) throw new Error(label + ' must be 1–120 letters, numbers, dots, underscores or hyphens');
  return s;
};
