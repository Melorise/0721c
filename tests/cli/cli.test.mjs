import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import * as cli from '../../src/cli/index.mjs';
import { publicContext } from '../../src/cli/public-context.mjs';
import { normalizeCLIRepository, resolveRepository } from '../../src/cli/repository.mjs';
import { PACKAGE_ROOT, loadAssets } from '../../src/cli/assets.mjs';
import { json } from '../../src/cli/model.mjs';
import { record, article } from '../core/fixtures.mjs';
import { MockGitHub } from './mock-github.mjs';
import { target, git, mkdir, join } from './fixtures.mjs';

async function healthy() {
  const assets = await loadAssets(); const client = new MockGitHub();
  client.set('main', assets.main); client.set('comments', assets.comments); client.set('index', assets.index);
  return { assets, client, options: { repository: 'owner/comments', githubClient: client } };
}
const noWrites = client => assert.ok(client.calls.every(call => call.method === 'GET' && !/\/actions\/|\/secrets|\/permissions/.test(call.path)));

test('CLI help/version and exports contain no remote management or deployment identity', async () => {
  assert.equal('configure' in cli, false); assert.equal('resolveToken' in cli, false);
  for (const path of ['configure.mjs', 'configure.d.ts', 'context.mjs']) await assert.rejects(access(join(PACKAGE_ROOT, 'src/cli', path)), { code: 'ENOENT' });
  const output = []; const errors = [];
  const dependencies = { write: text => output.push(text), writeError: text => errors.push(text), fetchImpl() { throw Error('No network'); }, execFileImpl() { throw Error('No subprocess'); } };
  assert.equal(await cli.runCLI(['--help'], dependencies), 0);
  assert.equal(await cli.runCLI(['--version'], dependencies), 0);
  assert.equal(await cli.runCLI(['doctor', '--repository', 'owner/comments', '--json'], { ...dependencies, githubClient: (await healthy()).client }), 0);
  assert.equal(output[1], '0.2.5'); assert.match(output[0], /公开仓库/); assert.equal(errors.length, 0);
  assert.equal(JSON.parse(output[2]).ok, true);
});

test('arguments select offline init, installed-file upgrade and anonymous diagnostics', () => {
  assert.deepEqual(cli.parseArgs(['init', 'path with spaces', '--locale', 'en']).options, { directory: 'path with spaces', locale: 'en' });
  assert.deepEqual(cli.parseArgs(['init', '--', '--literal-path']).options, { directory: '--literal-path' });
  assert.deepEqual(cli.parseArgs(['upgrade', '--directory=local', '--apply']).options, { directory: 'local', apply: true });
  assert.deepEqual(cli.parseArgs(['doctor', '--repository', 'owner/comments']).options, { repository: 'owner/comments' });
  for (const args of [['configure'], ['init', '--create'], ['init', '--repository', 'owner/comments'], ['init', '--version', '0.2.5'], ['doctor', '--token', 'test'], ['upgrade', '--to', '0.1.3'], ['upgrade', '--repository', 'owner/comments'], ['upgrade', '--apply', '--dry-run'], ['init', 'a', '--directory', 'b'], ['init', '--dry-run=true'], ['init', '--locale', 'unknown']]) assert.throws(() => cli.parseArgs(args));
});

test('doctor accepts README-only data branches and ignores private permission fields', async () => {
  const { client, options } = await healthy();
  client.repo.permissions = new Proxy({}, { get() { throw Error('Private permissions must not be interpreted'); } });
  const report = await cli.doctor(options);
  assert.equal(report.ok, true); assert.equal(report.status, 'healthy');
  for (const name of ['ready', 'deploymentId', 'version', 'drift']) assert.equal(name in report, false);
  assert.ok(!report.checks.some(check => /manifest|hash|ready|inventory/.test(check.code)));
  noWrites(client);
});

test('doctor validates nested paths, timestamp/random comment IDs and direct article trees', async () => {
  const { client, options } = await healthy(); const parent = record(); const reply = record(2, { reply_to: record(1).id });
  client.set('comments', { 'README.md': 'Approved', [`${parent.id}.json`]: json(parent), [`${reply.id}.json`]: json(reply) });
  client.set('index', { [`${parent.blog_id}.json`]: json(article([parent, reply])) });
  const report = await cli.doctor(options);
  assert.equal(report.ok, true, JSON.stringify(report)); noWrites(client);
});

test('doctor checks file presence without comparing contents against the installed release', async () => {
  const { client, options } = await healthy();
  client.branches.get('main')['README.md'] = 'Public custom README\n';
  client.branches.get('main')['.0721c/runtime/core/client.mjs'] = '// Different installed working content\n';
  delete client.branches.get('main')['config/articles.json'];
  assert.equal((await cli.doctor(options)).ok, true); noWrites(client);
});

