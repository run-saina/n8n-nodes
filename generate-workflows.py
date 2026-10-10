"""Regenerate credential-free, inactive starter workflows and their n8n template-library descriptions.

Each workflow follows the n8n template submission guidelines: a yellow sticky with the full
description, white stickies per step, a Set node for the values users edit, and no secrets.
The same description is written to templates/<slug>.md for the Creator Hub form.
"""
import json
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL
here=Path(__file__).parent
root=here/'workflows'
docs=here/'templates'
docs.mkdir(exist_ok=True)
YELLOW,WHITE=1,7

def node(name, kind, position, parameters=None, version=1):
    return {'id':str(uuid5(NAMESPACE_URL,'saina/'+name)), 'name':name, 'type':kind, 'typeVersion':version,
            'position':position, 'parameters':parameters or {}}

def sticky(name, content, position, width, height, color=WHITE):
    return node(name,'n8n-nodes-base.stickyNote',position,{'content':content,'width':width,'height':height,'color':color})

def fields(name, position, values):
    assignments=[{'id':str(uuid5(NAMESPACE_URL,f'saina/{name}/{key}')),'name':key,'value':value,
                  'type':'number' if isinstance(value,(int,float)) else 'string'} for key,value in values.items()]
    return node(name,'n8n-nodes-base.set',position,{'assignments':{'assignments':assignments},'options':{}},3.4)

def connect(connections, source, outputs):
    connections[source]={'main':[[{'node':target,'type':'main','index':0} for target in targets] for targets in outputs]}

def write(slug, title, nodes, connections, description):
    nodes.insert(0,sticky('Template overview','## '+title+'\n\n'+description,[-620,-120],560,1160,YELLOW))
    (root/(slug+'.json')).write_text(json.dumps({'name':title,'nodes':nodes,'connections':connections,'active':False,
        'settings':{'executionOrder':'v1'},'pinData':{},'tags':[]},indent=2,ensure_ascii=False)+'\n')
    (docs/(slug+'.md')).write_text('# '+title+'\n\n'+description+'\n')

SERVER='''Get a Saina endpoint. **Hosted:** [create a free account](https://saina.run/signup/) (25 credits a day), create a key, and use `https://api.saina.run` (request bodies are never stored). **Self-hosted:** run the free server with Docker ([run-saina/deploy](https://github.com/run-saina/deploy)) or `pip install 'saina[local,server]'`; it needs about 4 GB of RAM on CPU and downloads the open [Saina Helm 0.8B](https://huggingface.co/run-saina/saina-helm-0.8b) weights on first start.'''

COMMUNITY='''> **Self-hosted n8n only.** This template uses the [Saina Helm community node](https://www.npmjs.com/package/@run-saina/n8n-nodes-saina), which is not yet verified, so it can't be installed on n8n Cloud. On n8n Cloud, use the "Route support tickets to teams with Saina Helm over HTTP" template instead.'''

def community_description(who, what, labels, customize):
    bold=[f'**{label}**' for label in labels]
    branches=', '.join(bold[:-1])+' or '+bold[-1]
    return f'''{COMMUNITY}

## Who's it for
{who}

## How it works
{what} [Saina Helm](https://saina.run) is a small decision model: instead of generating text, it scores every option and returns a probability for each. The workflow takes the top option only when it's confident.

1. **Example input** holds the situation, the question, and the possible answers, one per line.
2. **Saina Helm** scores the answers. Confident decisions leave through the first output; low confidence, a near tie, or an inference error leave through the fallback output.
3. **Selected branch** sends the item to {branches}. **Uncertain or failed — review** catches everything else, so nothing is acted on blindly.

## How to set up
1. Install `@run-saina/n8n-nodes-saina` under **Settings → Community nodes**.
2. {SERVER}
3. Create **Saina Helm API** credentials with the base URL (`https://api.saina.run` or your server) and API key, select them in the Saina Helm node, then click **Test workflow**.

## Requirements
- Self-hosted n8n with community nodes enabled
- A Saina API key: hosted at api.saina.run, or your own server

## How to customize the workflow
Replace **Run example** with your real trigger and map its fields into **Example input**. {customize} Then connect your real actions in place of the no-op nodes. The 0.05 minimum margin is an example; tune it on your own data.'''

