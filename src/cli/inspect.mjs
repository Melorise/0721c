import { fail } from './errors.mjs';
import { parseJSON, validateArticles } from './model.mjs';

export function checkRepository(repo) {
  if (repo.private !== false || repo.visibility !== undefined && repo.visibility !== 'public') fail('PUBLIC_REPOSITORY_REQUIRED', 'A public comment repository is required.');
  if (repo.archived || repo.disabled || repo.fork) fail('UNSUITABLE_REPOSITORY', 'The repository must be active and independent.');
}

export async function configuration(store, snapshot, core) {
  const settings = await store.read(snapshot, 'config/settings.json');
  if (settings === null) fail('MISSING_CONFIGURATION', 'config/settings.json is missing.');
  const articles = await store.read(snapshot, 'config/articles.json');
  return {
    settings: core.validateSettings(parseJSON(settings, 'config/settings.json')),
    articles: validateArticles(articles === null ? { schema_version: 1, articles: {} } : parseJSON(articles, 'config/articles.json'), core.assertArticleId)
  };
}

export async function dataFormat(store, snapshot, core, branch) {
  for (const path of Object.keys(snapshot.entries)) {
    if (path === 'README.md') continue;
    if (!path.endsWith('.json')) fail('INVALID_DATA_FILE', 'Data branches contain JSON files only.', { path });
    const value = parseJSON(await store.read(snapshot, path), path);
    if (branch === 'comments') {
      const record = core.validateCommentRecord(value);
      if (path !== `${record.id}.json`) fail('INVALID_DATA_PATH', 'The comment record must match its file path.', { path });
    } else {
      const index = core.validateArticleIndex(value);
      if (path !== `${index.blog_id}.json`) fail('INVALID_DATA_PATH', 'The article index must match its file path.', { path });
    }
  }
  return true;
}
