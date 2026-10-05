import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { list, actionContext, loadDeployment, serialize, recordPath, parseRecordPath, addedRecordEntry, createCommit } from '../../src/automation/runtime.mjs';
import { findCommentPullRequest } from '../../src/automation/intake-comment.mjs';
import { record } from '../core/fixtures.mjs';
import { MockGitHub } from './mock-github.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));

test('every runtime module imports without fetching or executing an Action and needs no npm dependencies', async () => {
  const modules = (await readdir(join(root, 'src/automation'))).filter(n => n.endsWith('.mjs'));
  const paths = modules.map(name => new URL(`../../src/automation/${name}`, import.meta.url).href);
  const script = `globalThis.fetch=()=>{throw new Error('no network')}; process.env.GITHUB_EVENT_PATH='/invalid.json'; process.env.GITHUB_EVENT_NAME='issues'; await Promise.all(${JSON.stringify(paths)}.map(path=>import(path))); process.exitCode=17;`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 17, result.stderr); // Completion sentinel: child stdout is not available in every runner.
  for (const name of modules) {
    const source = await readFile(join(root, 'src/automation', name), 'utf8');
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('node:') || match[1].startsWith('./') || match[1].startsWith('../core/'));
    assert.doesNotMatch(source, /execSync|execFile|spawn|eval\s*\(|reservations|\.0721c\/deployment\.json|\.0721c\/manifest\.json/);
  }
});
test('full nested Unicode article paths round trip; traversal and malformed timestamp/random filenames fail', () => {
  const item = record(37, { blog_id: '文章/随笔/hello.world' });
  assert.equal(recordPath(item), `${item.id}.json`);
  assert.deepEqual(parseRecordPath(recordPath(item)), { blog_id: item.blog_id, id: item.id });
  for (const path of ['/article/1.json', 'article/../1.json', 'article/%2f/1.json', 'article/01.json', 'article/random.json', '1.json']) assert.throws(() => parseRecordPath(path));
});
test('recursive directory SHA changes are ignored while only one JSON file may be added', () => {
  const blob = { path: 'README.md', mode: '100644', type: 'blob', sha: 'a'.repeat(40) };
  const dir = { path: 'article', mode: '040000', type: 'tree', sha: 'b'.repeat(40) };
  const added = { path: `${record().id}.json`, mode: '100644', type: 'blob', sha: 'c'.repeat(40) };
  assert.deepEqual(addedRecordEntry([blob, dir], [blob, { ...dir, sha: 'd'.repeat(40) }, added]), added);
  assert.throws(() => addedRecordEntry([blob], [{ ...blob, mode: '100755' }, added]));
  assert.throws(() => addedRecordEntry([blob], [added]));
});
test('paginated PR lookup includes closed PRs and rejects ambiguous matches', async () => {
  let calls = 0;
  const pr = { number: 101, state: 'closed', base: { ref: 'comments' }, head: { ref: 'comment-1', repo: { full_name: 'example/comments' } } };
  const client = { owner: 'example', repo: 'comments', basePath: '/repos/example/comments', request: async (method, path) => {
    assert.equal(method, 'GET'); assert.ok(path.includes('state=all')); calls++;
    return path.endsWith('page=1') ? Array.from({ length: 100 }, () => ({ head: { ref: 'other' } })) : [pr];
  } };
  assert.equal((await findCommentPullRequest(client, 1)).number, 101); assert.equal(calls, 2);
  client.request = async () => [pr, pr]; await assert.rejects(findCommentPullRequest(client, 1), /Multiple/);
  await assert.rejects(list({ request: async () => ({}) }, '/list'), /array/);
});
test('configuration reads main settings and optional articles with no deployment manifest', async () => {
  const mock = new MockGitHub(); const context = await loadDeployment(mock.client);
  assert.equal(Object.hasOwn(context, 'manifest'), false); assert.deepEqual(context.articles, {});
  assert.equal(mock.calls.some(c => c.path.includes('deployment.json')), false);
  const sha = await createCommit(mock.client, { parent: mock.mainSha, message: 'bad config', files: { 'config/articles.json': '{"schema_version":1}' } });
  mock.refs.set('heads/main', sha); await assert.rejects(loadDeployment(mock.client), /articles configuration/);
});
test('manual events require main and the expected repository without a transport call', async () => {
  const directory = await mkdtemp(join(tmpdir(), '0721c-automation-event-'));
  try {
    const path = join(directory, 'event.json'); await writeFile(path, serialize({ repository: { full_name: 'example/comments' } }));
    const env = { GITHUB_EVENT_PATH: path, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'example/comments', GITHUB_TOKEN: 'fixture', GITHUB_REF: 'refs/heads/comments' };
    await assert.rejects(actionContext(env), /main/);
    env.GITHUB_REF = 'refs/heads/main'; assert.equal((await actionContext(env)).eventName, 'workflow_dispatch');
    env.GITHUB_REPOSITORY = 'other/repository'; await assert.rejects(actionContext(env), /repository mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('workflow templates execute pinned Actions and main only, serialize publication and keep least scopes', async () => {
  const directory = join(root, 'templates/deployment/main/.github/workflows');
  const names = ['intake-comment.yml', 'validate-comment.yml', 'publish-index.yml'];
  const workflows = await Promise.all(names.map(name => readFile(join(directory, name), 'utf8')));
  for (const source of workflows) {
    assert.match(source, /ref: main/); assert.match(source, /persist-credentials: false/);
    assert.match(source, /permissions: \{\}/); assert.match(source, /queue: max/);
    assert.match(source, /RUNTIME_MAIN_SHA="\$\(git rev-parse HEAD\)"/);
    for (const action of source.matchAll(/^\s+uses: (.+)/gm)) assert.match(action[1], /^[a-z-]+\/[a-z-]+@[a-f0-9]{40}(?: |$)/);
    assert.doesNotMatch(source, /npm (?:ci|install)|npx |github\.event\.issue\.body|pull_request\.head|cancel-in-progress: true|deployment\.json/);
  }
  const [intake, validate, publish] = workflows;
  assert.match(intake, /github\.event\.issue\.number \|\| inputs\.issue_number/);
  assert.match(intake, /secrets\.COMMENTS_TOKEN \|\| github\.token/); assert.doesNotMatch(intake, /issue_id|capture_current/);
  assert.match(validate, /contents: read/); assert.doesNotMatch(validate, /issues: write|pull-requests: write|contents: write/);
  assert.match(publish, /group: 0721c-publish-index/); assert.match(publish, /branches: \[main, comments\]/);
  assert.doesNotMatch(publish, /issues:|pull-requests: write|statuses:/);
  assert.match(publish, /pull-requests: read/);
  assert.match(publish, /RESEND_API_KEY:.*secrets\.RESEND_API_KEY/);
  assert.match(publish, /COMMENTS_OWNER_EMAIL:.*secrets\.COMMENTS_OWNER_EMAIL/);
  assert.match(await readFile(join(root, 'templates/deployment/main/.github/ISSUE_TEMPLATE/config.yml'), 'utf8'), /blank_issues_enabled: true/);
});
