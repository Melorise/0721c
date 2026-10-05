import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommentRecord,validateArticleIndex,buildCommentTree } from '../../src/core/index.mjs';
import { record,article } from './fixtures.mjs';
test('record stores only useful data and preserves optional article context',()=>{
 const r=record(1,{article:{title:'标题',url:'https://blog.example/a'}});
 assert.deepEqual(validateCommentRecord(r),r);
 for(const extra of [{source:{}},{schema_version:1},{author:{id:1,login:'user'}},{id:'0'},{blog_id:'../a'},{article:{title:'',url:'https://blog.example'}}])assert.throws(()=>validateCommentRecord({...r,...extra}));
});
test('tree is chronological, ties sort by numeric Issue number; nested replies are complete',()=>{
 const tree=buildCommentTree([record(10),record(3,{reply_to:record(2).id}),record(2),record(1)]);
 assert.deepEqual(tree.comments.map(x=>x.id),[1,2,10].map(n=>record(n).id));assert.equal(tree.comments[1].children[0].id,record(3).id);
 assert.equal(tree.total_count,4);assert.equal(tree.root_count,3);assert.equal(tree.comments[0].issue_number,undefined);
 assert.deepEqual(validateArticleIndex({blog_id:record().blog_id,comments_enabled:true,...tree}),{blog_id:record().blog_id,comments_enabled:true,...tree});
});
for(const [name,items,code] of [
 ['duplicate',[record(1),record(1)],'DUPLICATE_ID'],['missing parent',[record(2,{reply_to:record(1).id})],'MISSING_PARENT'],
 ['self',[record(1,{reply_to:record(1).id})],'CYCLE'],['cycle',[record(1,{reply_to:record(2).id}),record(2,{reply_to:record(1).id})],'CYCLE'],
 ['other article',[record(1),record(2,{blog_id:'article/other'})],'CROSS_ARTICLE']
])test(`tree rejects ${name}`,()=>assert.throws(()=>buildCommentTree(items),e=>e.code===code));
test('reply depth bounded without recursive call stack traversal',()=>{
 const items=Array.from({length:65},(_,i)=>record(i+1,{reply_to:i?record(i).id:null}));
 assert.equal(buildCommentTree(items).total_count,65);
 assert.throws(()=>buildCommentTree([...items,record(66,{reply_to:record(65).id})]),e=>e.code==='MAX_REPLY_DEPTH');
 assert.throws(()=>buildCommentTree(items,{maxReplyDepth:2}));
});
test('malformed indexes fail, rather than rendering partial or misleading data',()=>{
 const input=article();
 for(const extra of [{total_count:99},{root_count:99},{comments_enabled:'true'},{blog_id:'/a'},{manifest:{}},{comments:[{...input.comments[0],reply_to:record(2).id}]},{comments:[{...input.comments[0],source:{}}]}])assert.throws(()=>validateArticleIndex({...input,...extra}));
 const cyclic=structuredClone(input);cyclic.comments[0].children.push(cyclic.comments[0]);assert.throws(()=>validateArticleIndex(cyclic));
 const unordered=article([record(2),record(10)]);unordered.comments.reverse();assert.throws(()=>validateArticleIndex(unordered));
});
test('disabled and empty indexes are first-class readable files',()=>{
 assert.deepEqual(validateArticleIndex(article([],{comments_enabled:false})),article([],{comments_enabled:false}));
});


test('record and index IDs must match their article; creation time is independent', () => {
 const original=record();
 assert.throws(()=>validateCommentRecord({...original,blog_id:'other/article'}));
 assert.equal(validateCommentRecord({...original,created_at:'2026-10-05T09:12:31Z'}).id, original.id);
 assert.throws(()=>validateArticleIndex({...article(),blog_id:'other/article'}));
 const data=article(); data.comments[0].created_at='2026-10-05T09:12:31Z';
 assert.equal(validateArticleIndex(data).comments[0].id, original.id);
});
