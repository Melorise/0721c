import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { normalizeRepository } from '../core/index.mjs';
import { fail } from './errors.mjs';

const execFileAsync = promisify(execFile);

function gitReadEnvironment() {
  // --directory owns the target, regardless of ambient Git plumbing/config.
  // Whitelist process-launch essentials instead of inheriting GIT_DIR,
  // GIT_WORK_TREE, GIT_CONFIG_COUNT, SSH commands or credential variables.
  const env = {};
  for (const key of ['PATH', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
}

/** CLI-only Git remotes become the core's credential-free public identity. */
export function normalizeCLIRepository(input) {
  if (typeof input !== 'string' || !input || input !== input.trim() || /[\s\\%\x00-\x1f\x7f`$;|<>()"']/.test(input)) fail('INVALID_REPOSITORY', 'Expected owner/repo or a public GitHub HTTPS/SSH repository address.');
  let identity = input;
  if (/^git@/i.test(input)) {
    const match = /^git@github\.com:([^?#]+)$/i.exec(input);
    if (!match) fail('INVALID_REPOSITORY', 'SSH remotes must use git@github.com:OWNER/REPO.');
    identity = match[1];
  } else if (/^ssh:/i.test(input)) {
    // Check the original spelling: URL normalization must not hide traversal,
    // passwords, alternate hosts, fragments, encoded separators or ports.
    const match = /^ssh:\/\/git@github\.com(?::22)?\/([^?#]+)$/i.exec(input);
    if (!match) fail('INVALID_REPOSITORY', 'SSH URLs must use ssh://git@github.com/OWNER/REPO.');
    identity = match[1];
  }
  return normalizeRepository(identity);
}

/** Reads one local origin URL only. Never invokes a Git transport or changes origin. */
export async function resolveRepository({ repository, directory, execFileImpl = execFileAsync } = {}) {
  if (repository !== undefined) return normalizeCLIRepository(repository);
  const cwd = resolve(directory ?? process.cwd());
  let stdout;
  try {
    const result = await execFileImpl('git', ['-C', cwd, 'config', '--local', '--no-includes', '--get-all', 'remote.origin.url'], { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 10_000, env: gitReadEnvironment() });
    stdout = result.stdout;
  } catch {
    // A Git error may echo config values. No subprocess output is forwarded.
    fail('REPOSITORY_REQUIRED', 'Provide --repository or configure one origin URL in the selected local Git repository.');
  }
  if (typeof stdout !== 'string' || !stdout) fail('REPOSITORY_REQUIRED', 'No origin repository URL was found.');
  const origin = stdout.replace(/\r?\n$/, '');
  if (/[\r\n]/.test(origin)) fail('AMBIGUOUS_ORIGIN', 'Exactly one origin URL is required; provide --repository explicitly.');
  return normalizeCLIRepository(origin);
}
