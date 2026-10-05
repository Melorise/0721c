import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublication } from '../../src/automation/publish-index.mjs';
import { runIntake } from '../../src/automation/intake-comment.mjs';
import { buildNotificationEmail } from '../../src/automation/notify-comment.mjs';
import { GitHubAPIError } from '../../src/automation/github.mjs';
import { MockGitHub, intakeOptions, issue, issueBody } from './mock-github.mjs';
import { record } from '../core/fixtures.mjs';

const settings = { site: { url: 'https://blog.example', name: 'My blog' }, notifications: { enabled: true, from: 'Blog <comments@example.com>' } };
const env = { RESEND_API_KEY: 'test-private-key', COMMENTS_OWNER_EMAIL: 'private-owner@example.com' };
async function fixture({ reply = false, email = 'alice@example.com', ...options } = {}) {
  const parent = record(1);
  const mock = new MockGitHub({ settings, records: reply ? [parent] : [], ...options });
  mock.users.set(parent.author.login, { login: parent.author.login, email });
  const input = issue({ number: reply ? 2 : 1, user: { login: 'bob', avatar_url: 'https://avatars.githubusercontent.com/u/33' }, body: issueBody({ replyTo: reply ? parent.id : null, article: { title: 'Article title', url: 'https://blog.example/' + parent.blog_id } }) });
  const intake = await runIntake(intakeOptions(mock, input));
  const pr = mock.closePR(intake.pr.number, true);
  const calls = [], delivered = new Map();
  let sendStatus = 200;
  const fetchImpl = async (url, init) => {
    assert.equal(mock.refs.get('heads/index') === mock.indexSha, false, 'index must publish before mail');
    calls.push({ url, init });
    assert.equal(url, 'https://api.resend.com/emails');
    if (sendStatus !== 200) return new Response('remote error containing private-owner@example.com', { status: sendStatus });
    const key = init.headers['Idempotency-Key'];
    const previous = delivered.get(key);
    if (previous) assert.equal(previous.body, init.body, 'same idempotency key must use identical content');
    else delivered.set(key, { body: init.body, id: 'email-' + delivered.size });
    return new Response(JSON.stringify({ id: delivered.get(key).id }));
  };
  const optionsRun = { client: mock.client, eventName: 'pull_request_target', event: { action: 'closed', pull_request: pr }, env, fetchImpl };
  return { mock, parent, calls, delivered, run: overrides => runPublication({ ...optionsRun, ...overrides }), setSendStatus: value => { sendStatus = value; } };
}
const requests = f => f.calls.filter(c => c.url === 'https://api.resend.com/emails');

test('merged root PR publishes then sends owner mail with a comment permalink', async () => {
  const f = await fixture();
  assert.equal((await f.run()).notification.status, 'sent');
  const mail = JSON.parse(requests(f)[0].init.body);
  assert.deepEqual(mail.to, [env.COMMENTS_OWNER_EMAIL]);
  assert.match(mail.text, /Article title/); assert.match(mail.text, /@bob/);
  const destination = new URL(mail.text.split('查看评论: ')[1]);
  assert.equal(destination.origin, 'https://blog.example');
  assert.ok(destination.searchParams.get('comment').startsWith(record().blog_id + '/'));
  assert.equal(requests(f)[0].init.redirect, 'error');
  assert.equal(f.mock.calls.some(c => c.method === 'POST' && /labels|comments$/.test(c.path)), false);
});

test('replaying the same merged PR uses the same Resend key without storing delivery state', async () => {
  const f = await fixture();
  assert.equal((await f.run()).notification.status, 'sent');
  assert.equal((await f.run()).notification.status, 'sent');
  assert.equal(requests(f).length, 2);
  assert.equal(f.delivered.size, 1);
  assert.equal(requests(f)[0].init.headers['Idempotency-Key'], requests(f)[1].init.headers['Idempotency-Key']);
});

