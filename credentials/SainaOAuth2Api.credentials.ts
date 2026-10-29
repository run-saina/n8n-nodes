import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

// n8n owns PKCE, token storage, and refresh-token rotation.
export class SainaOAuth2Api implements ICredentialType {
  name = 'sainaOAuth2Api';
  displayName = 'Saina OAuth2 API';
  documentationUrl = 'https://github.com/run-saina/n8n-nodes#oauth2-sign-in';
  extends = ['oAuth2Api'];
  icon: Icon = { light: 'file:../nodes/SainaHelm/saina.svg', dark: 'file:../nodes/SainaHelm/saina.dark.svg' };
  properties: INodeProperties[] = [
    { displayName: 'API Base URL', name: 'baseUrl', type: 'string', default: 'https://api.saina.run', required: true, description: 'Origin of a Saina server offering OAuth and MCP' },
    { displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'pkce' },
    { displayName: 'Authorization URL', name: 'authUrl', type: 'hidden', default: '={{$credentials.baseUrl.replace(/\\/$/, "") + "/v1/mcp-oauth/authorize"}}' },
    { displayName: 'Access Token URL', name: 'accessTokenUrl', type: 'hidden', default: '={{$credentials.baseUrl.replace(/\\/$/, "") + "/v1/mcp-oauth/token"}}' },
    { displayName: 'Scope', name: 'scope', type: 'hidden', default: 'mcp' },
    { displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'body' },
    { displayName: 'Auth URI Query Parameters', name: 'authQueryParameters', type: 'hidden', default: '={{"resource=" + encodeURIComponent($credentials.baseUrl.replace(/\\/$/, "") + "/v1/mcp")}}' },
  ];
}
