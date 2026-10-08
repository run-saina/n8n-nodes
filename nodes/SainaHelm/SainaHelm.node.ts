import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INode, INodeExecutionData, INodeType, INodeTypeDescription, JsonObject } from 'n8n-workflow';
import { billingMetadata, DEFAULT_BASE_URL, failureFields, guidance, header, isUuidV7, sendWithRetries, UnsafeCreditValue, uuidv7 } from './billing';
import type { Failure } from './billing';
import { readResponse, parseQuestions } from './contract';
import { buildQuestion, readAdvanced } from './form';
import type { AdvancedOptions } from './form';
export class SainaHelm implements INodeType {
  description: INodeTypeDescription = {
    subtitle: 'Ask Saina Helm', displayName: 'Saina Helm', name: 'sainaHelm', icon: { light: 'file:saina.svg', dark: 'file:saina.dark.svg' }, group: ['transform'], version: [1, 2], defaultVersion: 2,
    description: 'Ask typed questions and route rejected decisions to fallback', defaults: { name: 'Saina Helm' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main], outputNames: ['Selected', 'Fallback'],
    credentials: [{ name: 'sainaHelmApi', required: true }],
    properties: [
      { displayName: 'Context', name: 'context', type: 'string', typeOptions: { rows: 5 }, default: '', required: true, description: 'The text or facts to evaluate', displayOptions: { show: { '@version': [2] } } },
      { displayName: 'Question', name: 'question', type: 'string', typeOptions: { rows: 2 }, default: '', required: true, placeholder: 'Which team should handle this request?', description: 'What you want to know about the context', displayOptions: { show: { '@version': [2] } } },
      { displayName: 'Answers', name: 'answers', type: 'string', typeOptions: { rows: 4 }, default: '', required: true, placeholder: 'Billing\nTechnical support\nOther', description: 'Enter at least two answer labels, one per line or separated by commas. Descriptions are optional. Use one per line if labels contain commas.', displayOptions: { show: { '@version': [2] } } },
      {
        displayName: 'Advanced', name: 'advanced', type: 'collection', placeholder: 'Add Option', default: {}, displayOptions: { show: { '@version': [2] } },
        options: [
          { displayName: 'Answer Descriptions', name: 'descriptions', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, placeholder: 'Add Description', options: [
            { displayName: 'Descriptions', name: 'entries', values: [
              { displayName: 'Answer', name: 'answer', type: 'string', default: '', description: 'An exact answer label from the Answers field' },
              { displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 2 }, default: '', description: 'Additional meaning for this answer' },
            ] },
          ] },
          { displayName: 'Answer Type', name: 'answerType', type: 'options', default: 'single_choice', options: [
            { name: 'Single Answer', value: 'single_choice', description: 'Choose one answer' },
            { name: 'Multiple Answers', value: 'multi_choice', description: 'Select independent tags; requires a tagging-trained checkpoint' },
            { name: 'Yes / No', value: 'yes_no', description: 'Answers must be Yes and No' },
            { name: 'Rating', value: 'rating', description: 'Use 2–10 answers ordered from lowest to highest' },
          ] },
          { displayName: 'Confidence Threshold', name: 'threshold', type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0.8, description: 'Minimum top probability for an accepted decision. Ignored in Distribution mode. Tune with representative data.' },
          { displayName: 'Idempotency Key', name: 'idempotencyKey', type: 'string', default: '', placeholder: 'Auto-generated UUIDv7', description: 'Leave empty to generate one UUIDv7 per item per execution. Set a UUIDv7 from upstream data (for example an expression) to make re-runs of the same item replay the stored result instead of charging again. Must be at most 24 hours old.' },
          { displayName: 'Include Billing Metadata', name: 'includeBilling', type: 'boolean', default: true, description: 'Whether to add request ID, credits charged, balance, price version, replay status, and idempotency key under _saina' },
          { displayName: 'Max Retries', name: 'maxRetries', type: 'number', typeOptions: { minValue: 0, maxValue: 10 }, default: 2, description: 'Automatic retries with the same Idempotency Key and body after connection loss or a retryable Saina error. Terminal errors are never retried.' },
          { displayName: 'Minimum Margin', name: 'minMargin', type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0, description: 'Minimum gap between the best two answers. Ignored in Distribution mode. Exact ties fall back.' },
          { displayName: 'Mode', name: 'mode', type: 'options', options: [{ name: 'Decision', value: 'decision' }, { name: 'Distribution', value: 'distribution' }], default: 'decision', description: 'Decision applies confidence rules; Distribution returns scores without applying thresholds' },
          { displayName: 'On Inference Error', name: 'errorMode', type: 'options', options: [{ name: 'Stop Workflow', value: 'stop' }, { name: 'Use Fallback Output', value: 'fallback' }], default: 'stop' },
          { displayName: 'Result Key', name: 'resultKey', type: 'string', default: 'answer', description: 'Name of the result inside saina.answers' },
          { displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', typeOptions: { minValue: 1, maxValue: 300 }, default: 60 },
        ],
      },

      { displayName: 'State', displayOptions: { show: { '@version': [1] } }, name: 'state', type: 'string', typeOptions: { rows: 5 }, default: '', required: true, description: 'The text or facts to evaluate' },
      { displayName: 'Questions (JSON)', displayOptions: { show: { '@version': [1] } }, name: 'questions', type: 'json', default: '{"team":{"type":"single_choice","question":"Which team?","options":{"billing":"Billing","technical":"Technical support","other":"Other"}}}', required: true, description: 'Named yes_no, single_choice, rating, or multi_choice questions' },
      { displayName: 'Mode', displayOptions: { show: { '@version': [1] } }, name: 'mode', type: 'options', options: [{ name: 'Distribution', value: 'distribution' }, { name: 'Decision', value: 'decision' }], default: 'decision' },
      { displayName: 'Confidence Threshold', name: 'threshold', displayOptions: { show: { '@version': [1], mode: ['decision'] } }, type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0.8, description: 'Minimum top probability to select a branch. Tune using representative evaluation data.' },
      { displayName: 'Minimum Margin', name: 'minMargin', displayOptions: { show: { '@version': [1], mode: ['decision'] } }, type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0, description: 'Minimum gap between the best two options. Exact ties always fall back.' },
      { displayName: 'On Inference Error', displayOptions: { show: { '@version': [1] } }, name: 'errorMode', type: 'options', options: [{ name: 'Stop Workflow', value: 'stop' }, { name: 'Use Fallback Output', value: 'fallback' }], default: 'stop' },
      { displayName: 'Timeout (Seconds)', displayOptions: { show: { '@version': [1] } }, name: 'timeout', type: 'number', typeOptions: { minValue: 1, maxValue: 300 }, default: 60 },
    ],
		usableAsTool: true,
  };
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData(), selected: INodeExecutionData[] = [], fallback: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('sainaHelmApi');
    const configuredBase = typeof credentials.baseUrl === 'string' && credentials.baseUrl.trim() ? credentials.baseUrl.trim() : DEFAULT_BASE_URL;
    let base: URL;
    try { base = new URL(configuredBase); } catch { throw new NodeOperationError(this.getNode(), 'Invalid API Base URL'); }
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new NodeOperationError(this.getNode(), 'Use an HTTP(S) base URL without credentials, query, or fragment');
    const url = base.toString().replace(/\/$/, '') + '/v1/ask';
    const signal = typeof this.getExecutionCancelSignal === 'function' ? this.getExecutionCancelSignal() : undefined;
    for (let i = 0; i < items.length; i++) {
      const legacy = this.getNode().typeVersion === 1;
      const advanced = legacy ? {
        mode: this.getNodeParameter('mode', i) as string,
        threshold: this.getNodeParameter('threshold', i, 0.8) as number,
        minMargin: this.getNodeParameter('minMargin', i, 0) as number,
        timeout: this.getNodeParameter('timeout', i) as number,
        errorMode: this.getNodeParameter('errorMode', i) as string,
      } : this.getNodeParameter('advanced', i, {}) as AdvancedOptions;
      let settings, questions, state;
      try {
        settings = readAdvanced(advanced);
        state = this.getNodeParameter(legacy ? 'state' : 'context', i);
        if (!legacy && (typeof state !== 'string' || !state.trim())) throw new NodeOperationError(this.getNode(), 'Context is required', { itemIndex: i });
        questions = legacy ? parseQuestions(this.getNodeParameter('questions', i)) : buildQuestion(
          this.getNodeParameter('question', i) as string,
          this.getNodeParameter('answers', i) as string,
          advanced,
        );
      } catch {
        throw new NodeOperationError(this.getNode(), 'Check Context, Question, Answers, and Advanced options. Answers must be unique and contain at least two labels. Yes / No requires Yes and No; Rating requires 2–10 ordered labels; Max Retries must be 0–10.', { itemIndex: i });
      }
      const { mode, errorMode, threshold, minMargin, timeout, maxRetries, includeBilling } = settings;
      const softFail = errorMode === 'fallback' || this.continueOnFail();
      // Never copy HTTP request headers, credentials, or raw exception objects into execution output.
      const fail = (error: IDataObject) => fallback.push({ json: { ...items[i].json, saina: { reason: 'inference_error', error } }, binary: items[i].binary, pairedItem: { item: i } });

      const pinned = settings.idempotencyKey;
      let idempotencyKey: string;
      if (pinned === '') idempotencyKey = uuidv7();
      else if (typeof pinned === 'string' && isUuidV7(pinned.trim())) idempotencyKey = pinned.trim();
      else {
        const message = 'Idempotency Key must be a UUIDv7 (RFC 9562), or empty to generate one automatically';
        if (this.continueOnFail()) { fail({ code: 'invalid_idempotency_key', message, idempotency_key: typeof pinned === 'string' ? pinned : null, attempts: 0 }); continue; }
        throw new NodeOperationError(this.getNode(), message, { itemIndex: i, description: 'Map a UUIDv7 from upstream data, or clear the field. Keys must be no more than 24 hours old.' });
      }

      const policy = mode === 'decision' ? { threshold, min_margin: minMargin } : {};
      // The same body object and key are reused for every retry, so the server can replay or deduplicate.
      const body = { model: 'saina-helm-0.8b', state, mode, questions, ...policy };
      const outcome = await sendWithRetries(() => this.helpers.httpRequestWithAuthentication.call(this, 'sainaHelmApi', {
        method: 'POST', url, body, headers: { 'Idempotency-Key': idempotencyKey },
        json: true, timeout: timeout * 1000, disableFollowRedirect: true, returnFullResponse: true, ignoreHttpStatusErrors: true,
        ...(signal ? { abortSignal: signal } : {}),
      }), maxRetries, signal);

      if (!outcome.ok) {
        const fields = failureFields(outcome.failure, idempotencyKey, outcome.attempts);
        if (softFail) { fail(fields); continue; }
        throw sainaError(this.getNode(), outcome.failure, fields, i);
      }

      let result;
      try {
        result = readResponse(outcome.body, questions, mode);
      } catch {
        const requestId = header(outcome.headers, 'x-request-id') ?? null;
        const fields = { code: 'invalid_response', message: 'Saina returned a response that does not match the requested questions', request_id: requestId, idempotency_key: idempotencyKey, attempts: outcome.attempts };
        if (softFail) { fail(fields); continue; }
        throw new NodeOperationError(this.getNode(), 'Saina inference failed. Check your endpoint, credentials, and inputs.', { itemIndex: i, description: `The response did not match the requested questions. Request ID: ${requestId ?? 'unknown'}. Idempotency key: ${idempotencyKey}.` });
      }

      let billing: IDataObject | undefined;
      if (includeBilling) {
        try {
          billing = billingMetadata(outcome.headers, idempotencyKey, outcome.attempts);
        } catch (error) {
          if (!(error instanceof UnsafeCreditValue)) throw new NodeOperationError(this.getNode(), 'Could not read billing metadata', { itemIndex: i });
          const fields = { code: 'unsafe_credit_value', message: error.message, field: error.field, raw_value: error.raw, request_id: header(outcome.headers, 'x-request-id') ?? null, idempotency_key: idempotencyKey, attempts: outcome.attempts };
          if (softFail) { fail(fields); continue; }
          throw new NodeOperationError(this.getNode(), error.message, { itemIndex: i, description: `Request ID: ${fields.request_id ?? 'unknown'}. Idempotency key: ${idempotencyKey}. Turn off Include Billing Metadata to skip reading credit headers.` });
        }
      }
      const accepted = mode === 'distribution' || Object.values(result.answers).every(a => a.reason === 'accepted');
      const out = { json: { ...items[i].json, saina: result as unknown as IDataObject, ...(billing ? { _saina: billing } : {}) }, binary: items[i].binary, pairedItem: { item: i } };
      (accepted ? selected : fallback).push(out);
    }
    return [selected, fallback];
  }
}

