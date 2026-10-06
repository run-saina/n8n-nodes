# Saina Helm for n8n

A typed-question node using `/v1/ask`. Supply State, Questions JSON and a mode.
All four native question types are supported. In decision mode, **Selected**
receives items only when every answer is accepted; otherwise they go to
**Fallback**. Distribution mode sends successful results to Selected without
applying thresholds. Read `saina.answers.<id>` for typed answer objects.
Inference errors stop by default, or use fallback when explicitly configured.
Existing item JSON, binary data and item pairing are preserved. `saina` is a
reserved output field and replaces any incoming field with that name.

## Local install (self-hosted n8n)

Requires Node 22+ and n8n with `n8n-workflow` 2.x. This package is **not published
or verified in the n8n marketplace**. Source is available under the MIT license.

```sh
git clone https://github.com/run-saina/n8n-nodes.git
cd n8n-nodes
npm ci
npm test
npm pack
# On the n8n host, install this tarball into the custom/community nodes directory:
cd ~/.n8n/nodes
npm install /absolute/path/saina-run-n8n-nodes-saina-0.1.0.tgz
# Restart n8n using your normal deployment/service command.
```

The credential connection test sends a small inference request to `/v1/ask` to validate authentication and service readiness.

Create **Saina Helm API** credentials with your API base URL and key. Use HTTPS
outside a trusted local network. Never put the key in a node expression or exported
workflow. The node disables redirects to avoid forwarding credentials elsewhere.
One request is made per input item, in order; retries are left to n8n settings.

## Import and test before activation

Import one of `workflows/*.json`. Every template is inactive, starts with a Manual
Trigger, and ends in no-op action slots. Select credentials, test the sample,
replace the input with your real trigger, then connect your real actions.

- `support-routing.json`: billing / technical / other, with uncertainty fallback.
- `model-escalation.json`: current model / larger model / clarification.
- `invoice-review.json`: human review / continue processing.
- `http-request-portable.json`: standard HTTP Request + IF nodes; no custom package.

For the HTTP template set Header Auth to `Authorization: Bearer YOUR_KEY` using
n8n credentials. API/network errors stop this template; configure n8n's error
output if you want those to route to review. Do not treat a failed request as an
accepted decision. n8n Cloud users can start with this template; no claim of
community-node verification or Cloud installability is made.

Exclusive types normalize over supplied options. Multi-choice memberships are
independent and require a checkpoint trained for tagging.
Tune confidence/margin thresholds against representative held-out cases.
`0.8` and `0.05` in examples are configuration examples, not validated settings.
For a draft decision, use the Manual Trigger workflow and inspect both outputs
before connecting production actions. No emails, payments, or external updates
are performed by these templates.

## Development and release

Run `npm ci`, `npm run lint`, and `npm test`. Use `npm run dev` to load the node in a local n8n instance. Run `python3 generate-workflows.py` to regenerate examples.

A Saina Helm HTTP service exposing `POST /v1/ask` and its API key are required. The package calls that service directly and does not bundle the model or SDK.

The GitHub Actions Publish workflow builds and tests the package before publishing to npm with provenance. Configure the repository's `NPM_TOKEN` secret with package publish access before the first release, or configure npm trusted publishing for this repository and `publish.yml`. Run the workflow manually to publish the version in package.json. Each version can be published only once.

After publishing, run `npx @n8n/scan-community-package @saina-run/n8n-nodes-saina` and submit through the n8n Creator Portal. Publication does not imply n8n verification. Eligibility of the Selected/Fallback outputs requires n8n review.

## License

MIT. See [LICENSE](LICENSE).
