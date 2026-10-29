const {test}=require('node:test');
const assert=require('node:assert/strict');
const {studioRequest,mcpOperation}=require('../dist/nodes/SainaHelm/studio');
const {SainaHelm}=require('../dist/nodes/SainaHelm/SainaHelm.node');
const {SainaTrace}=require('../dist/nodes/SainaTrace/SainaTrace.node');
const {SainaOAuth2Api}=require('../dist/credentials/SainaOAuth2Api.credentials');
const payload={saina:{models:[{name:'helm'}]},providers:[],endpoints:[]};
const reply=value=>({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(value)}]}});
function context(authentication='oAuth2',response=reply(payload)) {
 const calls=[], credentials=[];
 return {calls,credentials,ctx:{getNode:()=>({parameters:{authentication}}),getCredentials:async name=>{credentials.push(name);return {baseUrl:'https://api.saina.run'};},helpers:{httpRequestWithAuthentication:async (credential,options)=>{calls.push({credential,options});return response;}}}};
}
test('OAuth discovery uses the selected credential and MCP transport, including dropdown loading',async()=>{
 const {ctx,calls,credentials}=context();
 const options=await new SainaHelm().methods.loadOptions.getProviders.call(ctx);
 assert.equal(options[0].value,'saina');
 assert.deepEqual(credentials,['sainaOAuth2Api']);
 assert.equal(calls[0].credential,'sainaOAuth2Api');
 assert.equal(calls[0].options.url,'https://api.saina.run/v1/mcp');
 assert.equal(calls[0].options.disableFollowRedirect,true);
 assert.equal(calls[0].options.body.params.name,'get_discovery');
});
test('existing API-key requests keep their REST transport',async()=>{
 const {ctx,calls}=context(undefined,payload);ctx.getNode=()=>({parameters:{}});
 assert.deepEqual(await studioRequest(ctx,'https://api.saina.run','GET','/v1/studio/discovery'),payload);
 assert.equal(calls[0].credential,'sainaApi');assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.url,'https://api.saina.run/v1/studio/discovery');
});
test('OAuth maps every current node operation and preserves media and identifiers',()=>{
 const body={state:'test',images:['data:image/png;base64,aGk='],version:'production'};
 assert.deepEqual(mcpOperation('POST','/v1/studio/endpoints/support/decide',body),{name:'run_decision_endpoint',arguments:{...body,endpoint:'support',confirm_cost:true}});
 assert.equal(mcpOperation('POST','/v1/studio/playground/test',{request:body}).arguments.request,body);
 assert.equal(mcpOperation('POST','/v1/studio/business-outcomes',{event_id:'e'}).name,'report_decision_outcome');
 assert.equal(mcpOperation('POST','/v1/traces',{}).name,'log_traces');
 assert.deepEqual(mcpOperation('GET','/v1/studio/decisions/dec_1').arguments,{decision_id:'dec_1'});
 assert.throws(()=>mcpOperation('POST','/unknown'),/Unsupported/);
});
test('OAuth protocol and tool errors are rejected without copying server error text',async()=>{
 for (const response of [{jsonrpc:'2.0',id:1,error:{message:'secret'}},{jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:'secret'}]}},{}, {jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'not-json'}]}}]) {
  const {ctx}=context('oAuth2',response);
  await assert.rejects(()=>studioRequest(ctx,'https://api.saina.run','GET','/v1/studio/discovery'),e=>!e.message.includes('secret'));
 }
});
test('Trace executes with OAuth credentials and unwraps the MCP payload',async()=>{
 const {ctx,calls}=context('oAuth2',reply({decision_id:'dec_1'}));
 ctx.getInputData=()=>[{json:{input:1}}];ctx.getNodeParameter=(name,_i,fallback)=>({operation:'getDecision',decisionId:'dec_1'})[name]??fallback;ctx.continueOnFail=()=>false;
 const [out]=await new SainaTrace().execute.call(ctx);
 assert.equal(out[0].json.saina.decision_id,'dec_1');assert.equal(calls[0].options.body.params.name,'get_decision');
});
test('OAuth inherits n8n token handling and fixes PKCE, scope and body authentication',()=>{
 const credential=new SainaOAuth2Api();const fields=Object.fromEntries(credential.properties.map(p=>[p.name,p.default]));
 assert.deepEqual(credential.extends,['oAuth2Api']);assert.equal(fields.grantType,'pkce');assert.equal(fields.scope,'mcp');assert.equal(fields.authentication,'body');
 assert.ok(require('../package.json').n8n.credentials.includes('dist/credentials/SainaOAuth2Api.credentials.js'));
});
