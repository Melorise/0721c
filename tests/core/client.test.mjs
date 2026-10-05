import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../../src/core/index.mjs';
import { record,article,jsonResponse,deferred,turn } from './fixtures.mjs';
const id=record().blog_id;
test('one article URL request, no manifest; encoded segment paths remain human-readable',async()=>{
 const calls=[];const client=createClient({repository:'example/comments',fetchImpl:async(url,options)=>{
  calls.push(url);assert.equal(options.credentials,'omit');
  if(new URL(url).hostname==='api.github.com')return jsonResponse({ref:'refs/heads/index',object:{type:'commit',sha:'a'.repeat(40)}});
  return jsonResponse(article());
 }});
 assert.equal(calls.length,0);const result=await client.getComments(id);
 assert.deepEqual(calls,['https://raw.githubusercontent.com/example/comments/index/'+id+'.json']);
 assert.equal(result.totalCount,1);assert.equal(result.manifest,undefined);assert.equal(client.getManifest,undefined);
 assert.equal(result.comments[0].id,record().id);assert.ok(Object.isFrozen(result.comments[0]));
 await client.getComments(id);assert.equal(calls.length,1);
 await client.getComments(id,{force:true});assert.equal(calls.length,3);assert.match(calls[1],/git\/ref\/heads\/index\?refresh=/);assert.equal(calls[2],'https://raw.githubusercontent.com/example/comments/'+'a'.repeat(40)+'/'+id+'.json');
});
test('Unicode article path encodes segments, not slash delimiters',async()=>{
 let url;const path='文章/你好';const c=createClient({repository:'example/comments',fetchImpl:async value=>{url=value;return jsonResponse(article([],{blog_id:path}));}});
 await c.getComments(path);assert.equal(new URL(url).pathname,'/'+['example','comments','index','文章','你好.json'].map(encodeURIComponent).join('/'));
});
test('404 is empty article; no error is silently converted to an empty article',async()=>{
 const c=createClient({repository:'example/comments',fetchImpl:async()=>new Response(null,{status:404})});
 const result=await c.getComments(id);assert.equal(result.status,'empty');assert.equal(result.index,null);assert.equal(result.commentsEnabled,true);
 for(const status of [403,429,500])await assert.rejects(createClient({repository:'example/comments',fetchImpl:async()=>new Response(null,{status})}).getComments(id),e=>e.code==='HTTP_ERROR');
 await assert.rejects(createClient({repository:'example/comments',fetchImpl:async()=>{throw new TypeError('offline');}}).getComments(id),/offline/);
});
test('bad JSON, wrong article and invalid UTF8 stay visible errors',async()=>{
 for(const response of [()=>new Response('not JSON'),()=>jsonResponse(article([],{blog_id:'different'})),()=>new Response(new Uint8Array([0xff]))])await assert.rejects(createClient({repository:'example/comments',fetchImpl:async()=>response()}).getComments(id));
});
test('empty or populated disabled file retains approved history and hides submission',async()=>{
 const c=createClient({repository:'example/comments',fetchImpl:async()=>jsonResponse(article([record()],{comments_enabled:false}))});
 const result=await c.getComments(id);assert.equal(result.status,'disabled');assert.equal(result.totalCount,1);assert.equal(result.commentsEnabled,false);
});
test('shared request cancellation belongs to each subscriber',async()=>{
 const started=deferred(),response=deferred();let requests=0;let requestSignal;
 const c=createClient({repository:'example/comments',fetchImpl:async(_url,options)=>{requests++;requestSignal=options.signal;started.resolve();return response.promise;}});
 const abort=new AbortController();const one=c.getComments(id,{signal:abort.signal});const two=c.getComments(id);
 await started.promise;abort.abort();await assert.rejects(one,e=>e.name==='AbortError');assert.equal(requestSignal.aborted,false);
 response.resolve(jsonResponse(article()));assert.equal((await two).totalCount,1);assert.equal(requests,1);
});
test('last cancelled subscriber aborts transport, already-aborted call never requests',async()=>{
 let signal;const started=deferred();const c=createClient({repository:'example/comments',fetchImpl:async(_url,options)=>{signal=options.signal;started.resolve();return new Promise((_ok,no)=>signal.addEventListener('abort',()=>no(signal.reason)));}});
 const a=new AbortController();const p=c.getComments(id,{signal:a.signal});await started.promise;a.abort();await assert.rejects(p);await turn();assert.equal(signal.aborted,true);
 const b=new AbortController();b.abort();await assert.rejects(c.getComments(id,{signal:b.signal}));
});
test('force refresh beats older pending response; clearCache invalidates cache',async()=>{
 const old=deferred();let calls=0;const c=createClient({repository:'example/comments',fetchImpl:async(url)=>new URL(url).hostname==='api.github.com'?jsonResponse({ref:'refs/heads/index',object:{type:'commit',sha:'a'.repeat(40)}}):++calls===1?old.promise:jsonResponse(article([record(2)]))});
 const stale=c.getComments(id);await turn();const fresh=await c.getComments(id,{force:true});old.resolve(jsonResponse(article()));await stale;
 assert.equal((await c.getComments(id)).comments[0].id,fresh.comments[0].id);c.clearCache();await c.getComments(id);assert.equal(calls,3);
});
test('response size is bounded before buffered parse',async()=>{
 const c=createClient({repository:'example/comments',fetchImpl:async()=>new Response('{}',{headers:{'Content-Length':String(8*1024*1024+1)}})});
 await assert.rejects(c.getComments(id),e=>e.code==='RESPONSE_TOO_LARGE');
});


