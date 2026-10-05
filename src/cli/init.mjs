import { readdir, writeFile, mkdir, mkdtemp, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadAssets } from './assets.mjs';
import { fail } from './errors.mjs';
import { BRANCHES, json, parseJSON, validateArticles, validPath } from './model.mjs';
import { assertDirectory, stat, inspectGit, git, branches, readRegular } from './local-upgrade.mjs';

function configuration(assets, options) {
  let settings = assets.core.validateSettings(options.settings ?? assets.settings);
  if (options.locale !== undefined) settings = assets.core.validateSettings({ ...settings, locale: options.locale });
  const articles = validateArticles(options.articles ?? assets.articles, assets.core.assertArticleId);
  const files = { ...assets.main };
  if (options.settings !== undefined || options.locale !== undefined) files['config/settings.json'] = json(settings);
  if (options.articles !== undefined) files['config/articles.json'] = json(articles);
  return { settings, articles, files };
}

function result(directory, assets, heads, extra = {}) {
  return {
    command: 'init', directory, version: assets.version, status: 'initialized', initialized: true, branches: heads,
    manual: [
      'Create a separate public GitHub repository and review main/comments/index locally.',
      'Keep your SSH or HTTPS origin, or add one manually; upload the three branches with your own Git.',
      'Set the main default branch, enable Issues and configure Actions permissions and optional Secrets manually on GitHub.'
    ], ...extra
  };
}

async function inspectTarget(directory) {
  if (!await stat(directory)) return 'absent';
  const entries = await readdir(directory);
  if (!entries.includes('.git')) {
    if (entries.length) fail('DIRECTORY_NOT_EMPTY', 'Initialization refuses a nonempty directory.');
    return 'empty';
  }
  await inspectGit(directory);
  if ((await git(directory, ['for-each-ref', '--format=%(refname)'])).text) return 'repository';
  if (entries.some(name => name !== '.git') || (await git(directory, ['ls-files'])).text) fail('DIRECTORY_NOT_EMPTY', 'An empty Git target must have no working files, staged files or refs.');
  return 'empty-git';
}

async function unchanged(directory, assets, options) {
  const heads = await branches(directory);
  for (const [path, content] of Object.entries(assets.managed)) {
    const existing = await readRegular(directory, path);
    if (!existing || existing.mode & 0o111 || !existing.bytes.equals(Buffer.from(content))) fail('FILES_DIFFER', 'Initialization refuses to replace existing files; review a local upgrade instead.', { path });
  }
  const settingsFile = await readRegular(directory, 'config/settings.json');
  if (!settingsFile) fail('MISSING_CONFIGURATION', 'config/settings.json is required.');
  const existingSettings = assets.core.validateSettings(parseJSON(settingsFile.bytes.toString('utf8'), 'config/settings.json'));
  const articlesFile = await readRegular(directory, 'config/articles.json');
  const existingArticles = validateArticles(articlesFile ? parseJSON(articlesFile.bytes.toString('utf8'), 'config/articles.json') : { schema_version: 1, articles: {} }, assets.core.assertArticleId);
  const selected = configuration(assets, options);
  if (((options.settings !== undefined || options.locale !== undefined) && json(existingSettings) !== json(selected.settings)) || (options.articles !== undefined && json(existingArticles) !== json(selected.articles))) fail('CONFIGURATION_CONFLICT', 'Repeat initialization cannot change configuration.');
  return result(directory, assets, heads, { unchanged: true, ...(options.dryRun ? { dryRun: true } : {}) });
}