test('doctor reports malformed settings, articles, record/index JSON and mismatched file paths', async () => {
  const cases = [
    ['main', 'config/settings.json', '{'],
    ['main', 'config/articles.json', json({ schema_version: 1, articles: { '../bad': { enabled: true } } })],
    ['comments', 'article/essay/slug/1.json', '{'],
    ['comments', 'article/essay/slug/1.json', json(record(1))],
    ['comments', `${record().id}.json`, json({ ...record(), author: { id: 3, login: 'user' } })],
    ['index', `${record().blog_id}.json`, json({ ...article(), total_count: 9 })],
    ['index', 'article/essay/other.json', json(article())],
    ['index', `${record().blog_id}.json`, json({ ...article(), source_main_commit: 'obsolete' })],
    ['comments', 'arbitrary.mjs', 'export const unsafe = true;']
  ];
  for (const [branch, path, text] of cases) {
    const { client, options } = await healthy(); client.branches.get(branch)[path] = text;
    const report = await cli.doctor(options);
    assert.equal(report.ok, false, `${branch}:${path}`);
    assert.ok(report.checks.some(check => check.ok === false)); noWrites(client);
  }
});

test('doctor reports absent repository/branches/runtime and HTTP failures without repairing anything', async () => {
  for (const damage of [client => { client.repo = null; }, client => client.branches.delete('comments'), client => client.branches.delete('index'), client => { delete client.branches.get('main')['.0721c/runtime/core/index.mjs']; }, client => client.blocked.set('/repos/owner/comments', 403), client => { client.truncated = true; }]) {
    const { client, options } = await healthy(); damage(client);
    const before = JSON.stringify([...client.branches]);
    assert.equal((await cli.doctor(options)).ok, false);
    assert.equal(JSON.stringify([...client.branches]), before); noWrites(client);
  }
});

test('public fetch sends fixed-origin GET without credentials, authorization, cookies or redirects', async () => {
  const { client } = await healthy(); let count = 0;
  const report = await cli.doctor({ repository: 'owner/comments', async fetchImpl(url, options) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com'); assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(new Headers(options.headers).has('Authorization'), false); assert.equal(new Headers(options.headers).has('Cookie'), false);
    count++;
    return new Response(JSON.stringify(await client.request('GET', parsed.pathname + parsed.search)), { status: 200 });
  } });
  assert.equal(report.ok, true); assert.ok(count > 10); noWrites(client);
});

test('diagnostic store refuses mutations, traversal, other repositories and private settings', async () => {
  let count = 0;
  const { store } = await publicContext({ repository: 'owner/comments', githubClient: { request() { count++; throw Error('Must not execute'); } } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) assert.throws(() => store.request(method, '/repos/owner/comments'));
  assert.throws(() => store.request('GET', '/repos/owner/comments', {}));
  for (const path of ['https://evil.example/a', '/user', '/repos/other/repo', '/repos/owner/comments/../settings', '/repos/owner/comments/%2e%2e/settings', '/repos/owner/comments/actions/permissions', '/repos/owner/comments/secrets', '/repos/owner/comments/git/ref/heads/main#fragment']) await assert.rejects(store.request('GET', path));
  assert.equal(count, 0);
});

test('repository parsing normalizes SSH/HTTPS only for public diagnostics', async t => {
  for (const address of ['owner/comments', 'https://github.com/owner/comments.git', 'git@github.com:owner/comments.git', 'ssh://git@github.com/owner/comments.git']) assert.equal(normalizeCLIRepository(address).url, 'https://github.com/owner/comments');
  for (const address of ['git@evil.example:owner/comments', 'https://token@github.com/owner/comments', 'ssh://git:password@github.com/owner/comments', 'owner/../comments', 'owner/comments%2fsecret', 'owner/comments;echo']) assert.throws(() => normalizeCLIRepository(address));
  const { directory } = await target(t); await mkdir(directory); git(directory, 'init', '--template=');
  git(directory, 'remote', 'add', 'origin', 'git@github.com:owner/comments.git');
  assert.equal((await resolveRepository({ directory })).url, 'https://github.com/owner/comments');
  assert.equal(git(directory, 'remote', 'get-url', 'origin').trim(), 'git@github.com:owner/comments.git');
  await assert.rejects(resolveRepository({ execFileImpl: async () => ({ stdout: 'https://github.com/owner/comments\nhttps://github.com/another/repo\n' }) }), { code: 'AMBIGUOUS_ORIGIN' });
});

test('CLI doctor exit status follows its public checks', async () => {
  const { client } = await healthy(); const output = [];
  const dependencies = { githubClient: client, write: text => output.push(text), writeError: text => { throw Error(text); } };
  assert.equal(await cli.runCLI(['doctor', '--repository', 'owner/comments'], dependencies), 0);
  client.branches.delete('index');
  assert.equal(await cli.runCLI(['doctor', '--repository', 'owner/comments'], dependencies), 1);
  assert.match(output[0], /检查通过/); assert.match(output[1], /检查未通过/);
});
