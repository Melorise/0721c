import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexes } from '../../src/automation/build-index.mjs';
import { record } from '../core/fixtures.mjs';
import { ARTICLE } from './mock-github.mjs';

test('direct indexes contain only article data, configured empties and disabled policy entries', () => {
  const result = buildIndexes({ records: [record()], settings: { articlePolicy: { disabledIds: ['article/disabled'] } },
    articles: { 'article/empty': { enabled: true }, [ARTICLE]: { enabled: false } } });
  assert.deepEqual(Object.keys(result), ['indexes']);
  assert.deepEqual(Object.keys(result.indexes[ARTICLE]).sort(), ['blog_id', 'comments', 'comments_enabled', 'root_count', 'total_count']);
  assert.equal(result.indexes[ARTICLE].comments_enabled, false);
  assert.equal(result.indexes['article/empty'].total_count, 0);
  assert.equal(result.indexes['article/empty'].comments_enabled, true);
  assert.equal(result.indexes['article/disabled'].comments_enabled, false);
  assert.equal(result.indexes['article/disabled'].total_count, 0);
  assert.equal(Object.keys(buildIndexes({ records: [], settings: {} }).indexes).length, 0);
});
test('allowlist policy and full paths preserve separate articles with the same last segment', () => {
  const result = buildIndexes({ records: [record(), record(2, { blog_id: 'notes/essay/2026-09-28-hello' })],
    settings: { articlePolicy: { mode: 'allowlist' } }, articles: { [ARTICLE]: { enabled: true } } });
  assert.equal(result.indexes[ARTICLE].comments_enabled, true);
  assert.equal(result.indexes['notes/essay/2026-09-28-hello'].comments_enabled, false);
  assert.equal(result.indexes[ARTICLE].total_count, 1);
});
test('readable timestamp/random IDs, root/reply counts and core sorting are preserved', () => {
  const result = buildIndexes({ records: [record(10), record(2), record(11, { reply_to: record(10).id })], settings: {} }).indexes[ARTICLE];
  assert.equal(result.total_count, 3); assert.equal(result.root_count, 2);
  assert.deepEqual(result.comments.map(n => n.id), [2, 10].map(n => record(n).id));
  assert.equal(result.comments[1].children[0].id, record(11).id);
  assert.deepEqual(Object.keys(result.comments[0]).sort(), ['author', 'body_markdown', 'children', 'created_at', 'id', 'reply_to']);
});
test('duplicate IDs, cross-article replies, orphan parents, cycles and depth fail the whole snapshot', () => {
  const invalid = [
    [record(), record()],
    [record(), record(2, { blog_id: 'other/path', reply_to: record(1).id })],
    [record(2, { reply_to: record(1).id })],
    [record(1, { reply_to: record(2).id }), record(2, { reply_to: record(1).id })],
  ];
  for (const records of invalid) assert.throws(() => buildIndexes({ records, settings: {} }));
  assert.throws(() => buildIndexes({ records: [record(), record(2, { reply_to: record(1).id })], settings: { limits: { maxReplyDepth: 0 } } }));
});
test('configured body limits and malformed article policy/configuration fail closed', () => {
  for (const settings of [{ limits: { bodyCodepoints: 1 } }, { limits: { bodyBytes: 2 } }, { articlePolicy: { mode: 'bad' } }]) {
    assert.throws(() => buildIndexes({ records: [record()], settings }));
  }
  for (const articles of [{ '../bad': { enabled: true } }, { [ARTICLE]: { enabled: 'yes' } }, { [ARTICLE]: { enabled: true, url: 'javascript:bad' } }]) {
    assert.throws(() => buildIndexes({ records: [], settings: {}, articles }));
  }
});
