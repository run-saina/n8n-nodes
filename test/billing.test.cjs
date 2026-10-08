const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {SainaHelm}=require('../dist/nodes/SainaHelm/SainaHelm.node');
const billing=require('../dist/nodes/SainaHelm/billing');
const {SainaHelmApi}=require('../dist/credentials/SainaHelmApi.credentials');
const {uuidv7,isUuidV7,parseCredits,parseRetryAfter,retryTiming}=billing;

const answerBody={model:'saina-helm-0.8b',answers:{answer:{type:'single_choice',probabilities:{Billing:.9,Other:.1},selection:'Billing',reason:'accepted'}},usage:{input_tokens:4,output_tokens:0}};
const ok=(headers={})=>({statusCode:200,headers:{'x-request-id':'req_ok','x-saina-credits-charged':'4','x-saina-balance':'249999996','x-saina-price-version':'1','x-saina-replayed':'false',...headers},body:answerBody});
const apiError=(status,code,extra={},headers={})=>({statusCode:status,headers:{'x-request-id':'req_err',...headers},body:{error:{code,message:`${code} message`,request_id:'req_err',admitted:false,state:'not_admitted',retry:'no',...extra},detail:'x'}});
const netError=code=>Object.assign(new Error('connect failed Authorization: Bearer sk_saina_secret'),{code});

let delays;
beforeEach(()=>{delays=[];retryTiming.random=()=>0;retryTiming.sleep=async ms=>{delays.push(ms);};});

// Fake request helper: replays scripted responses and records every request sent.
function run(script,{advanced={},continueOnFail=false,items=1}={}) {
 const calls=[];let n=0;
 const params={context:'Ticket',question:'Which team?',answers:'Billing\nOther',advanced};
 const ctx={
  getInputData:()=>Array.from({length:items},(_,i)=>({json:{id:i}})),
  getCredentials:async()=>({baseUrl:'https://api.saina.run',apiKey:'sk_saina_secret'}),
  getNodeParameter:(name,_i,fallback)=>params[name]??fallback,
  getNode:()=>({name:'Saina Helm',type:'sainaHelm',typeVersion:2,position:[0,0],parameters:{}}),
  continueOnFail:()=>continueOnFail,
  helpers:{httpRequestWithAuthentication:async(name,options)=>{
   assert.equal(name,'sainaHelmApi');calls.push({...options,serialized:JSON.stringify(options.body)});
   const r=typeof script==='function'?script(n++,options):script[Math.min(n++,script.length-1)];
   if(r instanceof Error)throw r;return r;
  }},
 };
 return {calls,promise:new SainaHelm().execute.call(ctx)};
}

test('uuidv7 follows RFC 9562 layout and embeds the millisecond timestamp',()=>{
 const now=Date.UTC(2026,9,8,12,0,0,123);const key=uuidv7(now);
 assert.ok(isUuidV7(key));assert.equal(key[14],'7');assert.ok('89ab'.includes(key[19]));
 assert.equal(parseInt(key.replace(/-/g,'').slice(0,12),16),now);
 assert.notEqual(uuidv7(now),key);
 assert.equal(isUuidV7('3b241101-e2bb-4255-8caf-4136c566a962'),false);// v4
 assert.equal(isUuidV7('0192f0c4-1c2b-7d3e-cf00-123456789abc'),false);// variant 11
 assert.equal(isUuidV7('not-a-uuid'),false);
});