test('reply mail goes only to the immediate parent public email', async () => {
  const f = await fixture({ reply: true });
  assert.equal((await f.run()).notification.status, 'sent');
  const payload = JSON.parse(requests(f)[0].init.body);
  assert.deepEqual(payload.to, ['alice@example.com']);
  assert.match(payload.text, new RegExp(f.parent.body_markdown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(f.mock.calls.filter(c => c.path.startsWith('/users/')).length, 1);
});

for (const [name, options, reason] of [
  ['missing public email', { reply: true, email: null }, 'no-public-email'],
  ['owner notifications disabled', { settings: { ...settings, notifications: { ...settings.notifications, notifyOwner: false } } }, 'recipient-disabled'],
  ['reply notifications disabled', { reply: true, settings: { ...settings, notifications: { ...settings.notifications, notifyReplies: false } } }, 'recipient-disabled'],
]) test(name + ' is skipped', async () => {
  const f = await fixture(options);
  assert.deepEqual((await f.run()).notification, { status: 'skipped', reason });
  assert.deepEqual((await f.run()).notification, { status: 'skipped', reason });
  assert.equal(requests(f).length, 0);
});

test('self-reply is skipped', async () => {
  const parent = record(1, { author: { login: 'bob' } });
  const f = await fixture({ reply: true, records: [parent] });
  assert.equal((await f.run()).notification.reason, 'self-reply');
  assert.equal(f.calls.length, 0);
});

test('non-PR publication triggers never send, and disabled settings never read mail data', async () => {
  const f = await fixture();
  for (const [eventName, event] of [['push', { ref: 'refs/heads/comments' }], ['push', { ref: 'refs/heads/main' }], ['schedule', {}], ['workflow_dispatch', {}]]) {
    assert.equal((await f.run({ eventName, event })).notification, undefined);
  }
  const disabled = await fixture({ settings: {} });
  assert.equal((await disabled.run()).notification, undefined);
  assert.equal(f.calls.length + disabled.calls.length, 0);
});

for (const [secrets, code] of [[{}, 'RESEND_API_KEY_MISSING'], [{ RESEND_API_KEY: 'test' }, 'COMMENTS_OWNER_EMAIL_MISSING']]) test(code + ' does not fail index publication', async () => {
  const f = await fixture();
  const result = await f.run({ env: secrets });
  assert.equal(result.status, 'published');
  assert.deepEqual(result.notification, { status: 'failed', code });
  assert.equal(requests(f).length, 0);
});

test('Resend failure is reported without blocking index publication', async () => {
  const f = await fixture(); f.setSendStatus(429);
  assert.deepEqual((await f.run()).notification, { status: 'failed', code: 'RESEND_HTTP_429' });
  assert.equal(requests(f).length, 1);
});

test('an index publication failure cannot trigger mail', async () => {
  const f = await fixture();
  f.mock.fault(c => c.method === 'PATCH' && c.path === '/git/refs/heads/index');
  await assert.rejects(f.run());
  assert.equal(f.calls.length, 0);
});

test('email HTML escapes comment, author and title and uses a same-site permalink', () => {
  const payload = buildNotificationEmail({ record: record(1, { body_markdown: '<script>alert(1)</script>' }), article: { title: '<img src=x>', url: 'https://blog.example/post' }, site: { name: '<Blog>', url: 'https://blog.example' }, from: 'a@example.com', to: 'b@example.com', locale: 'en' });
  assert.doesNotMatch(payload.html, /<script>|<img/);
  assert.match(payload.html, /&lt;script&gt;/);
  assert.match(payload.text, /<script>/);
});

test('merged PR without merge_commit_sha reads its reviewed blob and sends a root notification', async () => {
  const f = await fixture();
  assert.equal(Object.hasOwn(f.mock.pulls[0], 'merge_commit_sha'), false);
  f.mock.client.readFile = async () => { throw new Error('Comments must be read by reviewed blob, not merge commit'); };
  // Configuration remains read through the original main snapshot; intercept comments only.
  const configRead = async (path, sha) => {
    const file = await f.mock.client.request('GET', `${f.mock.client.basePath}/contents/${path}?ref=${sha}`);
    return Buffer.from(file.content, 'base64').toString('utf8');
  };
  f.mock.client.readFile = async (path, sha) => {
    assert.ok(path.startsWith('config/'));
    return configRead(path, sha);
  };
  assert.equal((await f.run()).notification.status, 'sent');
  const files = f.mock.pulls[0].reviewFiles;
  assert.ok(f.mock.calls.some(c => c.method === 'GET' && c.path === '/git/blobs/' + files[0].sha));
});

test('GitHub request errors identify status and operation without exposing response or credentials', async () => {
  const f = await fixture();
  const request = f.mock.client.request;
  f.mock.client.request = async (method, path, body) => {
    if (method === 'GET' && /\/pulls\/\d+\/files\?/.test(path)) {
      throw new GitHubAPIError(403, method, path);
    }
    return request(method, path, body);
  };
  const result = await f.run();
  assert.equal(result.status, 'published');
  assert.equal(result.notification.code, 'GITHUB_HTTP_403');
  assert.equal(result.notification.operation, `GET ${f.mock.client.basePath}/pulls/${f.mock.pulls[0].number}/files`);
  assert.doesNotMatch(JSON.stringify(result.notification), /test-private-key|private-owner@example.com/);
});


test('mail sending does not contact the website and links use the configured local site', async () => {
  const f = await fixture({ settings: { ...settings, site: { url: 'http://localhost:3000', name: 'Local blog' } } });
  assert.equal((await f.run()).notification.status, 'sent');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.resend.com/emails');
  const mail = JSON.parse(f.calls[0].init.body);
  const link = new URL(mail.text.split('查看评论: ')[1]);
  assert.equal(link.origin, 'http://localhost:3000');
  assert.equal(link.pathname, '/' + record().blog_id);
});
