import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, lstat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PACKAGE_ROOT } from '../../src/cli/assets.mjs';

export const NOW = new Date('2026-10-05T00:00:00Z');
export const testEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Temporary fixture', GIT_AUTHOR_EMAIL: 'fixture@localhost', GIT_COMMITTER_NAME: 'Temporary fixture', GIT_COMMITTER_EMAIL: 'fixture@localhost' };
export function git(directory, ...args) {
  const output = spawnSync('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', '-C', directory, ...args], { encoding: 'utf8', env: testEnv });
  assert.equal(output.status, 0, output.stderr);
  return output.stdout;
}
export async function target(t, name = 'comments 中文 ; $(touch NO_SHELL)') {
  const root = await mkdtemp(join(tmpdir(), '0721c-cli-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory: join(root, name) };
}
export async function put(directory, path, bytes) {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), bytes);
}
export async function fixture(t) {
  const { root } = await target(t, 'unused');
  for (const path of ['src/core', 'src/automation', 'templates']) await cp(join(PACKAGE_ROOT, path), join(root, path), { recursive: true });
  await cp(join(PACKAGE_ROOT, 'package.json'), join(root, 'package.json'));
  return root;
}
export async function inventory(directory) {
  const files = new Map();
  async function walk(parent, prefix = '') {
    for (const name of (await readdir(parent)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(join(parent, name));
      if (info.isDirectory()) await walk(join(parent, name), path);
      else files.set(path, { mode: info.mode & 0o777, content: (await readFile(join(parent, name))).toString('hex') });
    }
  }
  await walk(directory);
  return files;
}
export const metadata = files => new Map([...files].filter(([path]) => path.startsWith('.git/')));
export const filesOn = (directory, branch) => git(directory, 'ls-tree', '-r', '--name-only', branch).trim().split('\n');
export function commit(directory) { git(directory, 'add', '--all'); git(directory, 'commit', '-m', 'Temporary fixture only'); }
export { join, readFile, writeFile, mkdir, rm };
