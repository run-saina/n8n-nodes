import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
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
      const { mode, errorMode, threshold, minMargin, timeout } = settings;
      try {
        const policy = mode === 'decision' ? { threshold, min_margin: minMargin } : {};
        const response = await this.helpers.httpRequestWithAuthentication.call(this, 'sainaHelmApi', {
          method: 'POST', url, body: { model: 'saina-helm-0.8b', state, mode, questions, ...policy },
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
