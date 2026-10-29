import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions, INodeExecutionData, INodePropertyOptions, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { readResponse, parseQuestions } from './contract';
import { buildQuestion, readAdvanced } from './form';
import type { AdvancedOptions } from './form';
import { accepted, attachments, buildQuestions, compactDecision, discover, endpointOptions, modelOptions, parseState, providerOptions, readDecision, serviceOrigin, studioRequest, versionOptions } from './studio';
import type { QuestionRow } from './studio';

const v3 = { show: { '@version': [3] } };
const modelMode = { show: { '@version': [3] }, hide: { provider: ['endpoint'] } };
const endpointMode = { show: { '@version': [3], provider: ['endpoint'] } };

async function loadDiscovery(ctx: ILoadOptionsFunctions) {
  const credentials = await ctx.getCredentials('sainaApi');
  return discover(ctx, serviceOrigin(credentials.baseUrl));
}

export class SainaHelm implements INodeType {
  description: INodeTypeDescription = {
    subtitle: '={{ $parameter.provider === "endpoint" ? "Endpoint · " + $parameter.endpoint : $parameter.model || "Ask Saina" }}', displayName: 'Saina Decision', name: 'sainaHelm', icon: { light: 'file:saina.svg', dark: 'file:saina.dark.svg' }, group: ['transform'], version: [1, 2, 3], defaultVersion: 3,
    description: 'Ask typed questions of a Saina model, a connected provider or a published endpoint, and route abstentions to fallback', defaults: { name: 'Saina Decision' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main], outputNames: ['Selected', 'Fallback'],
    credentials: [
      { name: 'sainaHelmApi', required: true, displayOptions: { show: { '@version': [1, 2] } } },
      { name: 'sainaApi', required: true, displayOptions: v3 },
    ],
    properties: [
      // Version 3 mirrors the Studio playground: provider and model, or Endpoint and version; input; attachments; questions.
      { displayName: 'Provider Name or ID', name: 'provider', type: 'options', default: 'saina', required: true, typeOptions: { loadOptionsMethod: 'getProviders' }, displayOptions: v3,
        description: 'Saina is always available. Connected inference providers and Endpoint appear when the account has them. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
      { displayName: 'Model Name or ID', name: 'model', type: 'options', default: '', required: true, typeOptions: { loadOptionsMethod: 'getModels', loadOptionsDependsOn: ['provider'] }, displayOptions: modelMode,
        description: 'Models the selected provider serves. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
      { displayName: 'Endpoint Name or ID', name: 'endpoint', type: 'options', default: '', required: true, typeOptions: { loadOptionsMethod: 'getEndpoints' }, displayOptions: endpointMode,
        description: 'A published Studio endpoint. Its questions, thresholds and model come from the version. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
      { displayName: 'Version Name or ID', name: 'version', type: 'options', default: 'production', required: true, typeOptions: { loadOptionsMethod: 'getVersions', loadOptionsDependsOn: ['endpoint'] }, displayOptions: endpointMode,
        description: 'Production follows promotions in Studio; a number pins one published version. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
      { displayName: 'Input', name: 'state', type: 'string', typeOptions: { rows: 5 }, default: '', displayOptions: v3, description: 'The text or facts to evaluate. A JSON object or array is sent as JSON, anything else as text.' },
      { displayName: 'Questions', name: 'questions', type: 'fixedCollection', typeOptions: { multipleValues: true, sortable: true }, default: { question: [{ instructions: '', type: 'noul', criteria: '' }] }, placeholder: 'Add Question', displayOptions: modelMode,
        description: 'Up to 32 questions answered in one request',
        options: [{ displayName: 'Question', name: 'question', values: [
          { displayName: 'Answer Format', name: 'type', type: 'options', default: 'noul', options: [
            { name: 'Yes / No', value: 'noul' }, { name: 'Choose One', value: 'choice' }, { name: 'Rate on a Scale', value: 'score' },
          ] },
          { displayName: 'Answer Key', name: 'id', type: 'string', default: '', placeholder: 'urgent', description: 'Key of this answer in saina.answers. Defaults to question_1, question_2, and so on.' },
          { displayName: 'Ask', name: 'instructions', type: 'string', typeOptions: { rows: 2 }, default: '', placeholder: 'Does this message require urgent attention?', description: 'What the model should decide about the input' },
          { displayName: 'Choices', name: 'criteria', type: 'string', typeOptions: { rows: 4 }, default: '', placeholder: 'billing: Charges, refunds, invoices\ntechnical: Bugs and outages\nother', displayOptions: { show: { type: ['choice'] } }, description: 'One choice per line as key: description. 2–255 choices.' },
          { displayName: 'Levels', name: 'criteria', type: 'string', typeOptions: { rows: 4 }, default: '', placeholder: 'Low\nMedium\nHigh', displayOptions: { show: { type: ['score'] } }, description: 'One level per line, lowest first. 2–10 levels.' },
          { displayName: 'Minimum Probability', name: 'minProbability', type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0, displayOptions: { show: { type: ['choice'] } }, description: 'Below this probability for the chosen option the question abstains and the item goes to Fallback. 0 never abstains.' },
          { displayName: 'No Cutoff', name: 'noAtOrBelow', type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0, displayOptions: { show: { type: ['noul'] } }, description: 'Probability of Yes at or below which the answer is No. Leave both cutoffs at 0 for no abstention.' },
          { displayName: 'Yes Cutoff', name: 'yesAtOrAbove', type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0, displayOptions: { show: { type: ['noul'] } }, description: 'Probability of Yes at or above which the answer is Yes. Between the cutoffs the question abstains and the item goes to Fallback.' },
        ] }] },
      { displayName: 'Attachments', name: 'media', type: 'collection', placeholder: 'Add Attachment Source', default: {}, displayOptions: v3, description: 'Images and audio for models that accept them. Up to 8 images and 4 clips of 10 s, 10 MiB each.',
        options: [
          { displayName: 'Image Binary Properties', name: 'imagesBinary', type: 'string', default: '', placeholder: 'data, data_1', description: 'Comma-separated binary property names holding PNG, JPEG or WebP images' },
          { displayName: 'Image Data URLs', name: 'imagesUrls', type: 'string', default: '', description: 'A JSON array of data:image/...;base64 URLs, or an expression that yields one' },
          { displayName: 'Audio Binary Properties', name: 'audiosBinary', type: 'string', default: '', placeholder: 'recording', description: 'Comma-separated binary property names holding WAV, FLAC, MP3, OGG or WebM clips' },
          { displayName: 'Audio Data URLs', name: 'audiosUrls', type: 'string', default: '', description: 'A JSON array of data:audio/...;base64 URLs, or an expression that yields one' },
        ] },
      { displayName: 'Options', name: 'options', type: 'collection', placeholder: 'Add Option', default: {}, displayOptions: v3,
        options: [
          { displayName: 'On Request Error', name: 'errorMode', type: 'options', options: [{ name: 'Stop Workflow', value: 'stop' }, { name: 'Use Fallback Output', value: 'fallback' }], default: 'stop' },
          { displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', typeOptions: { minValue: 1, maxValue: 300 }, default: 60 },
        ] },

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
          { displayName: 'Minimum Margin', name: 'minMargin', type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0, description: 'Minimum gap between the best two answers. Ignored in Distribution mode. Exact ties fall back.' },
          { displayName: 'Mode', name: 'mode', type: 'options', options: [{ name: 'Decision', value: 'decision' }, { name: 'Distribution', value: 'distribution' }], default: 'decision', description: 'Decision applies confidence rules; Distribution returns scores without applying thresholds' },
          { displayName: 'Model', name: 'model', type: 'options', default: 'saina-helm', description: 'Which Helm answers. Endpoint Default follows the server and moves to new releases; the others pin one model.', options: [
            { name: 'Endpoint Default', value: 'saina-helm', description: 'The model the endpoint serves by default' },
            { name: 'Helm 2 0.8B', value: 'saina-helm-2-0.8b', description: 'Pin Helm 2; endpoints that do not serve it return an error' },
            { name: 'Helm 0.8B (Original)', value: 'saina-helm-0.8b', description: 'Pin the original Helm' },
          ] },
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

  methods = {
    loadOptions: {
      async getProviders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return providerOptions(await loadDiscovery(this)); },
      async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return modelOptions(await loadDiscovery(this), String(this.getCurrentNodeParameter('provider') ?? 'saina')); },
      async getEndpoints(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return endpointOptions(await loadDiscovery(this)); },
      async getVersions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return versionOptions(await loadDiscovery(this), String(this.getCurrentNodeParameter('endpoint') ?? '')); },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    if (this.getNode().typeVersion === 3) return executeStudio.call(this);
    const items = this.getInputData(), selected: INodeExecutionData[] = [], fallback: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('sainaHelmApi');
    let base: URL;
    try { base = new URL(String(credentials.baseUrl)); } catch { throw new NodeOperationError(this.getNode(), 'Invalid API Base URL'); }
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new NodeOperationError(this.getNode(), 'Use an HTTP(S) base URL without credentials, query, or fragment');
    const url = base.toString().replace(/\/$/, '') + '/v1/ask';
    for (let i = 0; i < items.length; i++) {
      const legacy = this.getNode().typeVersion === 1;
      const advanced = legacy ? {
        mode: this.getNodeParameter('mode', i) as string,
        threshold: this.getNodeParameter('threshold', i, 0.8) as number,
        minMargin: this.getNodeParameter('minMargin', i, 0) as number,
        timeout: this.getNodeParameter('timeout', i) as number,
        errorMode: this.getNodeParameter('errorMode', i) as string,
        // Version 1 workflows keep the model they were built with.
        model: 'saina-helm-0.8b',
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
        throw new NodeOperationError(this.getNode(), 'Check Context, Question, Answers, and Advanced options. Answers must be unique and contain at least two labels. Yes / No requires Yes and No; Rating requires 2–10 ordered labels.', { itemIndex: i });
      }
      const { mode, errorMode, threshold, minMargin, timeout, model } = settings;
      try {
        const policy = mode === 'decision' ? { threshold, min_margin: minMargin } : {};
        const response = await this.helpers.httpRequestWithAuthentication.call(this, 'sainaHelmApi', {
          method: 'POST', url, body: { model, state, mode, questions, ...policy },
          json: true, timeout: timeout * 1000, disableFollowRedirect: true,
        });
        const result = readResponse(response, questions, mode);
        const accepted = mode === 'distribution' || Object.values(result.answers).every(a => a.reason === 'accepted');
        const out = { json: { ...items[i].json, saina: result as unknown as IDataObject }, binary: items[i].binary, pairedItem: { item: i } };
        (accepted ? selected : fallback).push(out);
      } catch {
        // Never copy HTTP request headers, credentials, or raw exception objects into execution output.
        if (errorMode === 'fallback' || this.continueOnFail()) fallback.push({ json: { ...items[i].json, saina: { reason: 'inference_error' } }, binary: items[i].binary, pairedItem: { item: i } });
        else throw new NodeOperationError(this.getNode(), 'Saina inference failed. Check your endpoint, credentials, and inputs.', { itemIndex: i });
      }
    }
    return [selected, fallback];
  }
}

// Version 3: the Studio playground as a node. Model mode posts an ad hoc definition to playground/test;
// Endpoint mode posts to the published endpoint, which records the decision for outcomes.
async function executeStudio(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const items = this.getInputData(), selected: INodeExecutionData[] = [], fallback: INodeExecutionData[] = [];
  const credentials = await this.getCredentials('sainaApi');
  let origin: string;
  try { origin = serviceOrigin(credentials.baseUrl); } catch (error) { throw new NodeOperationError(this.getNode(), (error as Error).message); }
  for (let i = 0; i < items.length; i++) {
    const fail = (message: string) => new NodeOperationError(this.getNode(), message, { itemIndex: i });
    const options = this.getNodeParameter('options', i, {}) as { errorMode?: string; timeout?: number };
    const errorMode = options.errorMode ?? 'stop', timeout = Math.min(300, Math.max(1, Number(options.timeout ?? 60)));
    const provider = String(this.getNodeParameter('provider', i));
    let path: string, body: IDataObject;
    try {
      const media = this.getNodeParameter('media', i, {}) as { imagesBinary?: string; imagesUrls?: string; audiosBinary?: string; audiosUrls?: string };
      const images = await attachments(this, i, media.imagesBinary, media.imagesUrls);
      const audios = await attachments(this, i, media.audiosBinary, media.audiosUrls);
      if (images.length > 8 || audios.length > 4) throw fail('Attach at most 8 images and 4 audio clips');
      const state = parseState(this.getNodeParameter('state', i, ''));
      const request: IDataObject = { ...(state === '' ? {} : { state: state as IDataObject }), ...(images.length ? { images } : {}), ...(audios.length ? { audios } : {}) };
      if (provider === 'endpoint') {
        const endpoint = String(this.getNodeParameter('endpoint', i)).trim(), version = String(this.getNodeParameter('version', i, 'production'));
        if (!/^[a-z0-9-]{3,64}$/.test(endpoint)) throw fail('Choose an endpoint');
        if (version !== 'production' && !/^[1-9]\d*$/.test(version)) throw fail('Version must be production or a positive integer');
        path = '/v1/studio/endpoints/' + encodeURIComponent(endpoint) + '/decide';
        body = { ...request, version: version === 'production' ? 'production' : Number(version) };
      } else {
        const model = String(this.getNodeParameter('model', i)).trim();
        if (!model) throw fail('Choose a model');
        if (state === '' && !images.length && !audios.length) throw fail('Input is required');
        const rows = (this.getNodeParameter('questions', i, {}) as { question?: QuestionRow[] }).question ?? [];
        const { questions, thresholds } = buildQuestions(rows);
        const modalities = ['text', ...(images.length ? ['image'] : []), ...(audios.length ? ['audio'] : [])];
        const definition: IDataObject = { name: 'playground', schema_version: '2.2.0', model: { provider_id: provider, name: model }, questions_mode: 'defined', questions,
          ...(Object.keys(thresholds).length ? { answer_thresholds: thresholds } : {}),
          inputs: { format: 'text', modalities, ...(images.length ? { images: { required: false, max_items: 8 } } : {}), ...(audios.length ? { audios: { required: false, max_items: 4 } } : {}) } };
        path = '/v1/studio/playground/test';
        body = { definition, request };
      }
    } catch (error) {
      throw error instanceof NodeOperationError ? error : fail((error as Error).message);
    }
    try {
      const response = await studioRequest(this, origin, 'POST', path, body, timeout) as IDataObject;
      const decision = readDecision(provider === 'endpoint' ? response : response.decision);
      const out = { json: { ...items[i].json, saina: compactDecision(decision) }, binary: items[i].binary, pairedItem: { item: i } };
      (accepted(decision) ? selected : fallback).push(out);
    } catch {
      // Never copy HTTP request headers, credentials, or raw exception objects into execution output.
      if (errorMode === 'fallback' || this.continueOnFail()) fallback.push({ json: { ...items[i].json, saina: { status: 'error', error: { code: 'request_failed' } } }, binary: items[i].binary, pairedItem: { item: i } });
      else throw new NodeOperationError(this.getNode(), 'Saina request failed. Check the base URL, API key scopes, and inputs.', { itemIndex: i });
    }
  }
  return [selected, fallback];
}
