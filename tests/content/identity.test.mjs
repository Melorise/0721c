import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContentArticle,normalizeContentOptions } from '../../src/content/index.mjs';
const document={id:'article/article/essay/2026-09-28-hello.md',stem:'article/essay/2026-09-28-hello',path:'/article/essay/2026-09-28-hello',title:'标题'};
test('real Markdown route is literal ID, never generated Content ID hash',()=>{
 assert.deepEqual(resolveContentArticle(document),{articleId:'article/essay/2026-09-28-hello',identity:'path'});
 assert.deepEqual(resolveContentArticle({...document,id:'renamed-source',title:'new title'}),resolveContentArticle(document));
 assert.equal(resolveContentArticle({...document,path:'/article/new'}).articleId,'article/new');
});
test('full paths distinguish equal last slugs and stem is readable fallback',()=>{
 assert.notEqual(resolveContentArticle({path:'/a/post'}).articleId,resolveContentArticle({path:'/b/post'}).articleId);
 assert.deepEqual(resolveContentArticle({stem:'article/a'}),{articleId:'article/a',identity:'stem'});
 assert.throws(()=>resolveContentArticle({id:'generated.md'}));
});
test('unicode URL segments decode into human-readable folder names',()=>{
 assert.equal(resolveContentArticle({path:'/article/%E4%BD%A0%E5%A5%BD'}).articleId,'article/你好');
 assert.equal(resolveContentArticle({path:'/article/你好/'}).articleId,'article/你好');
});
test('explicit readable override is optional, validated and stable',()=>{
 assert.equal(resolveContentArticle({...document,commentId:'posts/fixed'}).articleId,'posts/fixed');
 assert.equal(resolveContentArticle({...document,meta:{commentId:'posts/meta'}}).articleId,'posts/meta');
});
test('selection excludes ordinary pages and explicit opt-out before network',()=>{
 assert.equal(resolveContentArticle({...document,path:'/about'},{pathPrefixes:['/article']}),null);
 assert.equal(resolveContentArticle({...document,path:'/articles/a'},{pathPrefixes:['/article']}),null);
 assert.equal(resolveContentArticle({...document,comments:false}),null);
 assert.equal(resolveContentArticle({...document,meta:{comments:false}}),null);
 assert.equal(resolveContentArticle({...document,extension:'yml'}),null);
 assert.ok(resolveContentArticle({...document,extension:'yml'},{markdownOnly:false}));
 assert.equal(resolveContentArticle(null),null);
 assert.deepEqual(normalizeContentOptions({pathPrefixes:['/article/','/article']}).pathPrefixes,['/article']);
});
for(const path of ['/a/../b','/a/./b','/a/%2f/b','/a/%2e%2e/b','/a/%252e%252e/b','//a','/a//b','/a?b','/a#b','/a\\b','/a/%zz','/a/.git/config'])test(`unsafe Content route rejected: ${path}`,()=>assert.throws(()=>resolveContentArticle({path})));
for(const value of [[],{}, {path:23},{path:'/a',comments:'false'},{path:'/a',commentId:'../b'}])test(`invalid document: ${JSON.stringify(value)}`,()=>assert.throws(()=>resolveContentArticle(value)));
for(const value of [null,[],{pathPrefixes:'article'},{pathPrefixes:['relative']},{pathPrefixes:['/a?b']},{markdownOnly:'true'}])test(`invalid selection: ${JSON.stringify(value)}`,()=>assert.throws(()=>normalizeContentOptions(value)));
