# Route support tickets to the right team with Saina Helm

> **Self-hosted n8n only.** This template uses the [Saina Helm community node](https://www.npmjs.com/package/@run-saina/n8n-nodes-saina), which is not yet verified, so it can't be installed on n8n Cloud. On n8n Cloud, use the "Route support tickets to teams with Saina Helm over HTTP" template instead.

## Who's it for
Support teams and solo founders who triage inbound email, chat or form messages and want each one sent to the right queue without a chat-model call per ticket.

## How it works
Each incoming message is routed to billing, technical support or a catch-all queue. [Saina Helm](https://saina.run) is a small decision model: instead of generating text, it scores every option and returns a probability for each. The workflow takes the top option only when it's confident.

1. **Example input** holds the situation, the question, and the possible answers, one per line.
2. **Saina Helm** scores the answers. Confident decisions leave through the first output; low confidence, a near tie, or an inference error leave through the fallback output.
3. **Selected branch** sends the item to **Billing**, **Technical support** or **Other**. **Uncertain or failed — review** catches everything else, so nothing is acted on blindly.

## How to set up
1. Install `@run-saina/n8n-nodes-saina` under **Settings → Community nodes**.
2. Get a Saina endpoint. **Hosted:** [create a free account](https://saina.run/signup/) (25 credits a day), create a key, and use `https://api.saina.run` (request bodies are never stored). **Self-hosted:** run the free server with Docker ([run-saina/deploy](https://github.com/run-saina/deploy)) or `pip install 'saina[local,server]'`; it needs about 4 GB of RAM on CPU and downloads the open [Saina Helm 0.8B](https://huggingface.co/run-saina/saina-helm-0.8b) weights on first start.
3. Create **Saina Helm API** credentials with the base URL (`https://api.saina.run` or your server) and API key, select them in the Saina Helm node, then click **Test workflow**.

## Requirements
- Self-hosted n8n with community nodes enabled
- A Saina API key: hosted at api.saina.run, or your own server

## How to customize the workflow
Replace **Run example** with your real trigger and map its fields into **Example input**. Edit the answers to match your own queues; the Switch outputs follow their order. Then connect your real actions in place of the no-op nodes. The 0.05 minimum margin is an example; tune it on your own data.
