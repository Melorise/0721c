import test from 'node:test';
import assert from 'node:assert/strict';
import { assertArticleId, assertCommentId, buildCommentIssueUrl, parseIssueBody, normalizeRepository, validateSettings } from '../../src/core/index.mjs';
import { metadataLine, record } from './fixtures.mjs';
const id='article/essay/2026-09-28-hello';
test('comment ID combines readable article path, UTC timestamp and random suffix',()=>{
  assert.equal(assertArticleId(id),id); assert.equal(assertArticleId('文章/你好-世界'),'文章/你好-世界');
  assert.equal(assertCommentId(record().id),record().id);
  assert.equal(assertCommentId(record(2,{blog_id:'文章/你好-世界'}).id),record(2,{blog_id:'文章/你好-世界'}).id);
});
for (const id of ['', '/article/a','article/a/','a//b','a/../b','a/./b','.git/config','a/..','a/\\b','a/%2f/b','a?b','a#b','https://example/a','a\n','a/'.repeat(257)]) {
  test(`unsafe article path rejected: ${JSON.stringify(id)}`,()=>assert.throws(()=>assertArticleId(id)));
}
for(const id of ['0','01','-1','1.5',1,'20261005T000000Z-abc123','9007199254740992','article/a/20260230T000000000Z-abcdef123456','article/a/20261005T250000000Z-abcdef123456','article/a/20261005T000000000Z-abc'])test(`invalid comment ID: ${id}`,()=>assert.throws(()=>assertCommentId(id)));
test('prefilled form carries article and reply, no version/timestamp/hash boilerplate',()=>{
 const article={title:'标题 --> <script> & 0721c-meta',url:'https://blog.example/article/a'};
 const url=new URL(buildCommentIssueUrl({repository:'example/comments',articleId:id,replyTo:record(2).id,article}));
 assert.equal(url.pathname,'/example/comments/issues/new');
 assert.equal(url.searchParams.get('title'),'评论：'+article.title);
 const body=url.searchParams.get('body'); assert.equal((body.match(/-->/g)||[]).length,2);
 const parsed=parseIssueBody(body+'\n**正文**');
 assert.deepEqual(parsed,{metadata:{blog_id:id,reply_to:record(2).id},article,body_markdown:'**正文**'});
 assert.doesNotMatch(body,/"v":|nc-[a-f0-9]{64}|快照|隐私|密钥/);
});
test('English form and title-less form use readable label, no generated timestamp',()=>{
 const url=new URL(buildCommentIssueUrl({repository:'example/comments',articleId:id,locale:'en'}));
 assert.equal(url.searchParams.get('title'),'Comment：'+id);
 assert.deepEqual(parseIssueBody(url.searchParams.get('body')+'正文').metadata,{blog_id:id,reply_to:null});
});
test('CRLF, BOM and ordinary user HTML comments are preserved correctly',()=>{
 const text='<!-- regular comment -->\nhello';
 assert.equal(parseIssueBody('\ufeff'+metadataLine()+'\r\n'+text.replaceAll('\n','\r\n')).body_markdown,text);
});
for(const body of [null,'hello',metadataLine(),metadataLine()+'\n<!-- 0721c-instructions unclosed',metadataLine()+'\n<!-- 0721c-instructions -->\n<!-- 0721c-meta:{} -->'])test(`invalid template/body: ${JSON.stringify(body)}`,()=>assert.throws(()=>parseIssueBody(body)));
for(const json of ['{"blog_id":"a","blog_id":"b"}','{"blog_id":"a","\\u0062log_id":"b"}','{"blog_id":"a","token":"secret"}','{"blog_id":"a","reply_to":"0"}','{"blog_id":"a","article":{"title":"x","url":"javascript:alert(1)"}}'])test(`invalid metadata: ${json}`,()=>assert.throws(()=>parseIssueBody(`<!-- 0721c-meta:${json} -->\nbody`)));
test('body limits count Unicode and UTF8; literal protocol name is normal text',()=>{
 assert.equal(parseIssueBody(metadataLine()+'\n0721c-meta is documented here').body_markdown,'0721c-meta is documented here');
 assert.throws(()=>parseIssueBody(metadataLine()+'\n😀😀',{bodyCodepoints:1}),e=>e.code==='BODY_TOO_LARGE');
 assert.throws(()=>parseIssueBody(metadataLine()+'\n😀',{bodyBytes:3}),e=>e.code==='BODY_TOO_LARGE');
 assert.throws(()=>parseIssueBody(metadataLine()+'\n\ud800'));
});
test('repository input remains credential-free and independent of Git upload protocol',()=>{
 assert.equal(normalizeRepository('https://github.com/example/comments.git').rawBaseUrl,'https://raw.githubusercontent.com/example/comments/index');
 for(const input of ['git@github.com:example/comments','https://secret@github.com/example/comments','https://example.com/a/b','a/../b','a/b?token=x'])assert.throws(()=>normalizeRepository(input));
});
test('settings allow readable disabled URL paths and remain strict',()=>{
 assert.deepEqual(validateSettings({articlePolicy:{disabledIds:[id]}}).articlePolicy,{mode:'open',disabledIds:[id]});
 assert.throws(()=>validateSettings({articlePolicy:{disabledIds:['../a']}}));
 assert.throws(()=>validateSettings({token:'not-public'}));
});
