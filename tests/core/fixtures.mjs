import { buildCommentTree } from '../../src/core/index.mjs';
export function commentId(number, articleId = 'article/essay/2026-09-28-hello', createdAt = '2026-10-05T09:12:30Z') {
  return `${articleId}/${new Date(createdAt).toISOString().replace(/[-:.]/g, '')}-${number.toString(16).padStart(12, '0')}`;
}
export function record(number = 1, overrides = {}) {
  const blog_id = overrides.blog_id ?? 'article/essay/2026-09-28-hello';
  const created_at = overrides.created_at ?? '2026-10-05T09:12:30Z';
  const item = { id: commentId(number, blog_id, created_at), blog_id, reply_to: null,
    author: { login: `user-${number}`, avatar_url: `https://avatars.githubusercontent.com/u/${number}` },
    created_at, body_markdown: `Comment ${number} 😀` };
  return { ...item, ...overrides, author: { ...item.author, ...overrides.author } };
}
export function article(records = [record()], overrides = {}) {
  return { blog_id: records[0]?.blog_id ?? 'article/essay/2026-09-28-hello', comments_enabled: true, ...buildCommentTree(records), ...overrides };
}
export function metadataLine(metadata = { blog_id: 'article/essay/2026-09-28-hello', reply_to: null }) { return `<!-- 0721c-meta:${JSON.stringify(metadata)} -->`; }
export function jsonResponse(value, options = {}) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...options }); }
export function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; }
export async function turn() { await new Promise(resolve => setImmediate(resolve)); }