function sainaError(node: INode, failure: Failure, fields: IDataObject, itemIndex: number): NodeApiError | NodeOperationError {
  const details = [
    failure.message ? `${failure.message.replace(/\.?$/, '.')}` : '',
    guidance(failure),
    `Request ID: ${failure.requestId ?? 'unknown'}.`,
    `Idempotency key: ${String(fields.idempotency_key)}.`,
    failure.admitted !== undefined || failure.state || failure.retry ? `admitted=${failure.admitted ?? 'unknown'}, state=${failure.state ?? 'unknown'}, retry=${failure.retry ?? 'unknown'}.` : '',
    `Attempts: ${String(fields.attempts)}.`,
  ].filter(Boolean).join(' ');
  let error: NodeApiError | NodeOperationError;
  if (failure.kind === 'api' && failure.httpStatus) {
    error = new NodeApiError(node, fields as JsonObject, { message: `Saina API error: ${failure.code} (HTTP ${failure.httpStatus})`, description: details, httpCode: String(failure.httpStatus), itemIndex });
  } else if (failure.kind === 'connection' || failure.kind === 'uncertain') {
    error = new NodeOperationError(node, `Could not get a response from Saina (${failure.code}) after ${String(fields.attempts)} attempt(s)`, { itemIndex, description: details });
  } else if (failure.kind === 'cancelled') {
    error = new NodeOperationError(node, 'Saina request cancelled', { itemIndex, description: details });
  } else {
    error = new NodeOperationError(node, 'Saina inference failed. Check your endpoint, credentials, and inputs.', { itemIndex, description: details });
  }
  error.context = { ...error.context, saina: fields };
  return error;
}
