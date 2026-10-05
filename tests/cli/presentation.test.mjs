import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { runCLI, parseArgs, init } from '../../src/cli/index.mjs';
import { formatResult, formatError } from '../../src/cli/presentation.mjs';
import { target, join, readFile, writeFile } from './fixtures.mjs';

function capture() {
  const output = [], errors = [];
  return { output, errors, dependencies: { write: text => output.push(text), writeError: text => errors.push(text) } };
}

test('init preview, creation and repeat report readable results without JSON', async t => {
  const { directory } = await target(t);
  const { output, errors, dependencies } = capture();
  assert.equal(await runCLI(['init', directory, '--dry-run'], dependencies), 0);
  assert.match(output[0], /初始化预览/);
  assert.match(output[0], /main、comments、index/);
  assert.match(output[0], /去掉 --dry-run/);
  await assert.rejects(access(directory), { code: 'ENOENT' });
  assert.equal(await runCLI(['init', directory], dependencies), 0);
  assert.match(output[1], /初始化完成/);
  assert.ok(output[1].includes(directory));
  assert.equal(await runCLI(['init', directory], dependencies), 0);
  assert.match(output[2], /已初始化，无需改动/);
  for (const text of output) assert.throws(() => JSON.parse(text));
  assert.equal(errors.length, 0);
});

test('JSON upgrade output is a single document including diffs, not mixed prose', async t => {
  const { directory } = await target(t);
  await init({ directory });
  const path = join(directory, 'README.md');
  const original = await readFile(path, 'utf8');
  await writeFile(path, original + '\nLocal change\n');
  const { output, errors, dependencies } = capture();
  assert.equal(await runCLI(['upgrade', '--directory', directory, '--json'], dependencies), 0);
  assert.equal(output.length, 1);
  const plan = JSON.parse(output[0]);
  assert.equal(plan.applied, false);
  assert.match(plan.changes.find(change => change.path === 'README.md').diff, /Local change/);
  assert.equal(await readFile(path, 'utf8'), original + '\nLocal change\n');
  assert.equal(errors.length, 0);
});

test('human upgrade shows preview and next step, then applied and unchanged status', async t => {
  const { directory } = await target(t);
  await init({ directory });
  await writeFile(join(directory, 'README.md'), 'Local change\n');
  const { output, dependencies } = capture();
  assert.equal(await runCLI(['upgrade', '--directory', directory], dependencies), 0);
  assert.match(output.at(-1), /更新预览/);
  assert.match(output.at(-1), /--apply/);
  assert.match(output.at(-1), /修改 README.md/);
  assert.equal(await runCLI(['upgrade', '--directory', directory, '--apply'], dependencies), 0);
  assert.match(output.at(-1), /更新完成/);
  assert.equal(await runCLI(['upgrade', '--directory', directory], dependencies), 0);
  assert.match(output.at(-1), /无需更新/);
});

test('invalid flags explain the exact problem; JSON errors are opt-in even when parsing fails', async () => {
  for (const [args, message] of [
    [['init', '--unsupported'], /不支持此参数/],
    [['init', '--directory'], /需要指定值/],
    [['upgrade', '--dry-run', '--apply'], /不能同时使用/],
  ]) {
    const { errors, dependencies } = capture();
    assert.equal(await runCLI(args, dependencies), 1);
    assert.match(errors[0], message);
    assert.throws(() => JSON.parse(errors[0]));
    const machine = capture();
    assert.equal(await runCLI([...args, '--json'], machine.dependencies), 1);
    assert.equal(JSON.parse(machine.errors[0]).code, 'INVALID_ARGUMENT');
  }
  assert.throws(() => parseArgs(['init', '--json=true']));
  assert.throws(() => parseArgs(['init', '--json', '--json']));
});

test('failed checks name the failed item and file without implying repair or exposing arbitrary errors', () => {
  const text = formatResult('doctor', { repository: 'https://github.com/example/comments', ok: false, checks: [
    { code: 'index-branch', ok: false, message: 'The index branch exists.' },
    { code: 'comments-json', ok: false, error: { code: 'INVALID_JSON', message: 'Invalid JSON', details: { path: 'article/a.json' } } },
  ] });
  assert.match(text, /未通过：index 分支/);
  assert.match(text, /article\/a.json/);
  assert.match(text, /检查未通过/);
  assert.doesNotMatch(text, /The index/);
  assert.match(formatError({ code: 'DIRECTORY_NOT_EMPTY' }), /目录非空/);
  assert.match(formatError({ code: 'REMOTE_OR_IO_FAILURE', status: 403 }), /HTTP 状态：403/);
});
