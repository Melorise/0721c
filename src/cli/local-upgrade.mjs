import { spawn } from 'node:child_process';
import { lstat, readdir, readFile, mkdir, mkdtemp, writeFile, rename, rm, unlink, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CLIError, fail } from './errors.mjs';
import { BRANCHES, validPath, runtimeFile } from './model.mjs';

export async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function assertDirectory(directory, allowMissing = false) {
  for (let path = directory; ; path = dirname(path)) {
    const info = await stat(path);
    if ((!info && (!allowMissing || path !== directory)) || info && (!info.isDirectory() || info.isSymbolicLink())) fail('UNSAFE_DIRECTORY', 'The destination and its parents must be ordinary directories.');
    if (dirname(path) === path) break;
  }
  for (let path = dirname(directory); ; path = dirname(path)) {
    const marker = join(path, '.git');
    const info = await stat(marker);
    if (info && (!info.isDirectory() || info.isSymbolicLink() || await stat(join(marker, 'HEAD')) || await stat(join(marker, 'config')))) fail('NESTED_REPOSITORY', 'Keep the deployment outside another Git worktree.');
    if (dirname(path) === path) break;
  }
}

function environment(now) {
  const env = {};
  for (const name of ['PATH', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP']) if (process.env[name] !== undefined) env[name] = process.env[name];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_ATTR_NOSYSTEM: '1', GIT_AUTHOR_NAME: '0721c initializer', GIT_AUTHOR_EMAIL: '0721c@localhost', GIT_COMMITTER_NAME: '0721c initializer', GIT_COMMITTER_EMAIL: '0721c@localhost' });
  if (now) env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = now.toISOString();
  return env;
}

/** Only local plumbing is used. No shell, hooks, transports or inherited credentials. */
export async function git(directory, args, { input = '', now, allowFailure = false } = {}) {
  return new Promise((done, reject) => {
    const child = spawn('git', ['--no-pager', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', '-c', 'core.autocrlf=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-C', directory, ...args], { env: environment(now), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = ''; let size = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > 32 * 1024 * 1024) child.kill(); else output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new CLIError('GIT_UNAVAILABLE', 'Local tooling requires Git on PATH.')));
    child.on('close', code => {
      if (size > 32 * 1024 * 1024) reject(new CLIError('LOCAL_GIT_LIMIT', 'The local Git response exceeds the inspection limit.'));
      else if (code !== 0 && !allowFailure) reject(new CLIError('LOCAL_GIT_FAILURE', 'A local Git operation failed.', { operation: args[0] }));
      else done({ code, raw: output, text: output.replace(/\r?\n$/, '') });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function inspectGit(directory) {
  const root = join(directory, '.git');
  if (!(await stat(root))?.isDirectory() || (await stat(root)).isSymbolicLink()) fail('UNSAFE_DIRECTORY', 'Linked worktrees and redirected Git metadata are refused.');
  for (const path of ['HEAD', 'config', 'index', 'objects', 'refs', 'packed-refs', 'objects/info', 'refs/heads']) {
    const info = await stat(join(root, path));
    if (info?.isSymbolicLink() || info?.isFile() && info.nlink !== 1) fail('UNSAFE_DIRECTORY', 'Redirected or shared Git metadata is refused.');
  }
  for (const path of ['commondir', 'gitdir', 'config.worktree', 'shallow', 'info/grafts', 'objects/info/alternates', 'objects/info/http-alternates', 'refs/replace']) {
    if (await stat(join(root, path))) fail('UNSAFE_DIRECTORY', 'Shared, shallow or redirected Git stores are refused.');
  }
  // Read only routing/lazy-fetch settings; never list configuration or credentials.
  const config = await git(directory, ['config', '--local', '--no-includes', '--get-regexp', '^(include.*|core\\.(worktree|bare)|extensions\\..*|remote\\..*\\.(promisor|partialclonefilter))$'], { allowFailure: true });
  if (config.code !== 0 && config.code !== 1) fail('UNSAFE_GIT_CONFIG', 'Cannot inspect local Git routing safely.');
  if (config.text.split('\n').filter(Boolean).some(line => line.toLowerCase() !== 'core.bare false' && !/^extensions\.objectformat (sha1|sha256)$/.test(line))) fail('UNSAFE_GIT_CONFIG', 'Git includes, worktree redirects and lazy object stores are refused.');
  if ((await git(directory, ['rev-parse', '--is-bare-repository'])).text !== 'false') fail('UNSAFE_DIRECTORY', 'An ordinary Git worktree is required.');
}

export async function branches(directory) {
  const output = {};
  for (const branch of BRANCHES) {
    const head = await git(directory, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], { allowFailure: true });
    if (head.code !== 0) fail('MISSING_DATA_BRANCH', 'Local main, comments and index branches must exist.');
    output[branch] = head.text;
  }
  if ((await git(directory, ['symbolic-ref', '-q', 'HEAD'], { allowFailure: true })).text !== 'refs/heads/main') fail('MAIN_CHECKOUT_REQUIRED', 'Check out main before running local tooling.');
  return output;
}

export async function readRegular(directory, path) {
  if (!validPath(path)) fail('UNSAFE_DIRECTORY', 'Unsafe relative file path.', { path });
  let parent = directory;
  for (const part of path.split('/').slice(0, -1)) {
    parent = join(parent, part);
    const info = await stat(parent);
    if (!info) return null;
    if (!info.isDirectory() || info.isSymbolicLink()) fail('UNSAFE_DIRECTORY', 'File parents must be ordinary directories.', { path });
  }
  const info = await stat(join(directory, path));
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('UNSAFE_DIRECTORY', 'Deployment files must be ordinary, unshared files.', { path });
  return { bytes: await readFile(join(directory, path)), mode: info.mode & 0o777, dev: info.dev, ino: info.ino };
}

export async function runtimePaths(directory) {
  const paths = [];
  async function walk(path) {
    const info = await stat(join(directory, path));
    if (!info) return;
    if (info.isSymbolicLink()) fail('UNSAFE_DIRECTORY', 'Runtime files must not follow symbolic links.', { path });
    if (info.isDirectory()) for (const name of await readdir(join(directory, path))) await walk(`${path}/${name}`);
    else if (runtimeFile(path)) paths.push(path);
  }
  for (const path of ['.0721c', '.0721c/runtime']) {
    const info = await stat(join(directory, path));
    if (!info) return paths;
    if (!info.isDirectory() || info.isSymbolicLink()) fail('UNSAFE_DIRECTORY', 'Runtime parents must be ordinary directories.', { path });
  }
  for (const area of ['core', 'automation']) await walk(`.0721c/runtime/${area}`);
  return paths;
}

export async function assertStable(directory, expectedBranches, original) {
  await assertDirectory(directory);
  await inspectGit(directory);
  const current = await branches(directory);
  if (BRANCHES.some(branch => current[branch] !== expectedBranches[branch])) fail('CONCURRENT_CHANGE', 'Git refs changed after planning; review a new preview.');
  for (const [path, before] of original) {
    const after = await readRegular(directory, path);
    if (before === null ? after !== null : after === null || !after.bytes.equals(before.bytes) || after.mode !== before.mode || after.dev !== before.dev || after.ino !== before.ino) fail('CONCURRENT_CHANGE', 'A working file changed after planning.', { path });
  }
}

async function replace(directory, path, before, after, created) {
  let parent = directory;
  for (const part of path.split('/').slice(0, -1)) {
    parent = join(parent, part);
    let info = await stat(parent);
    if (!info) { await mkdir(parent); created.push(parent); info = await stat(parent); }
    if (!info.isDirectory() || info.isSymbolicLink()) fail('CONCURRENT_CHANGE', 'A working-file parent changed during apply.', { path });
  }
  const matches = async () => {
    const current = await readRegular(directory, path);
    if (before === null ? current !== null : current === null || !current.bytes.equals(before.bytes) || current.dev !== before.dev || current.ino !== before.ino) fail('CONCURRENT_CHANGE', 'A working file changed during apply.', { path });
  };
  await matches();
  if (after === null) { await unlink(join(directory, path)); return; }
  // Fully write a temporary file before replacing the original, so a failed
  // disk write cannot leave a partially overwritten working file.
  const staging = await mkdtemp(join(parent, '.0721c-upgrade-'));
  try {
    await writeFile(join(staging, 'file'), after, { flag: 'wx', mode: before?.mode ?? 0o644 });
    await matches();
    await rename(join(staging, 'file'), join(directory, path));
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** Apply touches only selected working files. Git, configuration and data are preserved. */
export async function applyFiles(directory, expectedBranches, original, updates) {
  await assertStable(directory, expectedBranches, original);
  const created = []; const applied = [];
  try {
    for (const [path, after] of updates) {
      await replace(directory, path, original.get(path), after, created);
      applied.push(path);
    }
    const current = await branches(directory);
    if (BRANCHES.some(branch => current[branch] !== expectedBranches[branch])) fail('CONCURRENT_CHANGE', 'Git refs changed during apply.');
  } catch (error) {
    for (const path of applied.reverse()) {
      const current = await readRegular(directory, path);
      const written = updates.get(path);
      if (written === null ? current !== null : current === null || !current.bytes.equals(written)) fail('ROLLBACK_CONFLICT', 'A concurrent edit prevented rollback.', { path });
      await replace(directory, path, current, original.get(path)?.bytes ?? null, created);
    }
    for (const path of created.reverse()) { try { await rmdir(path); } catch { /* Keep nonempty user directories. */ } }
    throw error;
  }
}
