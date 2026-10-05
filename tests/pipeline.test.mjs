import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommentIssueUrl,parseIssueBody,createClient,validateSettings } from '../src/core/index.mjs';
import { buildIndexes } from '../src/automation/build-index.mjs';
const articleId='article/essay/2026-09-28-hello';
function record(number=1,replyTo=null,body='第一条 **评论**') {
 const url=new URL(buildCommentIssueUrl({repository:'example/comments',articleId,replyTo,article:{title:'文章标题',url:'https://blog.example/'+articleId}}));
 const parsed=parseIssueBody(url.searchParams.get('body')+body);
 return {id:`${articleId}/comments-${number}`,blog_id:parsed.metadata.blog_id,reply_to:parsed.metadata.reply_to,
 author:{login:'example-user'},created_at:'2026-10-05T02:00:00Z',body_markdown:parsed.body_markdown,article:parsed.article};
}
function snapshot(records,settings=validateSettings()) {return buildIndexes({records,settings});}
function transport(output,repository='example/comments') {
 const calls=[];return {calls,fetchImpl:async(url,options)=>{
 calls.push(String(url));assert.equal(options.credentials,'omit');
 if(new URL(url).hostname==='api.github.com')return Response.json({ref:'refs/heads/index',object:{type:'commit',sha:'a'.repeat(40)}});
 const path=new URL(url).pathname;const revision=path.split('/')[3];const base='/'+repository+'/'+revision+'/';assert.ok(path.startsWith(base));
 const id=decodeURI(path.slice(base.length,-5));const value=output.indexes[id];
 return value?Response.json(value):new Response(null,{status:404});
 }};
}
test('prefilled Issue → readable record file data → direct index → reply form → nested refresh',async()=>{
 const first=record();const output=snapshot([first]);const mock=transport(output);
 const client=createClient({repository:'example/comments',fetchImpl:mock.fetchImpl});const result=await client.getComments(articleId);
 assert.equal(result.totalCount,1);assert.equal(result.comments[0].id,first.id);assert.equal(result.comments[0].body_markdown,'第一条 **评论**');assert.equal(mock.calls.length,1);
 await client.getComments(articleId);assert.equal(mock.calls.length,1);
 const replyUrl=new URL(client.getNewIssueUrl({articleId,replyTo:result.comments[0].id}));
 assert.equal(parseIssueBody(replyUrl.searchParams.get('body')+'回复').metadata.reply_to,first.id);
 output.indexes=snapshot([record(2,first.id,'回复正文'),first]).indexes;
 const next=await client.getComments(articleId,{force:true});assert.equal(next.totalCount,2);assert.equal(next.rootCount,1);assert.equal(next.comments[0].children[0].body_markdown,'回复正文');
 assert.equal(mock.calls.length,3);assert.ok(mock.calls.every(url=>!url.includes('manifest')));
});
test('disabled articles retain approved history without offering submissions',async()=>{
 const output=snapshot([record()],validateSettings({articlePolicy:{disabledIds:[articleId]}}));const mock=transport(output);
 const result=await createClient({repository:'example/comments',fetchImpl:mock.fetchImpl}).getComments(articleId);
 assert.equal(result.status,'disabled');assert.equal(result.totalCount,1);assert.equal(result.commentsEnabled,false);
});
test('deleting readable article record group removes its rebuilt file without a registry lookup',async()=>{
 const output=snapshot([record()]);const mock=transport(output);const client=createClient({repository:'example/comments',fetchImpl:mock.fetchImpl});
 assert.equal((await client.getComments(articleId)).totalCount,1);output.indexes=snapshot([]).indexes;
 assert.equal(Object.hasOwn(output.indexes,articleId),false);assert.equal((await client.getComments(articleId,{force:true})).status,'empty');
});
test('independent clients never share cache even for identical readable path',async()=>{
 const a=transport(snapshot([record(1,null,'实例一')]));const b=transport(snapshot([record(1,null,'实例二')]),'another/comments');
 const one=createClient({repository:'example/comments',fetchImpl:a.fetchImpl});const two=createClient({repository:'another/comments',fetchImpl:b.fetchImpl});
 assert.equal((await one.getComments(articleId)).comments[0].body_markdown,'实例一');assert.equal((await two.getComments(articleId)).comments[0].body_markdown,'实例二');
});
