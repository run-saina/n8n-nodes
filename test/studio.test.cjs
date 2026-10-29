const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SainaHelm}=require('../dist/nodes/SainaHelm/SainaHelm.node');
const {SainaTrace}=require('../dist/nodes/SainaTrace/SainaTrace.node');
const {providerOptions,modelOptions,endpointOptions,versionOptions,buildQuestions,parseState,accepted}=require('../dist/nodes/SainaHelm/studio');

const discovery={
 saina:{models:[{name:'saina-helm-2-omni-0.8b',question_types:['noul','choice','score'],inputs:['text','image','audio']}]},
 providers:[{id:'hf',name:'Hugging Face · huggingface',adapter:'huggingface',models:[{name:'Qwen/Qwen3-8B',question_types:['choice'],inputs:['text']}]}],
 endpoints:[{name:'support-triage',display_name:'Support triage',published_version:3,production_version:2,versions:[1,2,3],questions_mode:'defined',inputs:{format:'text'}}],
};
test('dropdowns follow discovery: Saina first, providers, Endpoint only when one is published',()=>{
 assert.deepEqual(providerOptions(discovery).map(o=>o.value),['saina','hf','endpoint']);
 assert.deepEqual(providerOptions({...discovery,endpoints:[]}).map(o=>o.value),['saina','hf']);
 assert.deepEqual(modelOptions(discovery,'saina').map(o=>o.value),['saina-helm-2-omni-0.8b']);
 assert.deepEqual(modelOptions(discovery,'hf')[0],{name:'Qwen/Qwen3-8B',value:'Qwen/Qwen3-8B',description:'Choose one · text'});
 assert.deepEqual(modelOptions(discovery,'missing'),[]);
 assert.deepEqual(endpointOptions(discovery)[0],{name:'Support triage',value:'support-triage',description:'support-triage · production v2'});
 assert.deepEqual(versionOptions(discovery,'support-triage').map(o=>o.value),['production','3','2','1']);
 assert.equal(versionOptions(discovery,'support-triage')[0].name,'Production (v2)');
 assert.deepEqual(versionOptions(discovery,'unknown').map(o=>o.value),['production']);
});
test('questions build Studio definitions with per-question thresholds',()=>{
 const {questions,thresholds}=buildQuestions([
  {instructions:'Urgent?',type:'noul',noAtOrBelow:.3,yesAtOrAbove:.7},
  {id:'team',instructions:'Which team?',type:'choice',criteria:'billing: Charges and refunds\ntechnical: Bugs\nother',minProbability:.6},
  {instructions:'How angry?',type:'score',criteria:'Calm\nAnnoyed\nFurious'},
 ]);
 assert.deepEqual(questions,{
  question_1:{type:'noul',instructions:'Urgent?'},
  team:{type:'choice',instructions:'Which team?',criteria:{billing:'Charges and refunds',technical:'Bugs',other:'other'}},
  question_3:{type:'score',instructions:'How angry?',criteria:['Calm','Annoyed','Furious']},
 });
 assert.deepEqual(thresholds,{question_1:{no_at_or_below:.3,yes_at_or_above:.7},team:{min_selected_probability:.6}});
 assert.throws(()=>buildQuestions([]),/1–32/);
 assert.throws(()=>buildQuestions([{instructions:'',type:'noul'}]),/instructions/);
 assert.throws(()=>buildQuestions([{instructions:'x',type:'choice',criteria:'only'}]),/2–255/);
 assert.throws(()=>buildQuestions([{instructions:'x',type:'score',criteria:'one'}]),/2–10/);
 assert.throws(()=>buildQuestions([{id:'a',instructions:'x',type:'noul'},{id:'a',instructions:'y',type:'noul'}]),/unique/);
 assert.throws(()=>buildQuestions([{instructions:'x',type:'noul',noAtOrBelow:.8,yesAtOrAbove:.2}]),/cutoffs/);
});
test('input is sent as JSON when it is a JSON object or array, otherwise as text',()=>{
 assert.deepEqual(parseState(' {"a": 1} '),{a:1});
 assert.deepEqual(parseState('[1]'),[1]);
 assert.equal(parseState('{not json'),'{not json');
 assert.equal(parseState('  plain text '),'plain text');
});

const decision=(abstain=false)=>({decision_id:'dec_1',status:'completed',endpoint:'playground',endpoint_version:null,
 answers:{question_1:{type:'noul',status:abstain?'abstained':'accepted',value:abstain?null:true}},raw_response:{big:'x'},normalized_response:{big:'x'},provider_request:{big:'x'}});
