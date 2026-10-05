import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, API_VERSION } from '../../src/automation/github.mjs';

function client(fetchImpl) { return new GitHubClient({ repository: 'https://github.com/example/comments.git/', token: 'mock-secret', fetchImpl }); }
test('REST origin, API version, redirects and request/response are fixed', async () => {
  let captured;
  const c = client(async (url, options) => { captured = { url, options }; return Response.json({ id: 10 }); });
  assert.deepEqual(await c.request('POST', '/user/repos', { name: 'test' }), { id: 10 });
  assert.equal(c.owner, 'example'); assert.equal(c.repo, 'comments'); assert.equal(c.basePath, '/repos/example/comments');
  assert.equal(captured.url, 'https://api.github.com/user/repos');
  assert.equal(captured.options.headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.equal(API_VERSION, '2026-03-10');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.body, '{"name":"test"}');
  assert.ok(!JSON.stringify(c).includes('mock-secret'));
});
test('request rejects external origins, path tricks and unsupported methods before fetch', async () => {
  let calls = 0;
  const c = client(async () => { calls++; return Response.json({}); });
  for (const path of ['https://example.org', '//example.org', '/repos/x/../y', '/%2e%2e/user', '/x\\y', '/x#fragment', '/bad path', '/%5c%5cevil', '/%00evil']) {
    await assert.rejects(c.request('GET', path));
  }
  await assert.rejects(c.request('TRACE', '/user'));
  assert.equal(calls, 0);
});
test('errors carry HTTP status and never echo token/remote/transport messages', async () => {
  const c = client(async () => Response.json({ message: 'mock-secret' }, { status: 403 }));
  await assert.rejects(c.request('GET', '/user'), e => e.status === 403 && !e.message.includes('mock-secret'));
  const transport = client(async () => { throw new Error('mock-secret'); });
  await assert.rejects(transport.request('GET', '/user'), e => e.status === 0 && !e.message.includes('mock-secret'));
  assert.equal(await client(async () => new Response(null, { status: 204 })).request('DELETE', '/some/ref'), null);
});
test('readFile returns exact UTF8 and keeps 404 errors distinct from empty files', async () => {
  let target;
  const text = '\ufeff你好\r\n';
  const c = client(async url => { target = url; return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') }); });
  assert.equal(await c.readFile('config/settings.json', 'branch/with-slash'), text);
  assert.ok(target.endsWith('config/settings.json?ref=branch%2Fwith-slash'));
  await assert.rejects(client(async () => Response.json({}, { status: 404 })).readFile('missing.json', 'main'), e => e.status === 404);
  await assert.rejects(client(async () => Response.json({ type: 'symlink' })).readFile('bad.json', 'main'));
  await assert.rejects(c.readFile('../escape', 'main'));
});
