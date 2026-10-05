import { assertArticleId, ProtocolError } from '../core/index.mjs';

export const CONTENT_CONFIG_KEY = Symbol.for('0721c.content-config');
export const DEFAULT_CONTENT_OPTIONS = Object.freeze({ pathPrefixes: Object.freeze([]), markdownOnly: true });

function fail(message) { throw new ProtocolError('INVALID_CONTENT_CONFIG', message); }
export function normalizeContentOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('Content options must be an object');
  const prefixes = options.pathPrefixes ?? [];
  if (!Array.isArray(prefixes)) fail('pathPrefixes must be an array');
  const pathPrefixes = prefixes.map(prefix => {
    if (typeof prefix !== 'string' || !prefix.startsWith('/') || /[?#\\\u0000-\u001f\u007f]/u.test(prefix)) fail('Each path prefix must be an absolute content path');
    return prefix.replace(/\/+$/, '') || '/';
  });
  const markdownOnly = options.markdownOnly ?? true;
  if (typeof markdownOnly !== 'boolean') fail('markdownOnly must be boolean');
  return { pathPrefixes: [...new Set(pathPrefixes)], markdownOnly };
}
function field(document, name) {
  if (Object.hasOwn(document, name) && document[name] !== null && document[name] !== undefined) return document[name];
  const meta = document.meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) && Object.hasOwn(meta, name) ? meta[name] : undefined;
}
/** Use the real route as a readable directory and index filename. */
export function resolveContentArticle(document, options = {}) {
  if (document === null || document === undefined) return null;
  if (typeof document !== 'object' || Array.isArray(document)) fail('Content document must be an object');
  const { pathPrefixes, markdownOnly } = normalizeContentOptions(options);
  if (pathPrefixes.length) {
    if (typeof document.path !== 'string' || !pathPrefixes.some(prefix => prefix === '/' || document.path === prefix || document.path.startsWith(prefix + '/'))) return null;
  }
  if (markdownOnly && document.extension !== undefined && !['md', '.md'].includes(document.extension)) return null;
  const comments = field(document, 'comments');
  if (comments !== undefined && comments !== null && typeof comments !== 'boolean') fail('comments front matter must be boolean');
  if (comments === false) return null;
  const explicit = field(document, 'commentId');
  if (explicit !== undefined && explicit !== null) return { articleId: assertArticleId(explicit), identity: 'explicit' };
  for (const kind of ['path', 'stem']) {
    const value = document[kind];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > 4096 || /[?#\\]/.test(value)) fail('Content path must be a bounded URL pathname');
    const path = value.replace(/^\/|\/$/g, '');
    let decoded;
    try { decoded = path.split('/').map(segment => {
      const text = decodeURIComponent(segment).normalize('NFC');
      if (text.includes('/') || text.includes('\\')) fail('Encoded path separators are not allowed');
      return text;
    }).join('/'); } catch { fail('Content path contains invalid encoded segments'); }
    return { articleId: assertArticleId(decoded), identity: kind };
  }
  fail('Document has no URL path or stem');
}
