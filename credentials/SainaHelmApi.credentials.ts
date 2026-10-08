import type { ICredentialTestRequest, Icon, IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';
export class SainaHelmApi implements ICredentialType {
  name = 'sainaHelmApi';
  displayName = 'Saina Helm API';
		documentationUrl = 'https://github.com/run-saina/n8n-nodes#readme';
  icon: Icon = { light: 'file:../nodes/SainaHelm/saina.svg', dark: 'file:../nodes/SainaHelm/saina.dark.svg' };
  // Hosted API: a free, read-only balance call validates the key without spending credits. Self-hosted
  // servers have no account routes, so they still get a one-question ask.
  test: ICredentialTestRequest = { request: { baseURL: '={{$credentials.baseUrl}}', url: '={{/^https:\\/\\/api(-staging)?\\.saina\\.run\\/?$/.test($credentials.baseUrl) ? "/v1/account/balance" : "/v1/ask"}}', method: '={{/^https:\\/\\/api(-staging)?\\.saina\\.run\\/?$/.test($credentials.baseUrl) ? "GET" : "POST"}}' as never, body: { model: 'saina-helm-0.8b', state: 'Connection test', mode: 'distribution', questions: { connection: { type: 'yes_no', question: 'Is this a connection test?' } } }, json: true, disableFollowRedirect: true } };
  properties: INodeProperties[] = [
    { displayName: 'API Base URL', name: 'baseUrl', type: 'string', default: 'https://api.saina.run', required: true, placeholder: 'https://api.saina.run', description: 'Hosted Saina: https://api.saina.run. Self-hosted: your server origin. Do not include /v1/ask.' },
    { displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true, description: 'Hosted keys (sk_saina_…) are created in the console at https://saina.run/console/ and shown once; store a new key if you lose it. Self-hosted servers use the key configured on that server.' },
  ];
  authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };
}
