"""Regenerate credential-free, inactive starter workflows."""
import json
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL
root=Path(__file__).parent/'workflows'

def node(name, kind, position, parameters=None, version=1):
    return {'id':str(uuid5(NAMESPACE_URL,'saina/'+name)), 'name':name, 'type':kind, 'typeVersion':version,
            'position':position, 'parameters':parameters or {}}

def connect(connections, source, outputs):
    connections[source]={'main':[[{'node':target,'type':'main','index':0} for target in targets] for targets in outputs]}

cases=[('support-routing','Route a support request','I was charged twice for my subscription.',
        'Which team should handle this request?', ['Billing','Technical support','Other']),
       ('model-escalation','Choose a model tier','Compare conflicting clauses in these three contracts across jurisdictions.',
        'Does this request need deeper reasoning or more information?', ['Escalate to a larger model','Handle with the current model','Ask for clarification']),
       ('invoice-review','Review an invoice','The invoice amount matches the order, but the vendor bank account has changed.',
        'Should this invoice continue processing or receive human review?', ['Human review','Continue processing'])]
for slug,title,context,question,choices in cases:
    nodes=[node('Run example','n8n-nodes-base.manualTrigger',[0,240]),
        node('Example input','n8n-nodes-base.code',[220,240],{'jsCode':'return [{json: '+json.dumps({'state':context,'questions':{'route':{'type':'single_choice','question':question,'options':{str(i): label for i,label in enumerate(choices)}}}})+'}];'}),
        node('Saina Helm','@run-saina/n8n-nodes-saina.sainaHelm',[460,240],{'state':'={{ $json.state }}','questions':'={{ JSON.stringify($json.questions) }}','mode':'decision','threshold':.8,'minMargin':.05,'errorMode':'fallback','timeout':60}),
        node('Selected branch','n8n-nodes-base.switch',[700,160],{'mode':'expression','numberOutputs':len(choices),'output':'={{ Number($json.saina.answers.route.selection) }}'},3.2),
        node('Uncertain or failed — review','n8n-nodes-base.noOp',[700,440]),
        node('Setup','n8n-nodes-base.stickyNote',[120,-40],{'content':'## Saina Helm: '+title+'\nInstall the local community node and select your Saina API credentials. Run the sample before replacing the input with your trigger. Selected branches end in no-op nodes; wire your real actions after testing. Fallback includes low confidence, small margin, ties, and inference errors. The 0.8 threshold is an example, not a calibrated default.','height':220,'width':640})]
    connections={};connect(connections,'Run example',[['Example input']]);connect(connections,'Example input',[['Saina Helm']]);connect(connections,'Saina Helm',[['Selected branch'],['Uncertain or failed — review']]);
    names=[]
    for i,label in enumerate(choices):
        name=f'{i+1}. {label}';names.append(name);nodes.append(node(name,'n8n-nodes-base.noOp',[960,i*150+40]))
    connect(connections,'Selected branch',[[name] for name in names])
    (root/(slug+'.json')).write_text(json.dumps({'name':'Saina Helm — '+title,'nodes':nodes,'connections':connections,'active':False,'settings':{'executionOrder':'v1'},'pinData':{},'tags':[]},indent=2)+'\n')
# No custom node needed: hosted n8n can use HTTP Request and IF.
nodes=[node('Run example','n8n-nodes-base.manualTrigger',[0,240]),
    node('Example input','n8n-nodes-base.code',[220,240],{'jsCode':'return [{json:{model:"saina-helm-0.8b",state:"I was charged twice.",mode:"decision",questions:{team:{type:"single_choice",question:"Which team should handle this?",options:{billing:"Billing",technical:"Technical support",other:"Other"}}},threshold:0.8,min_margin:0.05}}];'}),
    node('Saina API','n8n-nodes-base.httpRequest',[460,240],{'method':'POST','url':'https://YOUR-SAINA-API.example.com/v1/ask','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','sendBody':True,'specifyBody':'json','jsonBody':'={{ JSON.stringify($json) }}','options':{'timeout':60000,'redirect':{'redirect':{'followRedirects':False}}}},4.2),
    node('Decision accepted?','n8n-nodes-base.if',[700,240],{'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':2},'conditions':[{'id':'accepted','leftValue':'={{ $json.answers.team.reason }}','rightValue':'accepted','operator':{'type':'string','operation':'equals'}}],'combinator':'and'},'options':{}},2.2),
    node('Use answers.team.selection to route','n8n-nodes-base.noOp',[950,140]),node('Human review','n8n-nodes-base.noOp',[950,340]),
    node('Setup','n8n-nodes-base.stickyNote',[120,-40],{'content':'## No community node required\nSet Saina API URL and select Header Auth credentials: name Authorization, value Bearer YOUR_KEY. Keep secrets in credentials. Use HTTP Request → Settings → On Error to connect your own error path; HTTP failures stop this example by default. Returned probabilities are model scores, not calibrated guarantees.','height':220,'width':650})]
connections={}
for source,outputs in [('Run example',[['Example input']]),('Example input',[['Saina API']]),('Saina API',[['Decision accepted?']]),('Decision accepted?',[['Use answers.team.selection to route'],['Human review']])]:connect(connections,source,outputs)
(root/'http-request-portable.json').write_text(json.dumps({'name':'Saina Helm — HTTP portable starter','nodes':nodes,'connections':connections,'active':False,'settings':{'executionOrder':'v1'},'pinData':{},'tags':[]},indent=2)+'\n')
