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

const {buildQuestion,readAdvanced}=require('../dist/nodes/SainaHelm/form');
test('minimal form sends labels without descriptions or JSON',async()=>{
 const params={context:'I was charged twice',question:'Which team?',answers:'Billing\nTechnical support\nOther',advanced:{}};
 const ctx=context([response()]);ctx.getNode=()=>({name:'Saina Helm',type:'sainaHelm',typeVersion:2,position:[0,0],parameters:{}});
 ctx.getNodeParameter=(name,_index,fallback)=>params[name]??fallback;
 let sent;
 ctx.helpers.httpRequestWithAuthentication=async(_name,options)=>{
  sent=options;
  return {model:'saina-helm-0.8b',answers:{answer:{type:'single_choice',probabilities:{Billing:.9,'Technical support':.07,Other:.03},selection:'Billing',reason:'accepted'}},usage:{input_tokens:4,output_tokens:0}};
 };
 const out=await new SainaHelm().execute.call(ctx);
 assert.deepEqual(sent.body,{model:'saina-helm',state:params.context,mode:'decision',questions:{answer:{type:'single_choice',question:'Which team?',options:{Billing:null,'Technical support':null,Other:null}}},threshold:.8,min_margin:0});
 assert.equal(sent.timeout,60000);assert.equal(out[0][0].json.saina.answers.answer.selection,'Billing');
});
test('answers support commas, newlines, and punctuation without changing labels',()=>{
 assert.deepEqual(Object.keys(buildQuestion('Choose',' Billing, Other ').answer.options),['Billing','Other']);
 assert.deepEqual(Object.keys(buildQuestion('Choose','Sales, Europe\nSales, Americas').answer.options),['Sales, Europe','Sales, Americas']);
 assert.equal(Object.hasOwn(buildQuestion('Choose','__proto__\nOther').answer.options,'__proto__'),true);
});
test('advanced types and optional descriptions map to the native API contract',()=>{
 assert.deepEqual(buildQuestion('Which?', 'Billing\nOther', {resultKey:'route',answerType:'multi_choice',descriptions:{entries:[{answer:'Billing',description:'Invoices and charges'}]}}),{route:{type:'multi_choice',question:'Which?',options:{Billing:'Invoices and charges',Other:null}}});
 assert.deepEqual(buildQuestion('Is it urgent?','No, Yes',{answerType:'yes_no'}).answer.descriptions,{yes:'Yes',no:'No'});
 assert.deepEqual(buildQuestion('How urgent?','Low\nMedium\nHigh',{answerType:'rating'}).answer.levels,['Low','Medium','High']);
});
test('invalid questions and advanced settings fail before API calls',async()=>{
 for(const [q,a,advanced] of [['','A,B',{}],['Choose','A',{}],['Choose','A,a',{}],['Choose','A,,B',{}],['Choose','True,False',{answerType:'yes_no'}],['Choose','A,B',{descriptions:{entries:[{answer:'C',description:'Unmatched'}]}}],['Choose','A,B',{resultKey:'bad.key'}],['Choose',Array.from({length:11},(_,i)=>String(i)).join(','),{answerType:'rating'}]]) assert.throws(()=>buildQuestion(q,a,advanced));
 for (const options of [{threshold:NaN},{threshold:2},{minMargin:-1},{timeout:0},{mode:'unknown'},{model:'gpt-4'}]) assert.throws(()=>readAdvanced(options));
 const ctx=context([response()]);ctx.getNode=()=>({name:'Saina Helm',type:'sainaHelm',typeVersion:2,position:[0,0],parameters:{}});
 const params={context:'',question:'Which?',answers:'A,B',advanced:{errorMode:'fallback'}};
 ctx.getNodeParameter=(name,_index,fallback)=>params[name]??fallback;
 let called=false;ctx.helpers.httpRequestWithAuthentication=async()=>{called=true;return response()};
 await assert.rejects(new SainaHelm().execute.call(ctx));assert.equal(called,false);
});
test('version 2 advanced distribution and explicit error fallback are respected',async()=>{
 const ctx=context([response()]);ctx.getNode=()=>({name:'Saina Helm',type:'sainaHelm',typeVersion:2,position:[0,0],parameters:{}});
 const params={context:'Ticket',question:'Which?',answers:'Billing,Other',advanced:{mode:'distribution',errorMode:'fallback',timeout:12}};
 ctx.getNodeParameter=(name,_index,fallback)=>params[name]??fallback;
 let sent;ctx.helpers.httpRequestWithAuthentication=async(_name,options)=>{sent=options;throw new Error('secret')};
 const out=await new SainaHelm().execute.call(ctx);
 assert.equal(sent.body.mode,'distribution');assert.equal(Object.hasOwn(sent.body,'threshold'),false);assert.equal(sent.timeout,12000);
 assert.equal(out[1][0].json.saina.reason,'inference_error');assert.ok(!JSON.stringify(out).includes('secret'));
});
test('n8n renders only Context, Question, Answers, and Advanced for version 2',()=>{
 const {NodeHelpers}=require('n8n-workflow');const description=new SainaHelm().description;
 const fields=description.properties.filter(property=>NodeHelpers.displayParameter({},property,{typeVersion:2},description));
 assert.deepEqual(fields.map(field=>field.displayName),['Context','Question','Answers','Advanced']);
 assert.deepEqual(fields.filter(field=>field.required).map(field=>field.name),['context','question','answers']);
 const resolved=NodeHelpers.getNodeParameters(description.properties,{context:'Ticket',question:'Which team?',answers:'Billing,Other'},true,false,{typeVersion:2},description);
 assert.deepEqual(resolved,{context:'Ticket',question:'Which team?',answers:'Billing,Other',advanced:{}});
 const legacy=description.properties.filter(property=>NodeHelpers.displayParameter({mode:'decision'},property,{typeVersion:1},description));
 assert.ok(legacy.some(field=>field.name==='questions'));assert.ok(!legacy.some(field=>field.name==='context'));
});
test('model option pins a release; version 1 keeps the original model',async()=>{
 const sentModels=[];
 for (const [version, advanced, expected] of [[2,{model:'saina-helm-2-0.8b'},'saina-helm-2-0.8b'],[2,{model:'saina-helm-0.8b'},'saina-helm-0.8b'],[1,{},'saina-helm-0.8b']]) {
  const ctx=context([response()]);ctx.getNode=()=>({name:'Saina Helm',type:'sainaHelm',typeVersion:version,position:[0,0],parameters:{}});
  const params={context:'Ticket',question:'Which?',answers:'billing,technical,other',advanced,state:'Ticket',questions:JSON.stringify(questions),mode:'decision',threshold:.8,minMargin:0,errorMode:'stop',timeout:60};
  ctx.getNodeParameter=(name,_index,fallback)=>params[name]??fallback;
  ctx.helpers.httpRequestWithAuthentication=async(_name,options)=>{
   sentModels.push(options.body.model);const r=response();
   return {...r,answers:{[Object.keys(options.body.questions)[0]]:r.answers.team}};
  };
  await new SainaHelm().execute.call(ctx);
  assert.equal(sentModels.at(-1),expected);
 }
});