test('each item gets its own UUIDv7 key and the request contract is preserved',async()=>{
 const {calls,promise}=run([ok()],{items:2});const out=await promise;
 assert.equal(calls.length,2);
 for(const c of calls){assert.ok(isUuidV7(c.headers['Idempotency-Key']));assert.equal(c.returnFullResponse,true);assert.equal(c.ignoreHttpStatusErrors,true);assert.equal(c.disableFollowRedirect,true);assert.equal(c.url,'https://api.saina.run/v1/ask');}
 assert.notEqual(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 assert.deepEqual(out[0][0].json.saina,answerBody);
 assert.equal(out[0][0].json._saina.idempotency_key,calls[0].headers['Idempotency-Key']);
});

test('retries reuse the same key and identical body',async()=>{
 const {calls,promise}=run([netError('ECONNRESET'),apiError(503,'accounting_unavailable',{retry:'same_operation',state:'unknown'}),ok({'x-saina-replayed':'true'})]);
 const out=await promise;
 assert.equal(calls.length,3);
 assert.equal(new Set(calls.map(c=>c.headers['Idempotency-Key'])).size,1);
 assert.equal(new Set(calls.map(c=>c.serialized)).size,1);
 assert.equal(calls[0].body,calls[2].body);
 assert.equal(out[0][0].json._saina.attempts,3);assert.equal(out[0][0].json._saina.replayed,true);
});

const retryable=[
 ['connection reset',()=>netError('ECONNRESET')],
 ['timeout',()=>netError('ECONNABORTED')],
 ['wrapped transport error',()=>Object.assign(new Error('The connection to the server was closed unexpectedly'),{cause:{code:'ECONNRESET'}})],
 ['uncertain 502 without contract body',()=>({statusCode:502,headers:{},body:'<html>bad gateway</html>'})],
 ['accounting_unavailable',()=>apiError(503,'accounting_unavailable',{retry:'same_operation',state:'unknown'})],
 ['request_in_progress',()=>apiError(409,'request_in_progress',{retry:'same_operation',state:'in_progress',admitted:true})],
 ['rate_limited',()=>apiError(429,'rate_limited',{retry:'same_operation'})],
 ['overloaded not admitted',()=>apiError(429,'overloaded',{retry:'same_operation'})],
 ['inference_unavailable not admitted',()=>apiError(503,'inference_unavailable',{retry:'same_operation'})],
];
const terminal=[
 ['overloaded after admission',()=>apiError(503,'overloaded',{admitted:true,state:'terminal',retry:'new_operation'})],
 ['inference_unavailable after admission',()=>apiError(503,'inference_unavailable',{admitted:true,state:'terminal'})],
 ['inference_failed',()=>apiError(502,'inference_failed',{admitted:true,state:'terminal',retry:'new_operation'})],
 ...['idempotency_conflict','idempotency_result_expired','idempotency_unverifiable','insufficient_credits','account_suspended','invalid_api_key','key_revoked','invalid_request','permission_denied'].map(code=>[code,()=>apiError(code==='insufficient_credits'?402:400,code)]),
 ['unknown client failure',()=>new Error('secret')],
 ['DNS failure',()=>netError('ENOTFOUND')],
];
for(const [name,make] of retryable) test(`retries ${name} with the same key, then succeeds`,async()=>{
 const {calls,promise}=run(n=>n===0?make():ok());const out=await promise;
 assert.equal(calls.length,2);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 assert.equal(out[0].length,1);
});
for(const [name,make] of terminal) test(`never retries ${name}`,async()=>{
 const {calls,promise}=run(()=>make());await assert.rejects(promise);assert.equal(calls.length,1);
});

test('max retries bounds attempts and 0 disables retries',async()=>{
 let r=run(()=>apiError(429,'rate_limited',{retry:'same_operation'}));
 await assert.rejects(r.promise,err=>err.context.saina.attempts===3);assert.equal(r.calls.length,3);
 r=run(()=>apiError(429,'rate_limited',{retry:'same_operation'}),{advanced:{maxRetries:5}});await assert.rejects(r.promise);assert.equal(r.calls.length,6);
 r=run(()=>netError('ECONNRESET'),{advanced:{maxRetries:0}});await assert.rejects(r.promise);assert.equal(r.calls.length,1);
 r=run([ok()],{advanced:{maxRetries:11}});await assert.rejects(r.promise);assert.equal(r.calls.length,0);
});

test('Retry-After is honored and backoff grows exponentially',async()=>{
 let r=run([apiError(429,'rate_limited',{retry:'same_operation'},{'retry-after':'3'}),netError('ECONNRESET'),netError('ECONNRESET'),ok()],{advanced:{maxRetries:3}});
 await r.promise;assert.deepEqual(delays,[3000,500,1000]);// random=0 → half of 500·2^n, floor at Retry-After
 delays=[];retryTiming.random=()=>1;
 r=run([netError('ECONNRESET'),ok()]);await r.promise;assert.deepEqual(delays,[500]);
 delays=[];
 r=run([apiError(409,'request_in_progress',{retry:'same_operation'},{'Retry-After':'120'}),ok()]);
 await assert.rejects(r.promise,/request_in_progress/);assert.equal(r.calls.length,1);assert.deepEqual(delays,[]);// too long to block on
 assert.equal(parseRetryAfter(new Date(Date.now()+10_000).toUTCString())>8000,true);
 assert.equal(parseRetryAfter('0.5'),500);assert.equal(parseRetryAfter('soon'),undefined);
});

test('billing errors map to NodeApiError with code, request ID, state, and guidance',async()=>{
 const {promise}=run([apiError(402,'insufficient_credits')]);
 await assert.rejects(promise,err=>{
  assert.equal(err.constructor.name,'NodeApiError');assert.equal(err.httpCode,'402');
  assert.match(err.message,/insufficient_credits/);
  assert.match(err.description,/https:\/\/saina\.run\/console\//);assert.match(err.description,/req_err/);
  assert.match(err.description,/admitted=false, state=not_admitted, retry=no/);
  assert.equal(err.context.saina.code,'insufficient_credits');assert.equal(err.context.saina.request_id,'req_err');
  assert.ok(isUuidV7(err.context.saina.idempotency_key));
  return true;
 });
 const suspended=run([apiError(403,'account_suspended',{suspension:{types:['security'],next_step:'contact_support'}})]);
 await assert.rejects(suspended.promise,err=>/contact Saina support/.test(err.description)&&err.context.saina.suspension.next_step==='contact_support');
 const conflict=run([apiError(409,'idempotency_conflict')]);
 await assert.rejects(conflict.promise,err=>/new key/.test(err.description));
 const net=run(()=>netError('ECONNREFUSED'));
 await assert.rejects(net.promise,err=>err.constructor.name==='NodeOperationError'&&/ECONNREFUSED/.test(err.description)&&/after 3 attempt/.test(err.message)&&!JSON.stringify(err).includes('sk_saina_secret'));
});

test('Continue On Fail and fallback mode put error fields on the item',async()=>{
 let r=run([apiError(402,'insufficient_credits')],{continueOnFail:true});let out=await r.promise;
 const e=out[1][0].json.saina;assert.equal(e.reason,'inference_error');
 assert.equal(e.error.code,'insufficient_credits');assert.equal(e.error.http_status,402);assert.equal(e.error.request_id,'req_err');
 assert.equal(e.error.admitted,false);assert.equal(e.error.state,'not_admitted');assert.equal(e.error.retry,'no');
 assert.match(e.error.guidance,/saina\.run\/console/);assert.equal(out[1][0].json.id,0);assert.deepEqual(out[1][0].pairedItem,{item:0});
 r=run(()=>netError('ECONNRESET'),{advanced:{errorMode:'fallback'}});out=await r.promise;
 assert.equal(out[1][0].json.saina.error.code,'ECONNRESET');assert.ok(!JSON.stringify(out).includes('sk_saina_secret'));
});

test('billing metadata is output under _saina and can be turned off',async()=>{
 let r=run([ok()]);let out=await r.promise;
 assert.deepEqual(out[0][0].json._saina,{request_id:'req_ok',idempotency_key:r.calls[0].headers['Idempotency-Key'],credits_charged:4,credits_charged_raw:'4',balance:249999996,balance_raw:'249999996',price_version:'1',replayed:false,attempts:1});
 r=run([{statusCode:200,headers:{'X-Request-Id':'req_p','X-Saina-Credits-Charged':'0'},body:answerBody}]);out=await r.promise;
 assert.equal(out[0][0].json._saina.request_id,'req_p');assert.equal(out[0][0].json._saina.credits_charged,0);assert.equal(out[0][0].json._saina.balance,null);
 r=run([ok()],{advanced:{includeBilling:false}});out=await r.promise;
 assert.equal(Object.hasOwn(out[0][0].json,'_saina'),false);assert.deepEqual(out[0][0].json.saina,answerBody);
});

test('credit strings above Number.MAX_SAFE_INTEGER are rejected, not rounded',async()=>{
 assert.deepEqual(parseCredits('balance','9007199254740991'),{value:9007199254740991,raw:'9007199254740991'});
 assert.deepEqual(parseCredits('balance','-5'),{value:-5,raw:'-5'});
 assert.equal(parseCredits('balance',undefined),null);
 assert.throws(()=>parseCredits('balance','9007199254740992'),err=>err instanceof billing.UnsafeCreditValue&&err.raw==='9007199254740992');
 assert.throws(()=>parseCredits('balance','1e3'));
 let r=run([ok({'x-saina-balance':'9007199254740993'})]);
 await assert.rejects(r.promise,err=>/9007199254740993/.test(err.message)&&/does not round/.test(err.message));
 r=run([ok({'x-saina-balance':'9007199254740993'})],{continueOnFail:true});const out=await r.promise;
 assert.equal(out[1][0].json.saina.error.code,'unsafe_credit_value');assert.equal(out[1][0].json.saina.error.raw_value,'9007199254740993');assert.equal(out[1][0].json.saina.error.field,'balance');
 assert.equal(r.calls.length,1);
});

test('a pinned Idempotency Key is validated and sent unchanged on every attempt',async()=>{
 const key=uuidv7();
 let r=run([netError('ETIMEDOUT'),ok()],{advanced:{idempotencyKey:` ${key} `}});const out=await r.promise;
 assert.deepEqual(r.calls.map(c=>c.headers['Idempotency-Key']),[key,key]);assert.equal(out[0][0].json._saina.idempotency_key,key);
 r=run([ok()],{advanced:{idempotencyKey:'3b241101-e2bb-4255-8caf-4136c566a962'}});
 await assert.rejects(r.promise,/UUIDv7/);assert.equal(r.calls.length,0);
 r=run([ok()],{advanced:{idempotencyKey:12345},continueOnFail:true});const failed=await r.promise;
 assert.equal(failed[1][0].json.saina.error.code,'invalid_idempotency_key');assert.equal(r.calls.length,0);
});

test('credential defaults to the hosted API and documents console keys without secrets',()=>{
 const cred=new SainaHelmApi();const base=cred.properties.find(p=>p.name==='baseUrl');const key=cred.properties.find(p=>p.name==='apiKey');
 assert.equal(base.default,'https://api.saina.run');assert.equal(key.default,'');
 assert.match(key.description,/saina\.run\/console/);assert.match(key.description,/shown once/);
});

test('the default credential base URL is used when none is stored',async()=>{
 const calls=[];const ctx={getInputData:()=>[{json:{}}],getCredentials:async()=>({baseUrl:'',apiKey:'k'}),getNodeParameter:(name,_i,f)=>({context:'c',question:'q',answers:'Billing,Other',advanced:{}})[name]??f,getNode:()=>({typeVersion:2}),continueOnFail:()=>false,helpers:{httpRequestWithAuthentication:async(_n,o)=>{calls.push(o);return ok();}}};
 await new SainaHelm().execute.call(ctx);assert.equal(calls[0].url,'https://api.saina.run/v1/ask');
});