test('selected and fallback split on abstentions and errors',()=>{
 assert.equal(accepted(decision()),true);assert.equal(accepted(decision(true)),false);
 assert.equal(accepted({...decision(),status:'error',answers:{}}),false);
});

function studioContext(responses,params,typeVersion=3) {
 const calls=[];let count=0;
 const ctx={
  getInputData:()=>responses.map((_,i)=>({json:{id:i},binary:{photo:{data:'aGk=',mimeType:'image/png'}}})),
  getCredentials:async()=>({baseUrl:'https://api.saina.run/',apiKey:'secret'}),
  getNodeParameter:(name,_i,fallback)=>params[name]??fallback,
  getNode:()=>({name:'Saina Decision',type:'sainaHelm',typeVersion,position:[0,0],parameters:{}}),
  continueOnFail:()=>false,
  helpers:{
   assertBinaryData:(_i,name)=>({mimeType:'image/png',name}),
   getBinaryDataBuffer:async()=>Buffer.from('hi'),
   httpRequestWithAuthentication:async(credential,options)=>{calls.push({credential,options});const r=responses[count++];if(r instanceof Error)throw r;return r;},
  },
 };
 return {ctx,calls};
}
test('model mode posts an ad hoc playground definition with attachments and the n8n client header',async()=>{
 const params={provider:'saina',model:'saina-helm-2-omni-0.8b',state:'{"ticket": "Charged twice"}',
  questions:{question:[{instructions:'Urgent?',type:'noul'},{id:'team',instructions:'Team?',type:'choice',criteria:'billing\nother'}]},
  media:{imagesBinary:'photo',audiosUrls:'["data:audio/wav;base64,AAAA"]'},options:{}};
 const {ctx,calls}=studioContext([{decision:decision(),passed:null},{decision:decision(true),passed:null}],params);
 const out=await new SainaHelm().execute.call(ctx);
 assert.equal(calls[0].credential,'sainaApi');
 assert.equal(calls[0].options.url,'https://api.saina.run/v1/studio/playground/test');
 assert.equal(calls[0].options.headers['X-Saina-Client'],'n8n');
 const body=calls[0].options.body;
 assert.deepEqual(body.request,{state:{ticket:'Charged twice'},images:['data:image/png;base64,aGk='],audios:['data:audio/wav;base64,AAAA']});
 assert.deepEqual(body.definition.model,{provider_id:'saina',name:'saina-helm-2-omni-0.8b'});
 assert.deepEqual(body.definition.inputs,{format:'text',modalities:['text','image','audio'],images:{required:false,max_items:8},audios:{required:false,max_items:4}});
 assert.deepEqual(Object.keys(body.definition.questions),['question_1','team']);
 assert.equal(out[0][0].json.id,0);assert.equal(out[1][0].json.id,1);
 assert.deepEqual(out[1][0].pairedItem,{item:1});assert.equal(out[0][0].binary.photo.data,'aGk=');
 assert.equal(out[0][0].json.saina.decision_id,'dec_1');assert.equal(out[0][0].json.saina.raw_response,undefined,'provider payloads are dropped');
});
test('endpoint mode posts to decide with production or a pinned version and keeps the decision id',async()=>{
 const base={provider:'endpoint',endpoint:'support-triage',state:'Charged twice',media:{},options:{}};
 let {ctx,calls}=studioContext([decision()],{...base,version:'production'});
 let out=await new SainaHelm().execute.call(ctx);
 assert.equal(calls[0].options.url,'https://api.saina.run/v1/studio/endpoints/support-triage/decide');
 assert.deepEqual(calls[0].options.body,{state:'Charged twice',version:'production'});
 assert.equal(out[0][0].json.saina.decision_id,'dec_1');
 ({ctx,calls}=studioContext([decision()],{...base,version:'2'}));
 await new SainaHelm().execute.call(ctx);
 assert.equal(calls[0].options.body.version,2);
 ({ctx}=studioContext([decision()],{...base,version:'latest'}));
 await assert.rejects(new SainaHelm().execute.call(ctx),/production or a positive integer/);
});
test('invalid inputs stop before any request; request errors are sanitized',async()=>{
 const params={provider:'saina',model:'',state:'x',questions:{question:[{instructions:'q',type:'noul'}]},media:{},options:{}};
 let {ctx,calls}=studioContext([decision()],params);
 await assert.rejects(new SainaHelm().execute.call(ctx),/Choose a model/);assert.equal(calls.length,0);
 ({ctx}=studioContext([new Error('Authorization: Bearer secret')],{...params,model:'m',options:{errorMode:'fallback'}}));
 const out=await new SainaHelm().execute.call(ctx);
 assert.deepEqual(out[1][0].json.saina,{status:'error',error:{code:'request_failed'}});assert.ok(!JSON.stringify(out).includes('secret'));
 ({ctx}=studioContext([new Error('secret')],{...params,model:'m'}));
 await assert.rejects(new SainaHelm().execute.call(ctx),/Saina request failed/);
});
test('version 2 workflows still call /v1/ask with the Helm credential',async()=>{
 const params={context:'I was charged twice',question:'Which team?',answers:'Billing\nOther',advanced:{}};
 const {ctx,calls}=studioContext([{model:'saina-helm-2-0.8b',answers:{answer:{type:'single_choice',probabilities:{Billing:.9,Other:.1},selection:'Billing',reason:'accepted'}},usage:{input_tokens:1,output_tokens:1}}],params,2);
 ctx.getCredentials=async()=>({baseUrl:'https://example.com',apiKey:'k'});
 const out=await new SainaHelm().execute.call(ctx);
 assert.equal(calls[0].credential,'sainaHelmApi');assert.equal(calls[0].options.url,'https://example.com/v1/ask');
 assert.equal(out[0][0].json.saina.answers.answer.selection,'Billing');
});

