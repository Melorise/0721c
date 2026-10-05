import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, link, symlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { init } from '../../src/cli/init.mjs';
import { loadAssets, PACKAGE_ROOT } from '../../src/cli/assets.mjs';
import { record } from '../core/fixtures.mjs';
import { json } from '../../src/cli/model.mjs';
import { NOW, git, target, put, inventory, filesOn, commit, readFile, writeFile, mkdir, rm, join } from './fixtures.mjs';

async function initialized(t, more = {}) {
  const paths = await target(t);
  const output = await init({ directory: paths.directory, now: NOW, ...more });
  return { ...paths, output };
}

test('real offline init creates exact installed files, independent roots, clean main and README-only data', async t => {
  const { directory, output } = await initialized(t);
  const assets = await loadAssets();
  assert.equal(output.version, '0.3.0'); assert.equal(output.initialized, true);
  assert.equal(git(directory, 'status', '--porcelain'), '');
  assert.equal(git(directory, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
  assert.equal(git(directory, 'remote'), '');
  for (const branch of ['main', 'comments', 'index']) {
    assert.equal(git(directory, 'rev-list', '--parents', '-n', '1', branch).trim().split(' ').length, 1);
    assert.equal(git(directory, 'rev-parse', branch).trim(), output.branches[branch]);
    assert.ok(!filesOn(directory, branch).some(path => /deployment\.json|manifest\.json|node_modules|\.env|reservation/.test(path)));
  }
  assert.deepEqual(filesOn(directory, 'main').sort(), Object.keys(assets.main).sort());
  for (const [path, text] of Object.entries(assets.main)) {
    assert.equal(git(directory, 'show', `main:${path}`), text, path);
    assert.equal(await readFile(join(directory, path), 'utf8'), text, path);
  }
  assert.deepEqual(filesOn(directory, 'comments'), ['README.md']);
  assert.deepEqual(filesOn(directory, 'index'), ['README.md']);
  assert.equal('deploymentId' in output, false);
  assert.equal(await readFile(join(directory, '.0721c/runtime/automation/build-index.mjs'), 'utf8'), await readFile(join(PACKAGE_ROOT, 'src/automation/build-index.mjs'), 'utf8'));
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw Error('No network'); };
    const {buildIndexes} = await import('./.0721c/runtime/automation/build-index.mjs');
    const {validateSettings} = await import('./.0721c/runtime/core/index.mjs');
    const result = buildIndexes({records:[${JSON.stringify(record())}],settings:validateSettings()});
    if (result.indexes[${JSON.stringify(record().blog_id)}].comments[0].id !== ${JSON.stringify(record().id)} || 'manifest' in result) throw Error('Wrong runtime layout');
  `], { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(probe.status, 0, probe.stderr);
});

test('dry-run on absent and empty targets writes no files, refs or temporary artifacts', async t => {
  const { root, directory } = await target(t);
  const before = await inventory(root);
  const plan = await init({ directory, dryRun: true });
  assert.equal(plan.status, 'planned'); assert.equal(plan.initialized, false);
  assert.deepEqual(plan.plan.branches, ['main', 'comments', 'index']);
  assert.ok(!plan.plan.files.some(path => /deployment\.json|manifest\.json/.test(path)));
  await assert.rejects(access(directory), { code: 'ENOENT' });
  assert.deepEqual(await inventory(root), before);
  await mkdir(directory);
  assert.equal((await init({ directory, dryRun: true })).initialized, false);
  assert.deepEqual(await inventory(directory), new Map());
});

test('init accepts an existing empty directory and treats shell-looking paths literally', async t => {
  const { directory, root } = await target(t); await mkdir(directory);
  await init({ directory });
  assert.equal(git(directory, 'status', '--porcelain'), '');
  await assert.rejects(access(join(root, 'NO_SHELL')), { code: 'ENOENT' });
});

for (const origin of ['git@github.com:owner/comments.git', 'ssh://git@github.com/owner/comments.git', 'https://github.com/owner/comments.git']) {
  test(`empty-Git init and repeated init preserve origin/config exactly: ${origin}`, async t => {
    const { directory } = await target(t); await mkdir(directory);
    git(directory, 'init', '--template=', '--initial-branch=trunk');
    git(directory, 'remote', 'add', 'origin', origin);
    git(directory, 'config', 'user.name', 'Existing author');
    const config = await readFile(join(directory, '.git/config'));
    const before = await inventory(directory);
    const preview = await init({ directory, dryRun: true });
    assert.equal(preview.initialized, false); assert.deepEqual(await inventory(directory), before);
    await init({ directory });
    assert.deepEqual(await readFile(join(directory, '.git/config')), config);
    const initializedState = await inventory(directory);
    assert.equal((await init({ directory })).unchanged, true);
    assert.equal((await init({ directory, dryRun: true })).unchanged, true);
    assert.deepEqual(await inventory(directory), initializedState);
    assert.equal(git(directory, 'remote', 'get-url', 'origin').trim(), origin);
  });
}

test('repeat init preserves nonempty approved data, published indexes and edited configuration', async t => {
  const { directory } = await initialized(t);
  const item = record();
  git(directory, 'switch', 'comments'); await put(directory, `${item.id}.json`, json(item)); commit(directory);
  git(directory, 'switch', 'index'); await put(directory, `${item.blog_id}.json`, json({ blog_id: item.blog_id, total_count: 0, root_count: 0, comments_enabled: false, comments: [] })); commit(directory);
  git(directory, 'switch', 'main');
  const settings = JSON.parse(await readFile(join(directory, 'config/settings.json'), 'utf8')); settings.locale = 'en';
  await put(directory, 'config/settings.json', json(settings));
  const before = await inventory(directory);
  assert.equal((await init({ directory })).unchanged, true);
  assert.deepEqual(await inventory(directory), before);
  await assert.rejects(init({ directory, locale: 'zh-CN' }), { code: 'CONFIGURATION_CONFLICT' });
  assert.deepEqual(await inventory(directory), before);
});

test('custom nested article policy never creates initial index JSON', async t => {
  const { directory } = await initialized(t, { locale: 'en', articles: { schema_version: 1, articles: { 'article/essay/slug': { enabled: false, title: 'Title' } } } });
  assert.equal(JSON.parse(await readFile(join(directory, 'config/settings.json'), 'utf8')).locale, 'en');
  assert.equal(JSON.parse(await readFile(join(directory, 'config/articles.json'), 'utf8')).articles['article/essay/slug'].enabled, false);
  assert.deepEqual(filesOn(directory, 'index'), ['README.md']);
});

test('nonempty directories and nonempty Git targets are refused without overwriting data', async t => {
  const { directory } = await target(t); await mkdir(directory); await put(directory, 'article/essay/slug/1.json', '{}');
  const before = await inventory(directory);
  await assert.rejects(init({ directory }), { code: 'DIRECTORY_NOT_EMPTY' });
  await assert.rejects(init({ directory, dryRun: true }), { code: 'DIRECTORY_NOT_EMPTY' });
  assert.deepEqual(await inventory(directory), before);
  git(directory, 'init', '--template=', '--initial-branch=main');
  const after = await inventory(directory);
  await assert.rejects(init({ directory }), { code: 'DIRECTORY_NOT_EMPTY' });
  assert.deepEqual(await inventory(directory), after);
});

test('repeat init refuses missing branches and changed standard working files without repair', async t => {
  const { directory } = await initialized(t);
  await put(directory, 'README.md', 'Local edit\n');
  let before = await inventory(directory);
  await assert.rejects(init({ directory }), { code: 'FILES_DIFFER' });
  assert.deepEqual(await inventory(directory), before);
  await put(directory, 'README.md', (await loadAssets()).main['README.md']);
  git(directory, 'branch', '-D', 'index'); before = await inventory(directory);
  await assert.rejects(init({ directory }), { code: 'MISSING_DATA_BRANCH' });
  assert.deepEqual(await inventory(directory), before);
});

test('symlink parents, redirected Git metadata, shared files and nested Git targets are refused', async t => {
  const { directory, root } = await target(t); const actual = join(root, 'actual'); await mkdir(actual);
  await symlink(actual, directory);
  await assert.rejects(init({ directory }), { code: 'UNSAFE_DIRECTORY' });
  await assert.rejects(init({ directory: join(directory, 'child') }), { code: 'UNSAFE_DIRECTORY' });
  await rm(directory); await mkdir(directory); await put(directory, '.git', 'gitdir: /never-follow\n');
  await assert.rejects(init({ directory }), { code: 'UNSAFE_DIRECTORY' });
  await rm(join(directory, '.git')); await init({ directory });
  const outside = join(root, 'outside'); await writeFile(outside, 'shared');
  await rm(join(directory, 'README.md')); await link(outside, join(directory, 'README.md'));
  await assert.rejects(init({ directory }), { code: 'UNSAFE_DIRECTORY' });
  const parent = join(root, 'source-project'); await mkdir(parent); git(parent, 'init', '--template=');
  await assert.rejects(init({ directory: join(parent, 'child') }), { code: 'NESTED_REPOSITORY' });
});

test('init ignores ambient Git redirects and never invokes hooks, fsmonitor, credentials or network', async t => {
  const { directory, root } = await target(t); await mkdir(directory); git(directory, 'init', '--template=');
  const marker = join(root, 'HOOK_RAN');
  await put(directory, '.git/hooks/pre-commit', `#!/bin/sh\ntouch '${marker}'\n`); await chmod(join(directory, '.git/hooks/pre-commit'), 0o755);
  await put(directory, '.git/hooks/reference-transaction', `#!/bin/sh\ntouch '${marker}'\n`); await chmod(join(directory, '.git/hooks/reference-transaction'), 0o755);
  git(directory, 'config', 'core.fsmonitor', `touch '${marker}'`);
  const script = `
    import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
    const original = cp.spawn;
    cp.spawn = (file,args,options) => {
      if (file !== 'git' || options.shell !== false) throw Error('Forbidden process');
      if (Object.keys(options.env).some(key => /TOKEN|PASSWORD|ASKPASS|SSH|HOME/.test(key))) throw Error('Credentials inherited');
      const allowed = ['config','rev-parse','for-each-ref','ls-files','hash-object','mktree','commit-tree','update-ref','symbolic-ref','read-tree'];
      if (!args.some(arg => allowed.includes(arg))) throw Error('Forbidden Git operation');
      if (args.includes('config') && (!args.includes('--no-includes') || !args.includes('--get-regexp'))) throw Error('Configuration lookup');
      return original(file,args,options);
    };
    syncBuiltinESMExports();
    globalThis.fetch = () => {throw Error('No network');};
    process.env = new Proxy(process.env,{get(object,key){if (/TOKEN|PASSWORD|ASKPASS|SSH|HOME/.test(String(key))) throw Error('Credential read'); return object[key];}});
    const {init} = await import(${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, 'src/cli/init.mjs')).href)});
    await init({directory:${JSON.stringify(directory)}});
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, GH_TOKEN: 'test-sentinel', GIT_DIR: '/never-follow', GIT_WORK_TREE: '/never-follow', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/never-follow' } });
  assert.equal(child.status, 0, child.stderr);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  assert.equal(git(directory, 'status', '--porcelain'), '');
});