INPUT='Replace **Run example** with your trigger. Map your data into **Example input**: the situation, the question, and one answer per line.'
steps=lambda decider, inputs=INPUT: [
    ('Step 1 · Input','### 1. Input\n'+inputs,[-40,60],460,360),
    ('Step 2 · Decide','### 2. Decide\n'+decider,[440,60],260,360),
    ('Step 3 · Act','### 3. Act\nEach confident answer gets its own branch. Uncertain or failed items go to review. Swap the no-op nodes for your real actions.',[680,-120],520,760)]

cases=[('support-routing','Route support tickets to the right team with Saina Helm',
        'I was charged twice for my subscription.','Which team should handle this request?',['Billing','Technical support','Other'],
        'Support teams and solo founders who triage inbound email, chat or form messages and want each one sent to the right queue without a chat-model call per ticket.',
        'Each incoming message is routed to billing, technical support or a catch-all queue.',
        'Edit the answers to match your own queues; the Switch outputs follow their order.'),
       ('model-escalation','Choose an LLM tier for each request with Saina Helm',
        'User request: Compare the indemnification and liability-cap clauses across these three 40-page contracts governed by New York, English and German law, and explain where they conflict.',
        'Which model tier should handle this request?',['Larger reasoning model','Current small model','Ask the user for clarification'],
        'Teams running LLM workflows who want to save cost by sending easy requests to a small model and only escalating the hard ones.',
        'Before an expensive LLM call, Saina Helm decides whether the request needs a larger model, can stay on the current one, or needs clarification first.',
        'Put your LLM nodes on the larger-model and small-model branches, and send clarification requests back to the user.'),
       ('invoice-review','Flag risky invoices for human review with Saina Helm',
        "Invoice from Acme: amount matches the order, but the vendor's bank account changed by email yesterday, a common fraud pattern.",'Should this invoice continue processing or receive human review?',
        ['Human review','Continue processing'],
        'Finance and operations teams who process supplier invoices automatically and want risky ones, such as changed bank details, held for a person.',
        'Each invoice summary is checked, and the workflow decides whether it can continue or needs a human to look at it.',
        'Build the situation text from your invoice fields, for example amount, vendor, and whether the bank details changed.')]
for slug,title,context,question,choices,who,what,customize in cases:
    nodes=[*[sticky(n,c,p,w,h) for n,c,p,w,h in steps('**Saina Helm** scores every answer and only accepts a confident one.')],
        node('Run example','n8n-nodes-base.manualTrigger',[0,240]),
        fields('Example input',[220,240],{'context':context,'question':question,'answers':'\n'.join(choices)}),
        node('Saina Helm','@run-saina/n8n-nodes-saina.sainaHelm',[480,240],{'context':'={{ $json.context }}','question':'={{ $json.question }}','answers':'={{ $json.answers }}','advanced':{'resultKey':'route','minMargin':.05,'errorMode':'fallback'}},2),
        node('Selected branch','n8n-nodes-base.switch',[740,160],{'mode':'expression','numberOutputs':len(choices),'output':'={{ '+json.dumps(choices)+'.indexOf($json.saina.answers.route.selection) }}'},3.2),
        node('Uncertain or failed — review','n8n-nodes-base.noOp',[740,480])]
    connections={};connect(connections,'Run example',[['Example input']]);connect(connections,'Example input',[['Saina Helm']]);connect(connections,'Saina Helm',[['Selected branch'],['Uncertain or failed — review']]);
    names=[]
    for i,label in enumerate(choices):
        name=f'{i+1}. {label}';names.append(name);nodes.append(node(name,'n8n-nodes-base.noOp',[1000,i*150+20]))
    connect(connections,'Selected branch',[[name] for name in names])
    write(slug,title,nodes,connections,community_description(who,what,choices,customize))

