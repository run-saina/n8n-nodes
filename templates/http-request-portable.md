# Route support tickets to teams with Saina Helm over HTTP

Works on n8n Cloud and self-hosted n8n: it uses only the built-in Set, HTTP Request and Switch nodes, no community node.

## Who's it for
Support teams and solo founders on n8n Cloud who want inbound messages sent to the right queue by a small decision model instead of a chat-model call per ticket.

## How it works
[Saina Helm](https://saina.run) is a decision model: instead of generating text, it scores every option and returns a probability for each.

1. **Example input** holds the API URL, the message, and the confidence threshold.
2. **Saina API** posts the message to your server's `/v1/ask` endpoint with the question "Which team should handle this request?".
3. **Selected branch** sends confident answers to **Billing**, **Technical support** or **Other**. Answers below the threshold, or too close to call, go to **Uncertain — review**.

## How to set up
1. Get a Saina endpoint. **Hosted:** buy credits and create an API key in the console at [saina.run/console](https://saina.run/console/), then use `https://api.saina.run`. The key (`sk_saina_…`) is shown once: store it in an n8n credential, never in the workflow. Each request is charged in credits; request bodies are never stored. **Self-hosted:** run the free server with Docker ([run-saina/deploy](https://github.com/run-saina/deploy)) or `pip install 'saina[local,server]'`; it needs about 4 GB of RAM on CPU and downloads the open [Saina Helm 0.8B](https://huggingface.co/run-saina/saina-helm-0.8b) weights on first start; it uses the key you configure on that server.
2. If you self-host, the server must be reachable from n8n over HTTPS.
3. Create a **Header Auth** credential with name `Authorization` and value `Bearer YOUR_KEY`, and select it in **Saina API**.
4. If you self-host, set `saina_api_url` in **Example input** to your server. Then click **Test workflow**.

## Requirements
- n8n Cloud or self-hosted n8n
- A Saina API key: hosted at api.saina.run, or your own server over HTTPS

## How to customize the workflow
Replace **Run example** with your real trigger and map the message into **Example input**. Edit the options in the **Saina API** body to match your own queues, and keep the Switch expression in the same order. HTTP errors, including `402 insufficient_credits` (buy credits in the console), stop the workflow; use **Settings → On Error** on the HTTP node to route them to review instead. This template sends no `Idempotency-Key`, so every execution is a separate, separately charged request: don't enable **Retry On Fail** on **Saina API** unless you also send an `Idempotency-Key` header holding a UUIDv7 that stays the same across retries. The Saina Helm community node does this for you. Probabilities are model scores, not calibrated guarantees.
