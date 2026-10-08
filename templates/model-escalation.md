# Choose an LLM tier for each request with Saina Helm

> **Self-hosted n8n only.** This template uses the [Saina Helm community node](https://www.npmjs.com/package/@run-saina/n8n-nodes-saina), which is not yet verified, so it can't be installed on n8n Cloud. On n8n Cloud, use the "Route support tickets to teams with Saina Helm over HTTP" template instead.

## Who's it for
Teams running LLM workflows who want to save cost by sending easy requests to a small model and only escalating the hard ones.

## How it works
Before an expensive LLM call, Saina Helm decides whether the request needs a larger model, can stay on the current one, or needs clarification first. [Saina Helm](https://saina.run) is a small decision model: instead of generating text, it scores every option and returns a probability for each. The workflow takes the top option only when it's confident.

1. **Example input** holds the situation, the question, and the possible answers, one per line.
2. **Saina Helm** scores the answers. Confident decisions leave through the first output; low confidence, a near tie, or an inference error leave through the fallback output. Each item is sent with its own idempotency key, and transient failures are retried with the same key, so a retry never charges twice. Request ID, credits charged, and balance appear under `_saina`; API errors such as insufficient credits appear under `saina.error`.
3. **Selected branch** sends the item to **Larger reasoning model**, **Current small model** or **Ask the user for clarification**. **Uncertain or failed — review** catches everything else, so nothing is acted on blindly.

## How to set up
1. Install `@run-saina/n8n-nodes-saina` under **Settings → Community nodes**.
2. Get a Saina endpoint. **Hosted:** buy credits and create an API key in the console at [saina.run/console](https://saina.run/console/), then use `https://api.saina.run`. The key (`sk_saina_…`) is shown once: store it in an n8n credential, never in the workflow. Each request is charged in credits; request bodies are never stored. **Self-hosted:** run the free server with Docker ([run-saina/deploy](https://github.com/run-saina/deploy)) or `pip install 'saina[local,server]'`; it needs about 4 GB of RAM on CPU and downloads the open [Saina Helm 0.8B](https://huggingface.co/run-saina/saina-helm-0.8b) weights on first start; it uses the key you configure on that server.
3. Create **Saina Helm API** credentials with the base URL (`https://api.saina.run` or your server) and API key, select them in the Saina Helm node, then click **Test workflow**.

## Requirements
- Self-hosted n8n with community nodes enabled
- A Saina API key: hosted at api.saina.run, or your own server

## How to customize the workflow
Replace **Run example** with your real trigger and map its fields into **Example input**. Put your LLM nodes on the larger-model and small-model branches, and send clarification requests back to the user. Then connect your real actions in place of the no-op nodes. The 0.05 minimum margin is an example; tune it on your own data.
