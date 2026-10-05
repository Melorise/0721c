import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { parseIssueBody } from '../../src/core/index.mjs';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://host.invalid' });
const saved = new Map();
for (const name of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
const { createApp, h, reactive, nextTick } = await import('vue');
const { ContentComments0721c, createContent0721c, resolveContentArticle } = await import('../../src/content/vue.mjs');
after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });
async function until(predicate) { for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); await nextTick(); } assert.fail('Expected adapter DOM state'); }
function mount(t, doc = { id: 'article/new.md', path: '/article/new', extension: 'md' }, overrides = {}) {
  const calls = [];
  const fixture = { calls, fetchImpl: async (url, options) => { calls.push({url, options}); return new Response(null, {status:404}); } };
  const container = document.createElement('div'); document.body.append(container);
  const state = reactive({ document: doc });
  const config = reactive({ repository: 'fixtures/comments', locale: 'en', content: { pathPrefixes: ['/article'] }, fetchImpl: fixture.fetchImpl, ...overrides });
  const app = createApp({ render: () => h(ContentComments0721c, { document: state.document, class: 'host-comments' }) });
  app.use(createContent0721c(() => config)); app.mount(container);
  t.after(() => { app.unmount(); container.remove(); });
  return { fixture, container, state, config };
}
test('a shared page mount supplies only the queried document; repository and ID are automatic', async t => {
  const { fixture, container, state } = mount(t);
  await until(() => container.querySelector('.c0721c-post'));
  const link = new URL(container.querySelector('.c0721c-post').href);
  assert.equal(link.pathname, '/fixtures/comments/issues/new');
  assert.equal(parseIssueBody(link.searchParams.get('body')+'正文').metadata.blog_id, 'article/new');
  assert.ok(container.querySelector('.host-comments'));
  assert.equal(fixture.calls.length, 1);
});
test('switching the generated Markdown document automatically switches its comment identity', async t => {
  const { container, state } = mount(t);
  await until(() => container.querySelector('.c0721c-post'));
  const oldId = container.querySelector('section').dataset.articleId;
  state.document = { id: 'article/other.md', path: '/article/other', extension: 'md' };
  await until(() => container.querySelector('.c0721c-post') && container.querySelector('section').dataset.articleId !== oldId);
  assert.equal(container.querySelector('section').dataset.articleId, resolveContentArticle(state.document).articleId);
});
test('about pages, opt-out and blank instance config never mount or request comments', async t => {
  for (const [doc, config] of [
    [{ id: 'about.md', path: '/about' }, {}],
    [{ id: 'article/a.md', path: '/article/a', comments: false }, {}],
    [{ id: 'article/a.md', path: '/article/a' }, { repository: '' }],
    [{ id: 'article/a.md', path: '/article/a' }, { enabled: false }],
  ]) {
    const { container, fixture } = mount(t, doc, config);
    await nextTick(); assert.equal(container.children.length, 0); assert.equal(fixture.calls.length, 0);
  }
});
test('invalid front matter cannot break the article renderer or produce an unrelated ID', async t => {
  const { container, fixture } = mount(t, { id: 'article/a.md', path: '/article/a', commentId: '../invalid' });
  await until(() => container.querySelector('[role=alert]'));
  assert.equal(container.querySelector('section'), null); assert.equal(fixture.calls.length, 0);
  assert.doesNotMatch(container.textContent, /invalid\//);
});


test('article title and absolute permalink are automatic for root comments and document changes', async t => {
  const { container, state } = mount(t, { id: 'article/new.md', path: '/article/new', title: '真正的文章标题' }, { siteUrl: 'https://blog.example' });
  await until(() => container.querySelector('.c0721c-post'));
  let url = new URL(container.querySelector('.c0721c-post').href);
  assert.equal(url.searchParams.get('title'), 'Comment：真正的文章标题');
  assert.deepEqual(parseIssueBody(url.searchParams.get('body') + '正文').article, { title: '真正的文章标题', url: 'https://blog.example/article/new' });
  state.document = { id: 'article/next.md', path: '/article/next', title: '另一篇文章' };
  await until(() => container.querySelector('.c0721c-post')?.href.includes(encodeURIComponent('另一篇文章')));
  url = new URL(container.querySelector('.c0721c-post').href);
  assert.deepEqual(parseIssueBody(url.searchParams.get('body') + '正文').article, { title: '另一篇文章', url: 'https://blog.example/article/next' });
});

test('document comments inherit the configured display time zone', async t => {
  const { comment, snapshot } = await import('../vue/fixtures.mjs');
  const record = comment(1);
  const data = snapshot({ articleId: 'article/new', comments: [record] });
  const { container } = mount(t, undefined, {
    timeZone: 'Asia/Shanghai',
    fetchImpl: async () => new Response(JSON.stringify(data.index), { status: 200 }),
  });
  await until(() => container.querySelector('time'));
  const expected = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(record.created_at));
  assert.equal(container.querySelector('time').textContent, expected);
});


test('document comments inherit messages including invalid document warnings', async t => {
  const view = mount(t, undefined, {messages:{empty:'欢迎留言', post:'前往 GitHub 留言'}});
  await until(() => view.container.querySelector('.c0721c-empty'));
  assert.equal(view.container.querySelector('.c0721c-empty').textContent, '欢迎留言');
  assert.equal(view.container.querySelector('.c0721c-post').textContent, '前往 GitHub 留言');
  const bad = mount(t, {path:'/article/new', commentId:'../invalid'}, {messages:{invalidDocument:'请检查文章评论设置'}});
  await until(() => bad.container.querySelector('[role=alert]'));
  assert.equal(bad.container.querySelector('[role=alert]').textContent, '请检查文章评论设置');
  assert.equal(bad.fixture.calls.length, 0);
  view.config.messages.empty = '当前网络可以连接 GitHub';
  await nextTick();
  assert.equal(view.container.querySelector('.c0721c-empty').textContent, '当前网络可以连接 GitHub');
  assert.equal(view.fixture.calls.length, 1);
});
