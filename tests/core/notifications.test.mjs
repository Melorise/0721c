import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings, buildCommentPermalink } from '../../src/core/index.mjs';
import { record } from './fixtures.mjs';

test('mail defaults are optional and disabled', () => {
  const settings = validateSettings();
  assert.deepEqual(settings.site, { url: '', name: '' });
  assert.deepEqual(settings.notifications, { enabled: false, from: '', notifyOwner: true, notifyReplies: true });
});
test('enabled mail requires site and sender, and accepts display-name mailbox', () => {
  assert.throws(() => validateSettings({ notifications: { enabled: true } }), /site.url/);
  assert.throws(() => validateSettings({ site: { url: 'https://blog.example' }, notifications: { enabled: true } }), /notifications.from/);
  assert.equal(validateSettings({ site: { url: 'https://blog.example/' }, notifications: { enabled: true, from: '博客 <comments@example.com>' } }).site.url, 'https://blog.example');
});
for (const value of [
 { site: { url: 'https://user:pass@blog.example' } }, { site: { url: 'https://blog.example?a=1' } },
  { site: { url: 'https://blog.example/#comment' } }, { notifications: { enabled: 'true' } }, { notifications: { from: 'not-email' } },
  { notifications: { from: 'a@example.com\r\nBcc: b@example.com' } }, { notifications: { token: 'secret' } }, { site: { unknown: 1 } },
]) test('invalid mail settings: ' + JSON.stringify(value), () => assert.throws(() => validateSettings(value)));
test('comment links preserve readable identities and encode query values', () => {
  const url = new URL(buildCommentPermalink('https://blog.example/article?lang=zh#old', record().id));
  assert.equal(url.searchParams.get('comment'), record().id); assert.equal(url.searchParams.get('lang'), 'zh'); assert.equal(url.hash, '');
  assert.throws(() => buildCommentPermalink('https://evil@example.com', record().id));
  assert.throws(() => buildCommentPermalink('javascript:alert(1)', record().id));
});


test('site URLs and permalinks support local HTTP testing', () => {
  assert.equal(validateSettings({ site: { url: 'http://localhost:3000/' } }).site.url, 'http://localhost:3000');
  const url = new URL(buildCommentPermalink('http://localhost:3000/article', record().id));
  assert.equal(url.origin, 'http://localhost:3000');
});
