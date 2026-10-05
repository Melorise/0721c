import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMessages, mergeMessages, formatMessage } from '../../src/vue/messages.mjs';

test('both default locales have matching keys and no trailing full stops', () => {
  const chinese = resolveMessages('zh-CN');
  const english = resolveMessages('en');
  assert.deepEqual(Object.keys(chinese), Object.keys(english));
  for (const text of [...Object.values(chinese), ...Object.values(english)]) assert.doesNotMatch(text, /[。.]$/);
  assert.deepEqual(resolveMessages('unknown'), chinese);
});

test('partial string overrides preserve defaults, empty strings and inheritance', () => {
  assert.equal(resolveMessages('en', { error: 'Network hint' }).empty, 'No comments yet');
  assert.deepEqual(mergeMessages({error:'parent', empty:'parent empty'}, {error:undefined, empty:''}), {empty:'', error:'parent'});
  assert.equal(resolveMessages('en', { error: undefined }).error, 'Unable to load comments. Please retry');
});

test('message placeholders interpolate once, preserving literal user content', () => {
  assert.equal(formatMessage('{count} / {count}', {count: 20}), '20 / 20');
  assert.equal(formatMessage('回复 {login}', {login:'name{count}<b>'}), '回复 name{count}<b>');
  assert.equal(formatMessage('{count} {unknown}', {}), '{count} {unknown}');
});
