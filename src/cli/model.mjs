import { fail } from './errors.mjs';

export const BRANCHES = Object.freeze(['main', 'comments', 'index']);
export const REQUIRED_FILES = Object.freeze([
  'README.md', '.github/ISSUE_TEMPLATE/config.yml',
  '.github/workflows/intake-comment.yml', '.github/workflows/validate-comment.yml',
  '.github/workflows/publish-index.yml', '.0721c/runtime/core/index.mjs',
  '.0721c/runtime/automation/github.mjs', '.0721c/runtime/automation/build-index.mjs',
  '.0721c/runtime/automation/intake-comment.mjs', '.0721c/runtime/automation/validate-comment.mjs',
  '.0721c/runtime/automation/publish-index.mjs', '.0721c/runtime/automation/notify-comment.mjs'
]);
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validPath = path => typeof path === 'string' && path.length > 0 &&
  !/[\\\x00-\x1f\x7f]/.test(path) && !path.startsWith('/') &&
  path.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
export const runtimeFile = path => /^\.0721c\/runtime\/(core|automation)\//.test(path) && /\.(mjs|d\.ts|d\.mts)$/.test(path);

export function parseJSON(text, path) {
  try { return JSON.parse(text); } catch { fail('INVALID_JSON', `Invalid JSON in ${path}.`, { path }); }
}

export function validateArticles(value, assertArticleId) {
  if (!isObject(value) || value.schema_version !== 1 || !isObject(value.articles) || Object.keys(value).some(key => !['schema_version', 'articles'].includes(key))) fail('INVALID_ARTICLES', 'Expected articles configuration {schema_version:1,articles:{...}}.');
  for (const [id, article] of Object.entries(value.articles)) {
    assertArticleId(id);
    if (!isObject(article) || typeof article.enabled !== 'boolean' || Object.keys(article).some(key => !['title', 'url', 'enabled'].includes(key)) || (article.title !== undefined && typeof article.title !== 'string')) fail('INVALID_ARTICLES', 'Invalid article entry.', { articleId: id });
    if (article.url !== undefined) {
      let url;
      try { url = new URL(article.url); } catch { fail('INVALID_ARTICLES', 'Invalid article URL.', { articleId: id }); }
      if (typeof article.url !== 'string' || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('INVALID_ARTICLES', 'Article URLs must be credential-free HTTP(S) URLs.', { articleId: id });
    }
  }
  return value;
}