function traceContext(responses,params) {
 const calls=[];let count=0;
 const ctx={
  getInputData:()=>responses.map((_,i)=>({json:{id:i,saina:{decision_id:'dec_'+i}}})),
  getCredentials:async()=>({baseUrl:'http://localhost:8000',apiKey:''}),
  getNodeParameter:(name,_i,fallback)=>params[name]??fallback,
  getNode:()=>({name:'Saina Trace',type:'sainaTrace',typeVersion:1,position:[0,0],parameters:{}}),
  continueOnFail:()=>false,
  helpers:{httpRequestWithAuthentication:async(credential,options)=>{calls.push({credential,options});const r=responses[count++];if(r instanceof Error)throw r;return r;}},
 };
 return {ctx,calls};
}
test('report outcome posts to business-outcomes with a stable event id',async()=>{
 const {ctx,calls}=traceContext([{ok:true}],{operation:'reportOutcome',decisionId:'dec_0',eventId:'exec-1-0',values:'{"resolved":{"type":"boolean","value":true}}',questionId:'',timeout:30});
 const out=await new SainaTrace().execute.call(ctx);
 assert.equal(calls[0].options.url,'http://localhost:8000/v1/studio/business-outcomes');
 assert.deepEqual(calls[0].options.body,{decision_id:'dec_0',event_id:'exec-1-0',values:{resolved:{type:'boolean',value:true}}});
 assert.deepEqual(out[0][0].json.saina,{ok:true});
 const bad=traceContext([{}],{operation:'reportOutcome',decisionId:'dec 0',eventId:'e',values:'{}'});
 await assert.rejects(new SainaTrace().execute.call(bad.ctx),/Values must be/);assert.equal(bad.calls.length,0);
});
test('log trace sends a schema 1.0 envelope and returns the trace id',async()=>{
 const {ctx,calls}=traceContext([{accepted:1}],{operation:'logTrace',task:'route-ticket',inputs:'{"ticket":"x"}',outcome:'{"team":"billing"}',metadata:'{"application":"n8n"}',endpoint:'support-triage',traceId:''});
 const out=await new SainaTrace().execute.call(ctx);
 assert.equal(calls[0].options.url,'http://localhost:8000/v1/traces');
 const body=calls[0].options.body;
 assert.equal(body.schema_version,'1.0');assert.equal(body.traces.length,1);
 const record=body.traces[0];
 assert.match(record.trace_id,/^[0-9a-f-]{36}$/);assert.ok(record.recorded_at.endsWith('Z'));
 assert.deepEqual({task:record.task,inputs:record.inputs,outcome:record.outcome,metadata:record.metadata,endpoint:record.endpoint},{task:'route-ticket',inputs:{ticket:'x'},outcome:{team:'billing'},metadata:{application:'n8n'},endpoint:'support-triage'});
 assert.equal(out[0][0].json.saina.trace_id,record.trace_id);
});
test('get decision reads by id and never leaks request errors',async()=>{
 const {ctx,calls}=traceContext([{decision_id:'dec_0',status:'completed'}],{operation:'getDecision',decisionId:'dec_0'});
 const out=await new SainaTrace().execute.call(ctx);
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.url,'http://localhost:8000/v1/studio/decisions/dec_0');
 assert.equal(out[0][0].json.saina.status,'completed');
 const failing=traceContext([new Error('Bearer secret')],{operation:'getDecision',decisionId:'dec_0'});
 await assert.rejects(new SainaTrace().execute.call(failing.ctx),/Saina request failed/);
});
