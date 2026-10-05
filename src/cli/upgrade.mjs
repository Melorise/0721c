import { resolve } from 'node:path';
import { loadAssets } from './assets.mjs';
import { fail } from './errors.mjs';
import { assertDirectory, inspectGit, branches, readRegular, runtimePaths, applyFiles } from './local-upgrade.mjs';

function diff(path, before, after) {
  const lines = (value, prefix) => value === null || value.length === 0 ? [] : value.toString('utf8').replace(/\n$/, '').split('\n').map(line => prefix + line);
  const a = lines(before, '-'); const b = lines(after, '+');
  return [`--- ${before === null ? '/dev/null' : `a/${path}`}`, `+++ ${after === null ? '/dev/null' : `b/${path}`}`, `@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@`, ...a, ...b].join('\n') + '\n';
}

/** Preview installed standard working files; apply never stages, commits or changes refs. */
export async function upgrade(options = {}) {
  for (const key of Reflect.ownKeys(options)) {
    if (!['directory', 'packageRoot', 'dryRun', 'apply', 'onPlan'].includes(key)) fail('INVALID_ARGUMENT', 'Unsupported local upgrade option.', { option: String(key) });
  }
  for (const key of ['dryRun', 'apply']) if (options[key] !== undefined && typeof options[key] !== 'boolean') fail('INVALID_ARGUMENT', 'Upgrade switches must be booleans.');
  if (options.apply && options.dryRun) fail('INVALID_ARGUMENT', '--apply and --dry-run cannot be combined.');
  if (options.onPlan !== undefined && typeof options.onPlan !== 'function') fail('INVALID_ARGUMENT', 'onPlan must be a function.');
  const assets = await loadAssets(options);
  const directory = resolve(options.directory ?? '.');
  await assertDirectory(directory);
  await inspectGit(directory);
  const heads = await branches(directory);
  if (!await readRegular(directory, 'config/settings.json') || !await readRegular(directory, '.0721c/runtime/core/index.mjs')) fail('NOT_A_DEPLOYMENT', 'A main checkout with config/settings.json and the installed runtime is required.');
  const paths = new Set([...Object.keys(assets.managed), ...await runtimePaths(directory)]);
  const original = new Map(); const updates = new Map(); const changes = [];
  for (const path of [...paths].sort()) {
    const file = await readRegular(directory, path);
    if (file && file.mode & 0o111) fail('UNSAFE_DIRECTORY', 'Managed working files must be non-executable.', { path });
    original.set(path, file);
    const before = file?.bytes ?? null;
    const after = Object.hasOwn(assets.managed, path) ? Buffer.from(assets.managed[path]) : null;
    if (before === null && after === null || before !== null && after !== null && before.equals(after)) continue;
    updates.set(path, after);
    changes.push({ path, kind: before === null ? 'add' : after === null ? 'delete' : 'modify', diff: diff(path, before, after) });
  }
  const apply = options.apply === true;
  const plan = { command: 'upgrade', directory, version: assets.version, status: changes.length ? 'planned' : 'unchanged', applied: false, dryRun: !apply, changes, preserved: ['config/', 'comments branch', 'index branch', 'Git refs, index and origins', 'other user files'] };
  if (options.onPlan) await options.onPlan(plan);
  if (!apply || !changes.length) return plan;
  await applyFiles(directory, heads, original, updates);
  return { ...plan, status: 'updated', applied: true, manual: ['Review git diff, then stage, commit and upload main with your own Git.'] };
}
