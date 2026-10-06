const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SainaHelm}=require('../dist/nodes/SainaHelm/SainaHelm.node');
const {readResponse,parseQuestions}=require('../dist/nodes/SainaHelm/contract');
const questions={team:{type:'single_choice',question:'Which team?',options:{billing:'Billing',technical:'Technical',other:'Other'}}};
function response(accepted=true) {return {model:'saina-helm-0.8b',answers:{team:{type:'single_choice',probabilities:{billing:accepted?.9:.4,technical:accepted?.07:.3,other:accepted?.03:.3},selection:accepted?'billing':null,confidence:accepted?.85:.1,reason:accepted?'accepted':'below_threshold'}},usage:{input_tokens:4,output_tokens:0}};}
test('validates typed answers and probability vectors',()=>{
 assert.deepEqual(readResponse(response(),questions,'decision'),response());
 assert.throws(()=>readResponse({answers:{}},questions,'decision'));
 const bad=response();bad.answers.team.probabilities.billing=NaN;
 assert.throws(()=>readResponse(bad,questions,'decision'));
 assert.throws(()=>parseQuestions('[]'));
});
function context(responses,overrides={}) {
 const params={state:'Support ticket',questions:JSON.stringify(questions),mode:'decision',threshold:.8,minMargin:0,errorMode:'stop',timeout:60,...overrides};let count=0;
 return {getInputData:()=>responses.map((_,i)=>({json:{id:i},binary:{file:{data:'a',mimeType:'text/plain'}}})),getCredentials:async()=>({baseUrl:'https://example.com',apiKey:'secret'}),getNodeParameter:name=>params[name],getNode:()=>({name:'Saina Helm',type:'sainaHelm',typeVersion:1,position:[0,0],parameters:{}}),continueOnFail:()=>false,helpers:{httpRequestWithAuthentication:async function(name,options){assert.equal(name,'sainaHelmApi');assert.equal(options.disableFollowRedirect,true);assert.equal(options.url,'https://example.com/v1/ask');assert.deepEqual(options.body.questions,questions);assert.equal(options.body.mode,params.mode);assert.equal(Object.hasOwn(options.body,'threshold'),params.mode==='decision');const r=responses[count++];if(r instanceof Error)throw r;return r;}}};
}
test('multi-item selected/fallback preserves pairing and binary',async()=>{
 const out=await new SainaHelm().execute.call(context([response(),response(false)]));
 assert.equal(out[0][0].json.id,0);assert.equal(out[1][0].json.id,1);
 assert.deepEqual(out[1][0].pairedItem,{item:1});assert.equal(out[0][0].binary.file.data,'a');
});
test('distribution mode omits policy and emits result',async()=>{
 const r=response();delete r.answers.team.reason;
 const out=await new SainaHelm().execute.call(context([r],{mode:'distribution'}));
 assert.equal(out[0].length,1);
});
test('sanitized explicit error fallback',async()=>{
 const out=await new SainaHelm().execute.call(context([new Error('secret Authorization: Bearer secret')],{errorMode:'fallback'}));
 assert.equal(out[1][0].json.saina.reason,'inference_error');assert.ok(!JSON.stringify(out).includes('secret'));
});
test('stop on inference errors by default',async()=>{await assert.rejects(new SainaHelm().execute.call(context([new Error('secret')])));});
