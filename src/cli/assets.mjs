import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { fail } from './errors.mjs';
import { parseJSON, validateArticles, validPath, REQUIRED_FILES } from './model.mjs';

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function textFiles(root, prefix = '') {
  const output = {};
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') fail('INCOMPLETE_PACKAGE', 'A required template or runtime directory is missing.', { path: root });
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!validPath(path) || entry.isSymbolicLink()) fail('UNSAFE_PACKAGE', 'Deployment assets must have ordinary relative paths.', { path });
    if (entry.isDirectory()) Object.assign(output, await textFiles(join(root, entry.name), path));
    else if (entry.isFile()) output[path] = await readFile(join(root, entry.name), 'utf8');
    else fail('UNSAFE_PACKAGE', 'Unsupported deployment asset type.', { path });
  }
  return output;
}

export async function packageVersion(packageRoot = PACKAGE_ROOT) {
  const metadata = parseJSON(await readFile(join(packageRoot, 'package.json'), 'utf8'), 'package.json');
  if (typeof metadata.version !== 'string' || !metadata.version) fail('INVALID_PACKAGE_VERSION', 'The installed package must have a version.');
  return metadata.version;
}

export async function loadAssets({ packageRoot = PACKAGE_ROOT } = {}) {
  const root = resolve(packageRoot);
  const version = await packageVersion(root);
  const core = await import(pathToFileURL(join(root, 'src/core/index.mjs')).href);
  const main = await textFiles(join(root, 'templates/deployment/main'));
  const comments = await textFiles(join(root, 'templates/deployment/comments'));
  const index = await textFiles(join(root, 'templates/deployment/index'));
  for (const path of Object.keys(main)) {
    if (path !== 'README.md' && !path.startsWith('.github/') && !['config/settings.json', 'config/articles.json'].includes(path)) fail('UNSAFE_PACKAGE', 'Unexpected main template asset.', { path });
  }
  for (const area of ['core', 'automation']) {
    for (const [path, text] of Object.entries(await textFiles(join(root, 'src', area)))) {
      if (!/\.(mjs|d\.ts|d\.mts)$/.test(path)) fail('UNSAFE_PACKAGE', 'Runtime assets must be ESM or declaration files.', { path });
      main[`.0721c/runtime/${area}/${path}`] = text;
    }
  }
  for (const path of REQUIRED_FILES.concat('config/settings.json')) {
    if (!Object.hasOwn(main, path)) fail('INCOMPLETE_PACKAGE', 'A required deployment file is missing.', { path });
  }
  for (const [branch, files] of Object.entries({ comments, index })) {
    if (Object.keys(files).length !== 1 || !Object.hasOwn(files, 'README.md')) fail('UNSAFE_PACKAGE', 'Initial data branches must contain README.md only.', { branch });
  }
  const settings = core.validateSettings(parseJSON(main['config/settings.json'], 'config/settings.json'));
  const articles = validateArticles(main['config/articles.json'] === undefined ? { schema_version: 1, articles: {} } : parseJSON(main['config/articles.json'], 'config/articles.json'), core.assertArticleId);
  const managed = Object.fromEntries(Object.entries(main).filter(([path]) => !path.startsWith('config/')));
  return { root, version, core, main, managed, comments, index, settings, articles };
}
