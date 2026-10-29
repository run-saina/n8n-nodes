import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { authenticationProperty, credentialType, identifier, parseJson, serviceOrigin, studioRequest } from '../SainaHelm/studio';

const show = (...operations: string[]) => ({ show: { operation: operations } });

// The recorded side of a decision: what happened afterwards, decisions made elsewhere, and reading a decision back.
export class SainaTrace implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Saina Trace', name: 'sainaTrace', icon: { light: 'file:saina.svg', dark: 'file:saina.dark.svg' }, group: ['transform'], version: 1,
    subtitle: '={{ $parameter.operation }}', description: 'Report business outcomes, log traces of decisions made elsewhere, and read decisions back', defaults: { name: 'Saina Trace' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
    credentials: [
      { name: 'sainaApi', required: true, displayOptions: { show: { authentication: ['apiKey'] } } },
      { name: 'sainaOAuth2Api', required: true, displayOptions: { show: { authentication: ['oAuth2'] } } },
    ],
    properties: [
      authenticationProperty,
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'reportOutcome', options: [
        { name: 'Report Outcome', value: 'reportOutcome', action: 'Report a business outcome for a decision', description: 'Attach what happened to a decision made by a Saina Decision endpoint' },
        { name: 'Log Trace', value: 'logTrace', action: 'Log a trace', description: 'Record a decision this workflow made without Saina, with its inputs and outcome' },
        { name: 'Get Decision', value: 'getDecision', action: 'Get a decision', description: 'Read a recorded decision by ID' },
      ] },
      { displayName: 'Decision ID', name: 'decisionId', type: 'string', default: '={{ $json.saina.decision_id }}', required: true, displayOptions: show('reportOutcome', 'getDecision'), description: 'The decision_id returned by a Saina Decision node in Endpoint mode' },
      { displayName: 'Event ID', name: 'eventId', type: 'string', default: '={{ $execution.id }}-{{ $itemIndex }}', required: true, displayOptions: show('reportOutcome'), description: 'A stable ID for this outcome event; reporting the same event twice is ignored' },
      { displayName: 'Values', name: 'values', type: 'json', default: '{\n  "resolved": { "type": "boolean", "value": true }\n}', required: true, displayOptions: show('reportOutcome'), description: 'Outcome fields as {"field": {"type": "boolean|number|string|duration|currency", "value": ...}}. Fields must match the endpoint version when it defines them.' },
      { displayName: 'Question ID', name: 'questionId', type: 'string', default: '', displayOptions: show('reportOutcome'), description: 'Scope the outcome to one question of the decision. Empty means the whole decision.' },
      { displayName: 'Task', name: 'task', type: 'string', default: '', required: true, placeholder: 'route-ticket', displayOptions: show('logTrace'), description: 'What was decided' },
      { displayName: 'Inputs', name: 'inputs', type: 'json', default: '={{ JSON.stringify($json) }}', required: true, displayOptions: show('logTrace'), description: 'The inputs the decision was made on, as JSON' },
      { displayName: 'Outcome', name: 'outcome', type: 'json', default: '', displayOptions: show('logTrace'), description: 'What was decided or what happened, as JSON' },
      { displayName: 'Metadata', name: 'metadata', type: 'json', default: '{}', displayOptions: show('logTrace'), description: 'Free-form JSON object, for example the workflow or application name' },
      { displayName: 'Endpoint', name: 'endpoint', type: 'string', default: '', displayOptions: show('logTrace'), description: 'Optional endpoint name this trace belongs with' },
      { displayName: 'Trace ID', name: 'traceId', type: 'string', default: '', displayOptions: show('logTrace'), description: 'A UUID to make the record idempotent. Generated when empty.' },
      { displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', typeOptions: { minValue: 1, maxValue: 300 }, default: 30 },
    ],
    usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData(), out: INodeExecutionData[] = [];
    const credentials = await this.getCredentials(credentialType(this));
    let origin: string;
    try { origin = serviceOrigin(credentials.baseUrl); } catch (error) { throw new NodeOperationError(this.getNode(), (error as Error).message); }
    for (let i = 0; i < items.length; i++) {
      const fail = (message: string) => new NodeOperationError(this.getNode(), message, { itemIndex: i });
      const operation = this.getNodeParameter('operation', i) as string;
      const timeout = Math.min(300, Math.max(1, Number(this.getNodeParameter('timeout', i, 30))));
      let method: 'GET' | 'POST', path: string, body: IDataObject | undefined;
      try {
        if (operation === 'reportOutcome') {
          const values = parseJson(this.getNodeParameter('values', i), 'Values');
          if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw fail('Values must be a JSON object with at least one field');
          const questionId = String(this.getNodeParameter('questionId', i, '') ?? '').trim();
          method = 'POST'; path = '/v1/studio/business-outcomes';
          body = { decision_id: identifier(this.getNodeParameter('decisionId', i), 'Decision ID'), event_id: identifier(this.getNodeParameter('eventId', i), 'Event ID'), values: values as IDataObject, ...(questionId ? { question_id: identifier(questionId, 'Question ID') } : {}) };
        } else if (operation === 'logTrace') {
          const task = String(this.getNodeParameter('task', i) ?? '').trim();
          if (!task || task.length > 1024) throw fail('Task is required');
          const inputs = parseJson(this.getNodeParameter('inputs', i), 'Inputs');
          if (inputs === undefined) throw fail('Inputs are required');
          const outcome = parseJson(this.getNodeParameter('outcome', i, ''), 'Outcome');
          const metadata = parseJson(this.getNodeParameter('metadata', i, '{}'), 'Metadata') ?? {};
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw fail('Metadata must be a JSON object');
          const endpoint = String(this.getNodeParameter('endpoint', i, '') ?? '').trim();
          const given = String(this.getNodeParameter('traceId', i, '') ?? '').trim();
          if (given && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(given)) throw fail('Trace ID must be a UUID');
          const record: IDataObject = { trace_id: given || crypto.randomUUID(), recorded_at: new Date().toISOString(), task, inputs: inputs as IDataObject, metadata: metadata as IDataObject, ...(outcome === undefined ? {} : { outcome: outcome as IDataObject }), ...(endpoint ? { endpoint } : {}) };
          method = 'POST'; path = '/v1/traces'; body = { schema_version: '1.0', traces: [record] };
        } else if (operation === 'getDecision') {
          method = 'GET'; path = '/v1/studio/decisions/' + encodeURIComponent(identifier(this.getNodeParameter('decisionId', i), 'Decision ID'));
        } else throw fail('Unsupported operation');
      } catch (error) {
        throw error instanceof NodeOperationError ? error : fail((error as Error).message);
      }
      try {
        const response = await studioRequest(this, origin, method, path, body, timeout) as IDataObject;
        const result = operation === 'logTrace' ? { ...response, trace_id: (body!.traces as IDataObject[])[0].trace_id } : response;
        out.push({ json: { ...items[i].json, saina: result }, binary: items[i].binary, pairedItem: { item: i } });
      } catch {
        // Never copy HTTP request headers, credentials, or raw exception objects into execution output.
        if (this.continueOnFail()) out.push({ json: { ...items[i].json, saina: { status: 'error', error: { code: 'request_failed' } } }, binary: items[i].binary, pairedItem: { item: i } });
        else throw new NodeOperationError(this.getNode(), 'Saina request failed. Check the base URL, credential permissions, and inputs.', { itemIndex: i });
      }
    }
    return [out];
  }
}
