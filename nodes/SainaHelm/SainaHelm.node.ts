import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { readResponse, parseQuestions } from './contract';
export class SainaHelm implements INodeType {
  description: INodeTypeDescription = {
    subtitle: 'Ask Saina Helm', displayName: 'Saina Helm', name: 'sainaHelm', icon: { light: 'file:saina.svg', dark: 'file:saina.svg' }, group: ['transform'], version: 1,
    description: 'Ask typed questions and route rejected decisions to fallback', defaults: { name: 'Saina Helm' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main], outputNames: ['Selected', 'Fallback'],
    credentials: [{ name: 'sainaHelmApi', required: true }],
    properties: [
      { displayName: 'State', name: 'state', type: 'string', typeOptions: { rows: 5 }, default: '', required: true, description: 'The text or facts to evaluate' },
      { displayName: 'Questions (JSON)', name: 'questions', type: 'json', default: '{"team":{"type":"single_choice","question":"Which team?","options":{"billing":"Billing","technical":"Technical support","other":"Other"}}}', required: true, description: 'Named yes_no, single_choice, rating, or multi_choice questions' },
      { displayName: 'Mode', name: 'mode', type: 'options', options: [{ name: 'Distribution', value: 'distribution' }, { name: 'Decision', value: 'decision' }], default: 'decision' },
      { displayName: 'Confidence Threshold', name: 'threshold', displayOptions: { show: { mode: ['decision'] } }, type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0.8, description: 'Minimum top probability to select a branch. Tune using representative evaluation data.' },
      { displayName: 'Minimum Margin', name: 'minMargin', displayOptions: { show: { mode: ['decision'] } }, type: 'number', typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 3 }, default: 0, description: 'Minimum gap between the best two options. Exact ties always fall back.' },
      { displayName: 'On Inference Error', name: 'errorMode', type: 'options', options: [{ name: 'Stop Workflow', value: 'stop' }, { name: 'Use Fallback Output', value: 'fallback' }], default: 'stop' },
      { displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', typeOptions: { minValue: 1, maxValue: 300 }, default: 60 },
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
      const errorMode = this.getNodeParameter('errorMode', i) as string;
      try {
        const questions = parseQuestions(this.getNodeParameter('questions', i));
        const mode = this.getNodeParameter('mode', i) as string;
        const policy = mode === 'decision' ? { threshold: this.getNodeParameter('threshold', i) as number, min_margin: this.getNodeParameter('minMargin', i) as number } : {};
        const response = await this.helpers.httpRequestWithAuthentication.call(this, 'sainaHelmApi', {
          method: 'POST', url, body: { model: 'saina-helm-0.8b', state: this.getNodeParameter('state', i), mode, questions, ...policy },
          json: true, timeout: (this.getNodeParameter('timeout', i) as number) * 1000, disableFollowRedirect: true,
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
