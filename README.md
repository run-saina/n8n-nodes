# Saina Helm for n8n

Ask Saina Helm a question using three required fields:

- **Context**: the text or facts to evaluate, including values from earlier nodes.
- **Question**: what you want to know.
- **Answers**: at least two labels, one per line or comma-separated. No descriptions or JSON required. Use one label per line when labels contain commas.

For example, provide your support request as Context, ask “Which team should handle this?”, and enter `Billing, Technical support, Other` as Answers. The default selects one answer. Read the selected label at `saina.answers.answer.selection`.

**Advanced** contains optional answer descriptions, answer type, confidence threshold, minimum margin, mode, error handling, result key, and timeout. Defaults are single answer, Decision mode, threshold `0.8`, margin `0`, timeout 60 seconds, and stopping on API errors. Tune the threshold with representative data.

- **Multiple Answers** treats labels as independent tags and requires a tagging-trained checkpoint. Read `selections`.
- **Yes / No** requires exactly `Yes` and `No` as Answers. Read `selected` (boolean).
- **Rating** uses 2–10 answer labels in ascending order. Read `level` (zero-based) and `levels`.
- **Answer Descriptions** lets you add detail to individual labels by matching their exact spelling; other labels need no description.
- **Result Key** changes `answer` in `saina.answers.answer`.

In Decision mode, **Selected** receives accepted answers and **Fallback** receives rejected decisions. Distribution mode sends successful results to Selected without applying thresholds. Inference errors stop by default, or use Fallback when explicitly configured. Invalid form inputs stop before making an API request.

Existing item JSON, binary data, and item pairing are preserved. `saina` replaces any incoming field with that name. Node version 2 provides the simple form; existing node version 1 workflows retain their original Questions JSON configuration and result keys.

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
npm install /absolute/path/run-saina-n8n-nodes-saina-0.2.3.tgz
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

Run `npm ci`, `npm run lint`, `npm test`, and `npm run scan`. Use `npm run dev` to load the node in a local n8n instance. Run `python3 generate-workflows.py` to regenerate examples.

A Saina Helm HTTP service exposing `POST /v1/ask` and its API key are required. The package calls that service directly and does not bundle the model or SDK.

The npm package is `@run-saina/n8n-nodes-saina`, owned by the `run-saina` organization. The GitHub Actions **Publish** workflow builds, tests, and scans before uploading a staged release with provenance. Its `NPM_TOKEN` repository secret needs read/write access to the `@run-saina` scope; bypassing 2FA is not required.

To release, run **Publish** on `main` with operation **stage**, then approve the version in npm's [Staged Packages](https://www.npmjs.com/settings/mems_rama/staged-packages) page using your security key. Until approval, the staged version is not installable; npm may show a `0.0.0-stage` placeholder for a new package. After approval, run **Publish** with operation **verify** to scan the exact published version. Do not rerun staging for a version already staged or published.

Tokenless publishing can be configured in npm package settings using GitHub owner `run-saina`, repository `n8n-nodes`, and workflow filename `publish.yml`. The workflow supports OIDC. Remove the bootstrap token once trusted publishing is working.

After publishing, run `npx @n8n/scan-community-package @run-saina/n8n-nodes-saina` and submit through the n8n Creator Portal. Publication does not imply n8n verification. Eligibility of the Selected/Fallback outputs requires n8n review.

## License

MIT. See [LICENSE](LICENSE).

## Developer contact

For integration support and developer enquiries, email [dev@saina.run](mailto:dev@saina.run).