# No community node needed: n8n Cloud can use Set, HTTP Request and Switch.
labels={'billing':'Billing','technical':'Technical support','other':'Other'}
body=('={{ JSON.stringify({ model: "saina-helm", mode: "decision", state: $json.message, '
      'questions: { team: { type: "single_choice", question: "Which team should handle this request?", '
      'options: '+json.dumps(labels)+' } }, threshold: $json.threshold, min_margin: 0.05 }) }}')
route='={{ $json.answers.team.reason === "accepted" ? '+json.dumps(list(labels))+'.indexOf($json.answers.team.selection) : 3 }}'
nodes=[*[sticky(n,c,p,w,h) for n,c,p,w,h in steps('**Saina API** sends the message to your server\'s `/v1/ask` and gets a score for each team.','Replace **Run example** with your trigger. Map the incoming message into **Example input**; change the URL only if you self-host.')],
    node('Run example','n8n-nodes-base.manualTrigger',[0,240]),
    fields('Example input',[220,240],{'saina_api_url':'https://api.saina.run','message':'I was charged twice for my subscription.','threshold':0.8}),
    node('Saina API','n8n-nodes-base.httpRequest',[480,240],{'method':'POST','url':'={{ $json.saina_api_url }}/v1/ask','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','sendBody':True,'specifyBody':'json','jsonBody':body,'options':{'timeout':60000,'redirect':{'redirect':{'followRedirects':False}}}},4.2),
    node('Selected branch','n8n-nodes-base.switch',[740,240],{'mode':'expression','numberOutputs':4,'output':route},3.2)]
names=[f'{i+1}. {label}' for i,label in enumerate(labels.values())]+['Uncertain — review']
nodes+=[node(name,'n8n-nodes-base.noOp',[1000,i*150-20]) for i,name in enumerate(names)]
connections={}
for source,outputs in [('Run example',[['Example input']]),('Example input',[['Saina API']]),('Saina API',[['Selected branch']]),('Selected branch',[[n] for n in names])]:connect(connections,source,outputs)
write('http-request-portable','Route support tickets to teams with Saina Helm over HTTP',nodes,connections,f'''Works on n8n Cloud and self-hosted n8n: it uses only the built-in Set, HTTP Request and Switch nodes, no community node.

## Who's it for
Support teams and solo founders on n8n Cloud who want inbound messages sent to the right queue by a small decision model instead of a chat-model call per ticket.

## How it works
[Saina Helm](https://saina.run) is a decision model: instead of generating text, it scores every option and returns a probability for each.

1. **Example input** holds the API URL, the message, and the confidence threshold.
2. **Saina API** posts the message to your server's `/v1/ask` endpoint with the question "Which team should handle this request?".
3. **Selected branch** sends confident answers to **Billing**, **Technical support** or **Other**. Answers below the threshold, or too close to call, go to **Uncertain — review**.

## How to set up
1. {SERVER}
2. If you self-host, the server must be reachable from n8n over HTTPS.
3. Create a **Header Auth** credential with name `Authorization` and value `Bearer YOUR_KEY`, and select it in **Saina API**.
4. If you self-host, set `saina_api_url` in **Example input** to your server. Then click **Test workflow**.

## Requirements
- n8n Cloud or self-hosted n8n
- A Saina API key: hosted at api.saina.run, or your own server over HTTPS

## How to customize the workflow
Replace **Run example** with your real trigger and map the message into **Example input**. Edit the options in the **Saina API** body to match your own queues, and keep the Switch expression in the same order. HTTP errors stop the workflow; use **Settings → On Error** on the HTTP node to route them to review instead. Probabilities are model scores, not calibrated guarantees.''')
