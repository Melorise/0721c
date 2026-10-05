import { createClient, buildCommentIssueUrl, buildCommentTree, validateSettings } from '0721c';
import type { CommentRecord, CommentsResult } from '0721c';
import { Comments0721c } from '0721c/vue';
import type { Comments0721cProps, Comments0721cExposed } from '0721c/vue';
import { h } from 'vue';

const client = createClient({
  repository: 'example-owner/site-comments',
  fetchImpl: async () => new Response('{}'),
});
const result: Promise<CommentsResult> = client.getComments('post-001', { force: true });
const url: string = buildCommentIssueUrl({ repository: 'example-owner/site-comments', articleId: 'post-001' });
const records: CommentRecord[] = [];
buildCommentTree(records, { maxReplyDepth: 32 });
validateSettings({ articlePolicy: { mode: 'open' } });
const props: Comments0721cProps = { repository: 'example-owner/site-comments', articleId: 'post-001', locale: 'zh-CN', timeZone: 'Asia/Shanghai' };
h(Comments0721c, props);
const refresh = (component: Comments0721cExposed): Promise<void> => component.refresh();
void [result, url, refresh];
// @ts-expect-error Article ID is required.
const incomplete: Comments0721cProps = { repository: 'example-owner/site-comments' };
// @ts-expect-error Repository cannot be an object.
createClient({ repository: { owner: 'example-owner', repo: 'site-comments' } });
// @ts-expect-error Only supported locales are accepted.
createClient({ repository: 'example-owner/site-comments', locale: 'unknown' });
void incomplete;

// Unified Nuxt Content API: generated document only, no per-post repository/ID.
import { ContentComments0721c, createContent0721c } from '0721c/nuxt-content';
import { resolveContentArticle } from '0721c/content';
h(ContentComments0721c, { document: { id: 'article/new.md', path: '/article/new', extension: 'md' } });
createContent0721c({ repository: 'example-owner/site-comments', timeZone: 'Asia/Shanghai', content: { pathPrefixes: ['/article'] } });
const generated = resolveContentArticle({ path: '/article/new' });
void generated;

client.getNewIssueUrl({ articleId: "post-001", article: { title: "文章标题", url: "https://blog.example/post" } });


// Repository email configuration and comment links.
import { buildCommentPermalink } from '0721c';
validateSettings({ site: { url: 'https://blog.example', name: 'Blog' }, notifications: { enabled: true, from: 'comments@example.com', notifyOwner: true, notifyReplies: true } });
buildCommentPermalink('https://blog.example/article', 'article/20261005T000000000Z-abcdef123456');