async function commitFiles(directory, files, message, now) {
  const root = Object.create(null);
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!validPath(path)) fail('UNSAFE_PACKAGE', 'Unsafe template path.', { path });
    const blob = (await git(directory, ['hash-object', '-w', '--stdin'], { input: content })).text;
    const parts = path.split('/'); let tree = root;
    for (const name of parts.slice(0, -1)) tree = tree[name] ??= Object.create(null);
    tree[parts.at(-1)] = blob;
  }
  async function writeTree(tree) {
    const entries = [];
    for (const [name, value] of Object.entries(tree)) entries.push(typeof value === 'string' ? `100644 blob ${value}\t${name}\0` : `040000 tree ${await writeTree(value)}\t${name}\0`);
    return (await git(directory, ['mktree', '-z'], { input: entries.join('') })).text;
  }
  return (await git(directory, ['commit-tree', await writeTree(root)], { input: `${message}\n`, now })).text;
}

async function removeEmpty(path) {
  const info = await stat(path);
  if (!info?.isDirectory() || info.isSymbolicLink()) return;
  for (const entry of await readdir(path)) await removeEmpty(join(path, entry));
  try { await rmdir(path); } catch { /* Keep concurrent user files. */ }
}

async function populate(directory, assets, files, now) {
  const heads = {
    main: await commitFiles(directory, files, `0721c ${assets.version}: local deployment`, now),
    comments: await commitFiles(directory, assets.comments, '0721c: independent approved comments root', now),
    index: await commitFiles(directory, assets.index, '0721c: independent public index root', now)
  };
  const created = []; let attached = false;
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content, { flag: 'wx', mode: 0o644 });
      created.push(path);
    }
    await git(directory, ['update-ref', '--stdin'], { input: `start\n${Object.entries(heads).map(([branch, oid]) => `create refs/heads/${branch} ${oid}`).join('\n')}\nprepare\ncommit\n` });
    attached = true;
    await git(directory, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    await git(directory, ['read-tree', heads.main]);
    return result(directory, assets, heads);
  } catch (error) {
    if (!attached) {
      for (const path of created.reverse()) await rm(join(directory, path));
      for (const path of ['.github', '.0721c', 'config']) await removeEmpty(join(directory, path));
    }
    throw error;
  }
}

/** Offline generation. Destination commits only; existing refs and origins are preserved. */
export async function init(options = {}) {
  for (const key of Reflect.ownKeys(options)) {
    if (!['directory', 'packageRoot', 'dryRun', 'settings', 'articles', 'locale', 'now'].includes(key)) fail('INVALID_ARGUMENT', 'Unsupported offline init option.', { option: String(key) });
  }
  if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') fail('INVALID_ARGUMENT', 'dryRun must be a boolean.');
  const directory = resolve(options.directory ?? '.');
  const assets = await loadAssets(options);
  const { files } = configuration(assets, options);
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail('INVALID_DATE', 'Initialization time must be a valid Date.');
  await assertDirectory(directory, true);
  const target = await inspectTarget(directory);
  if (target === 'repository') return unchanged(directory, assets, options);
  if (options.dryRun) return result(directory, assets, {}, { status: 'planned', initialized: false, dryRun: true, plan: { files: Object.keys(files).sort(), branches: [...BRANCHES] } });
  if (target === 'empty-git') {
    const lock = join(directory, '.git', '0721c-init.lock');
    try { await mkdir(lock); }
    catch (error) { if (error.code === 'EEXIST') fail('INITIALIZATION_LOCKED', 'Another initialization is running; inspect the local init lock.'); throw error; }
    try {
      if (await inspectTarget(directory) !== 'empty-git') fail('TARGET_CHANGED', 'The initialization target changed concurrently.');
      return await populate(directory, assets, files, now);
    } finally { await rm(lock, { recursive: true }); }
  }
  const staging = await mkdtemp(join(dirname(directory), '.0721c-init-'));
  try {
    await git(staging, ['init', '--template=', '--initial-branch=main', '--object-format=sha1']);
    const output = await populate(staging, assets, files, now);
    await assertDirectory(directory, true);
    if (await inspectTarget(directory) !== target) fail('TARGET_CHANGED', 'The initialization target changed concurrently.');
    await rename(staging, directory);
    return { ...output, directory };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
