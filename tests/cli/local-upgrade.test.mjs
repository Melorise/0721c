import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { init } from '../../src/cli/init.mjs';
import { upgrade } from '../../src/cli/upgrade.mjs';
import { loadAssets } from '../../src/cli/assets.mjs';
import { record, article } from '../core/fixtures.mjs';
import { json } from '../../src/cli/model.mjs';
import { git, target, fixture, put, inventory, metadata, commit, join, readFile, rm } from './fixtures.mjs';

async function deployed(t) {
  const { directory } = await target(t);
  const packageRoot = await fixture(t);
  await init({ directory, packageRoot });
  git(directory, 'remote', 'add', 'origin', 'https://github.com/owner/comments.git');
  const item = record();
  git(directory, 'switch', 'comments'); await put(directory, `${item.id}.json`, json(item)); commit(directory);
  git(directory, 'switch', 'index'); await put(directory, `${item.blog_id}.json`, json(article([item]))); commit(directory);
  git(directory, 'switch', 'main');
  await put(directory, 'config/settings.json', '{ "locale": "en" }\n');
  await put(directory, 'config/articles.json', '{ "schema_version":1, "articles":{} }\n');
  await put(directory, 'notes/user.txt', 'Uncommitted user notes\n');
  await put(directory, '.github/workflows/user.yml', 'User workflow\n');
  await put(directory, '.0721c/runtime/core/retired.mjs', '// obsolete module\n');
  await put(packageRoot, 'templates/deployment/main/README.md', 'Updated installed README\n');
  await put(packageRoot, 'src/automation/new-helper.mjs', 'export const value = 1;\n');
  return { directory, packageRoot, options: { directory, packageRoot } };
}

test('upgrade previews exact installed working-file changes without writing files or Git metadata', async t => {
  const { directory, options } = await deployed(t); const before = await inventory(directory);
  for (const flags of [{}, { dryRun: true }]) {
    const plan = await upgrade({ ...options, ...flags });
    assert.equal(plan.status, 'planned'); assert.equal(plan.applied, false); assert.equal(plan.version, '0.2.5');
    assert.equal(plan.dryRun, true); assert.equal('deploymentId' in plan, false); assert.equal('from' in plan, false);
    assert.ok(plan.changes.some(change => change.path === 'README.md' && change.diff.includes('+Updated installed README')));
    assert.ok(plan.changes.some(change => change.path.endsWith('new-helper.mjs') && change.kind === 'add'));
    assert.ok(plan.changes.some(change => change.path.endsWith('retired.mjs') && change.kind === 'delete'));
    assert.ok(!plan.changes.some(change => /config\/|deployment\.json|manifest\.json/.test(change.path)));
    assert.deepEqual(await inventory(directory), before);
  }
});

test('apply preserves dirty config, user files, origins, index, all refs and nonempty data branches', async t => {
  const { directory, options, packageRoot } = await deployed(t); const before = await inventory(directory);
  const plan = await upgrade({ ...options, apply: true });
  assert.equal(plan.status, 'updated'); assert.equal(plan.applied, true);
  const after = await inventory(directory);
  assert.deepEqual(metadata(after), metadata(before));
  for (const path of ['config/settings.json', 'config/articles.json', 'notes/user.txt', '.github/workflows/user.yml']) assert.deepEqual(after.get(path), before.get(path));
  for (const [path, text] of Object.entries((await loadAssets({ packageRoot })).managed)) assert.equal(await readFile(join(directory, path), 'utf8'), text);
  assert.equal(after.has('.0721c/runtime/core/retired.mjs'), false);
  const repeat = await upgrade({ ...options, apply: true });
  assert.equal(repeat.status, 'unchanged'); assert.equal(repeat.applied, false); assert.deepEqual(await inventory(directory), after);
});

test('apply refuses changes between preview and apply without overwriting the user edit', async t => {
  const { directory, options } = await deployed(t);
  await assert.rejects(upgrade({ ...options, apply: true, async onPlan(plan) {
    assert.ok(plan.changes.length); await put(directory, 'README.md', 'Concurrent edit\n');
  } }), { code: 'CONCURRENT_CHANGE' });
  assert.equal(await readFile(join(directory, 'README.md'), 'utf8'), 'Concurrent edit\n');
  assert.equal(await readFile(join(directory, '.0721c/runtime/core/retired.mjs'), 'utf8'), '// obsolete module\n');
});

test('apply refuses a concurrent branch update and preserves that update', async t => {
  const { directory, options } = await deployed(t); let updated;
  await assert.rejects(upgrade({ ...options, apply: true, onPlan() {
    updated = git(directory, 'commit-tree', git(directory, 'rev-parse', 'comments^{tree}').trim(), '-p', 'comments', '-m', 'Temporary concurrent data').trim();
    git(directory, 'update-ref', 'refs/heads/comments', updated);
  } }), { code: 'CONCURRENT_CHANGE' });
  assert.equal(git(directory, 'rev-parse', 'comments').trim(), updated);
  assert.notEqual(await readFile(join(directory, 'README.md'), 'utf8'), 'Updated installed README\n');
});

test('upgrade refuses linked paths, missing data branches and non-main checkout without repair', async t => {
  const { directory, options } = await deployed(t);
  const outside = join(directory, 'notes/user.txt'); await rm(join(directory, 'README.md')); await symlink(outside, join(directory, 'README.md'));
  await assert.rejects(upgrade({ ...options, apply: true }), { code: 'UNSAFE_DIRECTORY' });
  await rm(join(directory, 'README.md')); await put(directory, 'README.md', 'Original\n');
  git(directory, 'branch', '-D', 'index');
  const before = await inventory(directory);
  await assert.rejects(upgrade({ ...options, apply: true }), { code: 'MISSING_DATA_BRANCH' });
  assert.deepEqual(await inventory(directory), before);
  git(directory, 'branch', 'index', 'comments'); commit(directory); git(directory, 'switch', 'comments');
  await assert.rejects(upgrade(options), { code: 'MAIN_CHECKOUT_REQUIRED' });
});

test('upgrade rejects remote, credential and historical version options', async () => {
  for (const options of [{ repository: 'owner/comments' }, { token: 'test' }, { to: '0.1.3' }, { env: {} }, { dryRun: true, apply: true }]) await assert.rejects(upgrade(options), { code: 'INVALID_ARGUMENT' });
});
