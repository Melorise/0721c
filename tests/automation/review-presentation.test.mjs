import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPullRequest } from '../../src/automation/review-presentation.mjs';
import { record } from '../core/fixtures.mjs';

test('readable PR uses article title/link, author, whole body and matching approved reply context', () => {
  const parent = record(1, { body_markdown: 'Parent **Markdown**\nLast parent line' });
  const body = '正文 😀'.repeat(1500) + '\nFinal line';
  const comment = record(2, { reply_to: record(1).id, body_markdown: body, article: { title: 'Title [with] punctuation', url: 'https://blog.example/article' } });
  const result = buildReviewPullRequest(comment, { parent });
  assert.equal(result.title, '评论：《Title [with] punctuation》');
  assert.ok(result.body.includes('https://blog.example/article'));
  assert.match(result.body, /@user\\-2/); assert.match(result.body, /回复的评论/); assert.match(result.body, /> Last parent line/);
  assert.ok(result.body.includes('正文 😀'.repeat(1500))); assert.match(result.body, /> Final line/);
  assert.doesNotMatch(result.body, /\/issues\/|Source Issue|来源：|sha256|deployment_id/);
});
test('configured article context wins; absent context uses the readable full path', () => {
  const comment = record(1, { article: { title: 'Submitted' } });
  const configured = buildReviewPullRequest(comment, { articles: { [comment.blog_id]: { enabled: true, title: 'Configured', url: 'https://blog.example/' } } });
  assert.match(configured.title, /Configured/); assert.match(configured.body, /https:\/\/blog\.example\//);
  const plain = buildReviewPullRequest(record()); assert.ok(plain.title.includes(comment.blog_id));
});
test('only the PR title is shortened; parent identity and article must match', () => {
  const result = buildReviewPullRequest(record(1, { article: { title: '长'.repeat(512) }, body_markdown: 'Body end' }));
  assert.equal(Array.from(result.title).length, 256); assert.ok(result.body.includes('长'.repeat(512)));
  const child = record(2, { reply_to: record(1).id });
  for (const parent of [undefined, record(3), record(1, { blog_id: 'other/path' })]) assert.throws(() => buildReviewPullRequest(child, { parent }), /parent/);
});
