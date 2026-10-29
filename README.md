# Saina for n8n

Saina is the decision layer for software systems. Saina builds specialist AI decision models and the developer platform around them. Developers use Saina to turn model predictions into versioned decision endpoints, observe how those decisions perform in production, turn failures into test cases, and improve their models or policies without breaking existing behavior. Saina works with open models and external inference providers, so teams can use their own infrastructure. Saina makes the decisions; n8n workflows execute them.

Two nodes, a shared API-key or OAuth2 credential.

- **Saina Decision** asks typed questions of a Saina model, a connected inference provider, or a published Studio endpoint. Items whose every answer is accepted leave on **Selected**; items with an abstained answer or an execution error leave on **Fallback**.
- **Saina Trace** records what happened afterwards: report a business outcome for a decision, log a trace of a decision the workflow made elsewhere, or read a decision back.

Create a **Saina API** credential with the API base URL and an account API key from Studio. Self-hosted services that do not authenticate can leave the key empty. The credential test calls `GET /v1/studio/discovery`.

## OAuth2 sign-in

In Saina Decision (version 3) or Saina Trace, choose **Authentication → OAuth2** and create a **Saina OAuth2 API** credential. The API-key option remains the default for existing workflows.

Register your n8n installation once, using the exact **OAuth Redirect URL** shown in the credential dialog:

```sh
curl --fail-with-body https://api.saina.run/v1/mcp-oauth/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"Saina for n8n","redirect_uris":["https://YOUR-N8N-HOST/rest/oauth2-credential/callback"],"token_endpoint_auth_method":"client_secret_post","grant_types":["authorization_code","refresh_token"]}'
```

Paste the returned `client_id` and `client_secret` into the credential, then click **Connect my account**. Sign in as the Saina account owner and approve **write** access to run decisions, log traces, and report outcomes. Read access supports discovery and reading decisions only. Store the client secret in n8n credentials, never in workflows. For local n8n, HTTP callbacks are allowed on localhost; otherwise use HTTPS. For another OAuth-enabled Saina server, change both the registration origin and API Base URL.

n8n handles PKCE (S256), encrypted credential storage, and refresh tokens through its [built-in OAuth2 credential](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/credentials/OAuth2Api.credentials.ts). Saina uses rotating refresh tokens; revoke the connection in Studio to disconnect it. Running a configured Decision workflow authorizes its inference calls, including provider billing.

OAuth calls the Saina MCP endpoint (`/v1/mcp`), because these tokens cannot call REST routes. Trace writes require the server tools `log_traces` and `report_decision_outcome`. Self-hosted services without OAuth can continue to use the API-key credential with an empty key. Node versions 1 and 2 retain API-key authentication.

## Saina Decision

The node mirrors the Studio playground. Dropdowns are filled from the account through the credential, so new models and endpoints appear without a package update.

- **Provider**: Saina is always listed. Inference providers you connected in Studio follow. **Endpoint** appears once the account has a published endpoint.
- **Model**: the models the chosen provider serves, with the answer formats and inputs each accepts.
- **Endpoint** and **Version** (Endpoint mode): a published endpoint by name and **Production**, which follows promotions in Studio, or a pinned version number. The endpoint's questions, thresholds and model come from that version, so only Input and Attachments are sent.
- **Input**: the text or facts to evaluate. A JSON object or array is sent as JSON, anything else as text.
- **Questions** (model modes): up to 32 per request, each with an answer format of **Yes / No**, **Choose One** (one `key: description` per line) or **Rate on a Scale** (one level per line, lowest first). Each question can abstain: Yes / No through No and Yes cutoffs, Choose One through a minimum probability. An abstained question sends the item to Fallback.
- **Attachments**: images and audio from binary properties or data URLs, for models that accept them. Up to 8 images and 4 clips of 10 s, 10 MiB each.
- **Options**: stop the workflow or use Fallback on request errors, and the request timeout.

The result is in `saina`: `decision_id`, `status`, `answers` keyed by question, `endpoint` and `endpoint_version`. Provider payloads are not copied into the item. In Endpoint mode the decision is recorded in Studio, so a later Saina Trace node can report its outcome.

Model modes call `POST /v1/studio/playground/test` with an ad hoc definition. Endpoint mode calls `POST /v1/studio/endpoints/{name}/decide`. Both send `X-Saina-Client: n8n`.

The API key needs `playground:rw` for model modes, `endpoints:rw` for Endpoint mode, and `endpoints:r` plus `providers:r` to fill the dropdowns. Dropdown entries for sections the key cannot read are left out; you can still type a name as an expression.

