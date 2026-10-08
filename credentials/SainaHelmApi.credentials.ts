import type { ICredentialTestRequest, Icon, IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';
export class SainaHelmApi implements ICredentialType {
  name = 'sainaHelmApi';
  displayName = 'Saina Helm API';
		documentationUrl = 'https://github.com/run-saina/n8n-nodes#readme';
  icon: Icon = { light: 'file:../nodes/SainaHelm/saina.svg', dark: 'file:../nodes/SainaHelm/saina.dark.svg' };
  test: ICredentialTestRequest = { request: { baseURL: '={{$credentials.baseUrl}}', url: '/v1/ask', method: 'POST', body: { model: 'saina-helm-0.8b', state: 'Connection test', mode: 'distribution', questions: { connection: { type: 'yes_no', question: 'Is this a connection test?' } } }, json: true, disableFollowRedirect: true } };
  properties: INodeProperties[] = [
    { displayName: 'API Base URL', name: 'baseUrl', type: 'string', default: 'https://api.saina.run', required: true, placeholder: 'https://api.saina.run', description: 'Hosted Saina: https://api.saina.run. Self-hosted: your server origin. Do not include /v1/ask.' },
    { displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true, description: 'Hosted keys (sk_saina_…) are created in the console at https://saina.run/console/ and shown once; store a new key if you lose it. Self-hosted servers use the key configured on that server.' },
  ];
  authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };
}
