import type { ICredentialTestRequest, Icon, IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';
// One credential for every Saina node: the hosted API with an account key, or a self-hosted service with no key.
export class SainaApi implements ICredentialType {
  name = 'sainaApi';
  displayName = 'Saina API';
  documentationUrl = 'https://github.com/run-saina/n8n-nodes#readme';
  icon: Icon = { light: 'file:../nodes/SainaHelm/saina.svg', dark: 'file:../nodes/SainaHelm/saina.dark.svg' };
  // Discovery lists what the credential can target; it is the cheapest authenticated read.
  test: ICredentialTestRequest = { request: { baseURL: '={{$credentials.baseUrl}}', url: '/v1/studio/discovery', method: 'GET', headers: { 'X-Saina-Client': 'n8n' }, json: true, disableFollowRedirect: true } };
  properties: INodeProperties[] = [
    { displayName: 'API Base URL', name: 'baseUrl', type: 'string', default: 'https://api.saina.run', required: true, placeholder: 'https://api.saina.run', description: 'The Saina API origin. Self-hosted: your service origin, for example http://localhost:8000.' },
    { displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', description: 'An account API key from Studio. Leave empty for a self-hosted service that does not authenticate. Dropdowns need a key with endpoints and providers read access.' },
  ];
  authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { Authorization: '={{ $credentials.apiKey ? "Bearer " + $credentials.apiKey : undefined }}' } } };
}