Existing workflows keep working. Node versions 1 and 2 still use the **Saina Helm API** credential and `POST /v1/ask` with their original fields; see the previous README sections in git history for those. New nodes are version 3.

## Saina Trace

- **Report Outcome** posts to `POST /v1/studio/business-outcomes` with the decision ID (defaults to `{{ $json.saina.decision_id }}`), a stable event ID (defaults to the execution and item), outcome values as `{"field": {"type": "boolean|number|string|duration|currency", "value": ...}}`, and an optional question ID. Needs `business-outcomes:rw`.
- **Log Trace** posts a `schema_version` 1.0 envelope to `POST /v1/traces` with a task name, inputs, optional outcome, metadata, optional endpoint name and a UUID trace ID (generated when empty, so retries are idempotent). Needs `traces:rw`.
- **Get Decision** reads `GET /v1/studio/decisions/{id}`. Needs `decisions:r`.

The response is placed in `saina`. Errors stop the workflow unless **Continue on Fail** is set; raw request errors are never copied into the output.

## Local install (self-hosted n8n)

Requires Node 22+ and n8n with `n8n-workflow` 2.x. This package is **not verified by n8n**. Source is available under the MIT license.

```sh
git clone https://github.com/run-saina/n8n-nodes.git
cd n8n-nodes
npm ci
npm test
npm pack
# On the n8n host, install this tarball into the custom/community nodes directory:
cd ~/.n8n/nodes
npm install /absolute/path/run-saina-n8n-nodes-saina-0.3.1.tgz
# Restart n8n using your normal deployment/service command.
```

Use HTTPS outside a trusted local network. Never put the key in a node expression or exported
workflow. The nodes disable redirects to avoid forwarding credentials elsewhere.
One request is made per input item, in order; retries are left to n8n settings.

## Import and test before activation

Import one of `workflows/*.json`. Every template is inactive, starts with a Manual
Trigger, and ends in no-op action slots. Select credentials, test the sample,
replace the input with your real trigger, then connect your real actions. The
templates use node version 2 and the Saina Helm API credential.

- `support-routing.json`: billing / technical / other, with uncertainty fallback.
- `model-escalation.json`: current model / larger model / clarification.
- `invoice-review.json`: human review / continue processing.
- `http-request-portable.json`: standard HTTP Request + IF nodes; no custom package.

For the HTTP template set Header Auth to `Authorization: Bearer YOUR_KEY` using
n8n credentials. API/network errors stop this template; configure n8n's error
output if you want those to route to review. Do not treat a failed request as an
accepted decision. n8n Cloud users can start with this template; no claim of
community-node verification or Cloud installability is made.

Tune abstention cutoffs against representative held-out cases. The values in
examples are configuration examples, not validated settings. For a draft decision,
use the Manual Trigger workflow and inspect both outputs before connecting
production actions. No emails, payments, or external updates are performed by
these templates.

## Development and release

Run `npm ci`, `npm run lint`, `npm test`, and `npm run scan`. Use `npm run dev` to load the nodes in a local n8n instance. Run `python3 generate-workflows.py` to regenerate examples.

The package calls the Saina API directly and does not bundle a model or SDK. A self-hosted
Studio service exposes the same `/v1/studio/...` and `/v1/traces` routes.

The npm package is `@run-saina/n8n-nodes-saina`, owned by the `run-saina` organization. The GitHub Actions **Publish** workflow builds, tests, and scans before uploading a staged release with provenance. Its `NPM_TOKEN` repository secret needs read/write access to the `@run-saina` scope; bypassing 2FA is not required.

To release, run **Publish** on `main` with operation **stage**, then approve the version in npm's [Staged Packages](https://www.npmjs.com/settings/mems_rama/staged-packages) page using your security key. Until approval, the staged version is not installable; npm may show a `0.0.0-stage` placeholder for a new package. After approval, run **Publish** with operation **verify** to scan the exact published version. Do not rerun staging for a version already staged or published.

Tokenless publishing can be configured in npm package settings using GitHub owner `run-saina`, repository `n8n-nodes`, and workflow filename `publish.yml`. The workflow supports OIDC. Remove the bootstrap token once trusted publishing is working.

After publishing, run `npx @n8n/scan-community-package @run-saina/n8n-nodes-saina` and submit through the n8n Creator Portal. Publication does not imply n8n verification. Eligibility of the Selected/Fallback outputs requires n8n review.

## License

MIT. See [LICENSE](LICENSE).

## Developer contact

For integration support and developer enquiries, email [dev@saina.run](mailto:dev@saina.run).