test('force reads the latest commit even when the branch URL remains stale', async () => {
 const calls=[];
 let sha='a'.repeat(40);
 const published=new Map([[sha,article([record(),record(2)])]]);
 const client=createClient({repository:'example/comments',fetchImpl:async(url,options)=>{
  calls.push({url,options});const target=new URL(url);
  if(target.hostname==='api.github.com')return jsonResponse({ref:'refs/heads/index',object:{type:'commit',sha}});
  const revision=target.pathname.split('/')[3];
  return jsonResponse(revision==='index'?article():published.get(revision));
 }});
 assert.equal((await client.getComments(id)).totalCount,1);
 assert.equal((await client.getComments(id,{force:true})).totalCount,2);
 sha='b'.repeat(40);published.set(sha,article([record(),record(2),record(3)]));
 assert.equal((await client.getComments(id,{force:true})).totalCount,3);
 assert.equal((await client.getComments(id)).totalCount,3);
 assert.equal(calls.length,5);
 assert.ok(calls.slice(1).every(call=>call.options.cache==='no-store'&&call.options.credentials==='omit'));
 assert.equal(calls.filter(call=>new URL(call.url).pathname.includes('/index/'+id)).length,1);
 assert.notEqual(calls[1].url,calls[3].url);
});

test('force resolves a previously cached article 404 against the published commit', async () => {
 const sha='c'.repeat(40);
 const client=createClient({repository:'example/comments',fetchImpl:async(url)=>{
  const target=new URL(url);
  if(target.hostname==='api.github.com')return jsonResponse({ref:'refs/heads/index',object:{type:'commit',sha}});
  return target.pathname.includes('/index/')?new Response(null,{status:404}):jsonResponse(article());
 }});
 assert.equal((await client.getComments(id)).status,'empty');
 assert.equal((await client.getComments(id,{force:true})).totalCount,1);
});

test('custom mirror force requests are unique and bypass browser cache without calling GitHub', async () => {
 const calls=[];
 const client=createClient({repository:'example/comments',indexBaseUrl:'https://mirror.example/comments/',fetchImpl:async(url,options)=>{calls.push({url,options});return jsonResponse(article());}});
 await client.getComments(id,{force:true});await client.getComments(id,{force:true});
 assert.ok(calls.every(call=>new URL(call.url).origin==='https://mirror.example'&&call.options.cache==='no-store'));
 assert.notEqual(calls[0].url,calls[1].url);
});

test('failed or malformed latest-ref reads cannot report a successful stale refresh', async () => {
 for(const response of [()=>new Response(null,{status:403}),()=>new Response(null,{status:404}),()=>jsonResponse({ref:'refs/heads/comments',object:{type:'commit',sha:'a'.repeat(40)}}),()=>jsonResponse({ref:'refs/heads/index',object:{type:'commit',sha:'invalid'}})]) {
  const client=createClient({repository:'example/comments',fetchImpl:async(url)=>new URL(url).hostname==='api.github.com'?response():jsonResponse(article())});
  await client.getComments(id);
  await assert.rejects(client.getComments(id,{force:true}));
  assert.equal((await client.getComments(id)).totalCount,1);
 }
});

test('force cancellation applies while resolving the current commit', async () => {
 const started=deferred(),response=deferred();let seenSignal;
 const client=createClient({repository:'example/comments',fetchImpl:async(url,options)=>{seenSignal=options.signal;started.resolve();return response.promise;}});
 const controller=new AbortController();const pending=client.getComments(id,{force:true,signal:controller.signal});
 await started.promise;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
 assert.equal(seenSignal.aborted,true);
 response.resolve(jsonResponse({ref:'refs/heads/index',object:{type:'commit',sha:'a'.repeat(40)}}));
 await turn();
});
