import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { chain, comment, deferred, jsonResponse, layoutSnapshot, snapshot, transport } from './fixtures.mjs';

// Vue runtime-dom captures document at module evaluation, before any mounting.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://host.invalid/article' });
const saved = new Map();
for (const name of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
const savedFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Live fetch forbidden in Vue tests.'); };
const { createApp, createSSRApp, h, nextTick, reactive } = await import('vue');
const { renderToString } = await import('vue/server-renderer');
const { Comments0721c } = await import('../../src/vue/index.mjs');
const { parseIssueBody } = await import('../../src/core/index.mjs');

after(() => {
  globalThis.fetch = savedFetch;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  dom.window.close();
});

async function until(predicate, message = 'Expected DOM state', timeout = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await nextTick();
  }
}

function mount(t, overrides = {}, slots = {}, fixture = transport()) {
  const container = document.createElement('div');
  document.body.append(container);
  const props = reactive({ repository: 'fixtures/comments', articleId: 'article/essay/slug', locale: 'en', fetchImpl: fixture.fetchImpl, ...overrides });
  let exposed;
  const app = createApp({ render: () => h(Comments0721c, { ...props, ref: (value) => { exposed = value; } }, slots) });
  app.mount(container);
  t.after(() => { app.unmount(); container.remove(); });
  return { container, props, fixture, app, get exposed() { return exposed; } };
}

function metadata(link) {
  const url = new URL(link.href);
  const first = url.searchParams.get('body').split('\n')[0];
  const match = /^<!--\s*0721c-meta:\s*(\{.*\})\s*-->$/.exec(first);
  assert.ok(match, 'The core helper must emit the reserved metadata comment.');
  return JSON.parse(match[1]);
}

test('open unknown article is empty and has a direct, correctly prefilled root link', async (t) => {
  const fixture = transport(snapshot(), 404);
  const { container } = mount(t, {}, {}, fixture);
  await until(() => container.querySelector('[data-state="empty"]'));
  assert.equal(fixture.calls.length, 1);
  assert.ok(container.querySelector('.c0721c-empty'));
  const post = container.querySelector('.c0721c-post');
  assert.equal(new URL(post.href).pathname, '/fixtures/comments/issues/new');
  assert.deepEqual(metadata(post), { blog_id: 'article/essay/slug', reply_to: null });
  assert.equal(post.target, '_blank');
  assert.ok(post.rel.includes('noopener'));
  assert.equal(container.querySelectorAll('textarea,input,form').length, 0);
  assert.match(container.querySelector('[role="status"]').textContent, /No comments/);
});

test('explicit disabled article index hides submission; approved history remains visible', async (t) => {
  const absent = mount(t, {}, {}, transport(snapshot({ enabled: false })));
  await until(() => absent.container.querySelector('[data-state="disabled"]'));
  assert.equal(absent.container.querySelector('.c0721c-post'), null);
  assert.match(absent.container.querySelector('[role="status"]').textContent, /closed/);
  const fixture = transport(snapshot({ comments: [comment(1)], enabled: false }));
  const history = mount(t, {}, {}, fixture);
  await until(() => history.container.querySelector('.c0721c-comment'));
  assert.equal(history.container.querySelector('section').dataset.state, 'disabled');
  assert.equal(history.container.querySelectorAll('.c0721c-reply,.c0721c-post').length, 0);
  assert.equal(history.container.querySelector('.c0721c-source'), null);
});

test('local load failure exposes retry, then recovers without showing a false empty state', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  fixture.fail(new Error('fixture network failure'));
  const { container } = mount(t, {}, {}, fixture);
  await until(() => container.querySelector('[data-state="error"]'));
  assert.equal(container.querySelector('.c0721c-empty'), null);
  assert.equal(container.querySelector('.c0721c-post'), null);
  assert.match(container.querySelector('[role="status"]').textContent, /Unable to load/);
  fixture.fail(null);
  container.querySelector('.c0721c-retry').click();
  await until(() => container.querySelector('[data-state="ready"]'));
  assert.equal(container.querySelector('.c0721c-error'), null);
  assert.equal(container.querySelector('.c0721c-count').textContent, '1');
});

test('malformed, mismatched and non-404 HTTP failures remain errors', async (t) => {
  for (const mode of ['malformed', 'mismatch', 'http500', 'invalidJson']) {
    const data = snapshot({ comments: [comment(1)] });
    if (mode === 'mismatch') data.index.blog_id = 'article/notes/slug';
    const fetchImpl = async () => {
      if (mode === 'malformed') return jsonResponse({ comments: [] });
      if (mode === 'http500') return jsonResponse({}, 500);
      if (mode === 'invalidJson') return new Response('{');
      return jsonResponse(data.index);
    };
    const { container } = mount(t, { fetchImpl });
    await until(() => container.querySelector('[data-state="error"]'), mode);
    assert.equal(container.querySelector('.c0721c-empty'), null);
    assert.equal(container.querySelector('.c0721c-comment'), null);
  }
});

test('refresh reloads the direct article index; failure retains history and announces it', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const view = mount(t, {}, {}, fixture);
  await until(() => view.container.querySelector('.c0721c-comment'));
  assert.equal(fixture.calls.length, 1);
  fixture.setSnapshot(snapshot({ comments: [comment(1), comment(2)] }));
  await view.exposed.refresh();
  await nextTick();
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.calls[1].options.cache, 'no-store');
  assert.equal(fixture.calls[2].options.cache, 'no-store');
  assert.equal(view.container.querySelectorAll('.c0721c-comment').length, 2);
  fixture.fail(new Error('offline'));
  await view.exposed.refresh();
  await nextTick();
  assert.equal(view.container.querySelectorAll('.c0721c-comment').length, 2);
  assert.equal(view.container.querySelector('section').dataset.state, 'ready');
  assert.match(view.container.querySelector('.c0721c-error').textContent, /Refresh failed/);
  assert.match(view.container.querySelector('[role="status"]').textContent, /Refresh failed/);
});

test('refreshing keeps readable history, marks busy and disables duplicate controls', async (t) => {
  const data = snapshot({ comments: [comment(1)] });
  const gate = deferred();
  let held = false;
  const fetchImpl = async (url) => {
    if (held) await gate.promise;
    if (new URL(url).hostname === 'api.github.com') return jsonResponse({ ref: 'refs/heads/index', object: { type: 'commit', sha: 'a'.repeat(40) } });
    return jsonResponse(data.index);
  };
  const view = mount(t, { fetchImpl });
  await until(() => view.container.querySelector('.c0721c-comment'));
  held = true;
  const pending = view.exposed.refresh();
  await nextTick();
  assert.equal(view.container.querySelector('section').getAttribute('aria-busy'), 'true');
  assert.ok(view.container.querySelector('.c0721c-refresh').disabled);
  assert.ok(view.container.querySelector('.c0721c-comment'));
  assert.match(view.container.querySelector('[role="status"]').textContent, /Refreshing/);
  assert.match(view.container.querySelector('.c0721c-refreshing').textContent, /Refreshing/);
  gate.resolve();
  await pending;
});

test('first page contains 20 roots plus their complete replies, then expands locally with focus', async (t) => {
  const roots = Array.from({ length: 21 }, (_, index) => comment(index + 1));
  roots[0].children.push(comment(50, { reply_to: roots[0].id }));
  const fixture = transport(snapshot({ comments: roots }));
  const { container } = mount(t, {}, {}, fixture);
  await until(() => container.querySelectorAll('.c0721c-item').length === 21);
  assert.equal(container.querySelectorAll('[data-depth="0"]').length, 20);
  assert.equal(container.querySelector('.c0721c-count').textContent, '22');
  const more = container.querySelector('.c0721c-more');
  assert.equal(more.tagName, 'BUTTON');
  assert.match(more.textContent, /1 more/);
  more.focus();
  more.click();
  await until(() => container.querySelectorAll('[data-depth="0"]').length === 21);
  await nextTick();
  assert.equal(container.querySelector('.c0721c-more'), null);
  assert.equal(document.activeElement.closest('li').dataset.commentId, roots[20].id);
  assert.equal(fixture.calls.length, 1);
});

test('every reply uses its exact comment ID and parent links point to the right accessible article', async (t) => {
  const root = chain(4);
  const { container } = mount(t, {}, {}, transport(snapshot({ comments: [root] })));
  await until(() => container.querySelectorAll('.c0721c-item').length === 5);
  for (const item of container.querySelectorAll('.c0721c-item')) {
    const reply = item.querySelector('.c0721c-reply');
    assert.deepEqual(metadata(reply), { blog_id: 'article/essay/slug', reply_to: item.dataset.commentId });
    assert.ok(reply.rel.includes('noopener'));
    const parent = item.querySelector('.c0721c-parent');
    if (item.dataset.replyTo) {
      const target = document.getElementById(parent.hash.slice(1));
      assert.equal(target.closest('li').dataset.commentId, item.dataset.replyTo);
      assert.equal(target.tabIndex, -1);
    } else assert.equal(parent, null);

  }
});

test('64-deep replies cap desktop/mobile indentation without hiding text or parent context', async (t) => {
  const root = chain(64);
  const leaf = (() => { let node = root; while (node.children.length) node = node.children[0]; return node; })();
  leaf.body_markdown = `${'长'.repeat(7700)}\n\n\`https://example.invalid/${'x'.repeat(200)}\`\n\nTHE-END`;
  const { container } = mount(t, {}, {}, transport(snapshot({ comments: [root] })));
  await until(() => container.querySelectorAll('.c0721c-item').length === 65);
  const deepest = container.querySelector('[data-depth="64"]');
  assert.equal(deepest.style.getPropertyValue('--0721c-depth'), '1');
  assert.equal(deepest.style.getPropertyValue('--0721c-mobile-depth'), '1');
  assert.ok(deepest.querySelector('.c0721c-parent'));
  await until(() => deepest.querySelector('.c0721c-body code'));
  assert.ok(deepest.querySelector('.c0721c-body').textContent.includes('长'.repeat(7700)));
  assert.match(deepest.querySelector('.c0721c-body').textContent, /THE-END/);
});

test('broken or missing avatars fall back to text while the comment remains usable', async (t) => {
  const a = comment(1);
  const b = comment(2, { author: { login: 'second' } });
  const { container } = mount(t, {}, {}, transport(snapshot({ comments: [a, b] })));
  await until(() => container.querySelectorAll('.c0721c-avatar').length === 2);
  const avatar = container.querySelector('.c0721c-avatar');
  assert.equal(avatar.getAttribute('role'), 'img');
  assert.equal(avatar.querySelector('img').getAttribute('referrerpolicy'), 'no-referrer');
  avatar.querySelector('img').dispatchEvent(new window.Event('error'));
  await nextTick();
  assert.equal(avatar.querySelector('img'), null);
  assert.equal(avatar.textContent, 'U');
  assert.equal(container.querySelectorAll('.c0721c-avatar-fallback').length, 2);
  assert.equal(container.querySelectorAll('.c0721c-reply').length, 2);
});

test('renderer sanitizes client bodies without executing HTML or loading Markdown images', async (t) => {
  const body = '<img src=x onerror="globalThis.pwned=1">\n\n![image](https://attacker.invalid/track.png)\n\n[bad](javascript:alert(1))\n\n**safe**';
  const { container } = mount(t, {}, {}, transport(snapshot({ comments: [comment(1, { body_markdown: body })] })));
  await until(() => container.querySelector('.c0721c-body strong'));
  const rendered = container.querySelector('.c0721c-body');
  assert.equal(rendered.querySelectorAll('img,script,iframe,svg').length, 0);
  assert.equal(rendered.querySelector('a').href, 'https://attacker.invalid/track.png');
  assert.ok(rendered.textContent.includes('<img src=x'));
  assert.equal(globalThis.pwned, undefined);
});

test('changing articles aborts old requests and late responses cannot replace the new tree', async (t) => {
  const oldData = snapshot({ articleId: 'article/essay/slug', comments: [comment(1)] });
  const newData = snapshot({ articleId: 'article/notes/slug', comments: [comment(2)] });
  const oldGate = deferred();
  const signals = [];
  const fetchImpl = async (url, options) => {
    signals.push(options.signal);
    if (url.endsWith('/article/essay/slug.json')) return oldGate.promise;
    assert.ok(url.endsWith('/article/notes/slug.json'));
    return jsonResponse(newData.index);
  };
  const view = mount(t, { fetchImpl });
  await until(() => signals.length === 1);
  view.props.articleId = 'article/notes/slug';
  await until(() => view.container.querySelector('.c0721c-comment'));
  assert.equal(signals[0].aborted, true);
  assert.equal(view.container.querySelector('.c0721c-author').textContent, '@user-2');
  oldGate.resolve(jsonResponse(oldData.index));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(view.container.querySelector('.c0721c-author').textContent, '@user-2');
  assert.equal(metadata(view.container.querySelector('.c0721c-post')).blog_id, 'article/notes/slug');
});

test('repository switches use a new client and separate instances keep their submission links', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const a = mount(t, {}, {}, fixture);
  const b = mount(t, { repository: 'second/comments' }, {}, transport(snapshot({ comments: [comment(1)] })));
  await until(() => a.container.querySelector('.c0721c-comment') && b.container.querySelector('.c0721c-comment'));
  assert.match(b.container.querySelector('.c0721c-post').href, /second\/comments/);
  a.props.repository = 'third/comments';
  await until(() => a.container.querySelector('.c0721c-post')?.href.includes('third/comments'));
  assert.ok(fixture.calls.some(({ url }) => url.includes('/third/comments/index/')));
  assert.match(a.container.querySelector('.c0721c-post').href, /third\/comments/);
});

test('unmount cancels the active request and tolerates a response that ignores cancellation', async (t) => {
  const gate = deferred();
  let signal;
  const view = mount(t, { fetchImpl: async (url, options) => { signal = options.signal; return gate.promise; } });
  await until(() => signal);
  view.app.unmount();
  assert.equal(signal.aborted, true);
  gate.resolve(jsonResponse(snapshot().index));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(view.container.innerHTML, '');
});

test('locale, footer slot, exposed refresh and custom mirror use the direct core contract', async (t) => {
  const seen = [];
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const view = mount(t, { locale: 'zh-CN', title: '讨论', indexBaseUrl: 'https://mirror.invalid/custom/', cacheTtlMs: 0 }, {
    footer: (context) => { seen.push(context); return h('p', { class: 'custom-footer' }, String(context.totalCount)); },
  }, fixture);
  await until(() => view.container.querySelector('.custom-footer'));
  assert.equal(view.container.querySelector('h2').textContent, '讨论1');
  assert.match(view.container.querySelector('[role="status"]').textContent, /1 条评论/);
  assert.deepEqual(fixture.calls.map(({ url }) => url), ['https://mirror.invalid/custom/article/essay/slug.json']);
  assert.ok(fixture.calls.every(({ options }) => options.credentials === 'omit'));
  assert.equal(metadata(view.container.querySelector('.c0721c-reply')).reply_to, comment(1).id);
  assert.equal(seen.at(-1).articleId, 'article/essay/slug');
  assert.equal(seen.at(-1).rootCount, 1);
  assert.equal(seen.at(-1).canComment, true);
  assert.equal(seen.at(-1).refresh, view.exposed.refresh);
  view.container.querySelector('.c0721c-refresh').click();
  await until(() => fixture.calls.length === 2);
});

test('only the custom footer slot is invoked; built-in states and actions remain usable', async (t) => {
  let calls = 0;
  const removed = Object.fromEntries(['header', 'loading', 'empty', 'disabled', 'error', 'avatar', 'comment-header', 'comment-footer'].map(name => [name, () => { calls++; return h('p', 'Unexpected replacement'); }]));
  const populated = mount(t, {}, removed, transport(snapshot({ comments: [comment(1)] })));
  await until(() => populated.container.querySelector('.c0721c-reply'));
  assert.ok(populated.container.querySelector('.c0721c-refresh svg'));
  assert.equal(populated.container.querySelector('.c0721c-source'), null);
  const broken = transport();
  broken.fail(new Error('offline-fixture'));
  const failed = mount(t, {}, removed, broken);
  await until(() => failed.container.querySelector('.c0721c-retry'));
  assert.equal(failed.container.querySelector('[role="status"]').getAttribute('aria-live'), 'polite');
  const closed = mount(t, {}, removed, transport(snapshot({ enabled: false })));
  await until(() => closed.container.querySelector('.c0721c-disabled'));
  const empty = mount(t, {}, removed);
  await until(() => empty.container.querySelector('.c0721c-empty'));
  assert.equal(calls, 0);
});

test('SSR markup hydrates without mismatch and fetches only after mounting', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const props = { repository: 'fixtures/comments', articleId: 'article/essay/slug', locale: 'en', fetchImpl: fixture.fetchImpl };
  const render = () => h(Comments0721c, props);
  const html = await renderToString(createSSRApp({ render }));
  assert.equal(fixture.calls.length, 0);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const warnings = [];
  const app = createSSRApp({ render });
  app.config.warnHandler = (message) => warnings.push(message);
  app.mount(container);
  t.after(() => { app.unmount(); container.remove(); });
  await until(() => container.querySelector('.c0721c-comment'));
  assert.deepEqual(warnings, []);
  assert.equal(fixture.calls.length, 1);
  const section = container.querySelector('section');
  assert.equal(document.getElementById(section.getAttribute('aria-labelledby')).tagName, 'H2');
});

test('invalid public configuration produces a contained local error', async (t) => {
  for (const overrides of [{ repository: 'https://evil.invalid/repo' }, { articleId: '../post' }, { locale: 'invalid' }, { cacheTtlMs: -1 }]) {
    const fixture = transport();
    const { container } = mount(t, overrides, {}, fixture);
    await until(() => container.querySelector('[data-state="error"]'));
    assert.equal(fixture.calls.length, 0);
    assert.equal(container.querySelector('.c0721c-post'), null);
  }
});


test('two components in the same Vue app give identical comment IDs distinct anchor targets', async (t) => {
  const fixtureA = transport(snapshot({ comments: [chain(1)] }));
  const fixtureB = transport(snapshot({ comments: [chain(1)] }));
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render: () => h('div', [
    h(Comments0721c, { repository: 'first/comments', articleId: 'article/essay/slug', fetchImpl: fixtureA.fetchImpl }),
    h(Comments0721c, { repository: 'second/comments', articleId: 'article/essay/slug', fetchImpl: fixtureB.fetchImpl }),
  ]) });
  app.mount(container);
  t.after(() => { app.unmount(); container.remove(); });
  await until(() => container.querySelectorAll('.c0721c-comment').length === 4);
  const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of container.querySelectorAll('section')) {
    const parent = section.querySelector('.c0721c-parent');
    assert.ok(section.contains(document.getElementById(parent.hash.slice(1))));
  }
});


test('default UI has no explanatory footer in either locale, empty or populated', async (t) => {
  for (const locale of ['zh-CN', 'en']) {
    for (const comments of [[], [comment(1)]]) {
      const view = mount(t, { locale }, {}, transport(snapshot({ comments })));
      await until(() => view.container.querySelector(`[data-state="${comments.length ? 'ready' : 'empty'}"]`));
      assert.equal(view.container.querySelector('.c0721c-footer'), null);
      assert.doesNotMatch(view.container.textContent, /隐私|密钥|后续编辑|private information|secrets|later Issue edits/);
      assert.ok(view.container.querySelector('.c0721c-post'));
    }
  }
});


test('reply forms retain readable article context and the exact parent comment identity', async t => {
  const parent = comment(1);
  const view = mount(t, { articleTitle: '文章标题', articleUrl: 'https://blog.example/post' }, {}, transport(snapshot({ comments: [parent] })));
  await until(() => view.container.querySelector('.c0721c-reply'));
  const url = new URL(view.container.querySelector('.c0721c-reply').href);
  const parsed = parseIssueBody(url.searchParams.get('body') + '回复正文');
  assert.equal(parsed.metadata.reply_to, parent.id);
  assert.deepEqual(parsed.article, { title: '文章标题', url: 'https://blog.example/post' });
});


test('avatar sits beside all content; inline metadata and refresh have accessible controls', async (t) => {
  const view = mount(t, {}, {}, transport(snapshot({ comments: [chain(1)] })));
  await until(() => view.container.querySelectorAll('.c0721c-comment').length === 2);
  const refresh = view.container.querySelector('.c0721c-refresh');
  assert.equal(refresh.tagName, 'BUTTON');
  assert.equal(refresh.getAttribute('aria-label'), 'Refresh');
  assert.equal(refresh.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(refresh.querySelector('svg').getAttribute('width'), '20');
  assert.deepEqual([...refresh.querySelectorAll('path')].map(path => path.getAttribute('d')), [
    'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5',
  ]);
  assert.equal(refresh.tabIndex, 0);
  for (const item of view.container.querySelectorAll('.c0721c-comment')) {
    assert.ok(item.firstElementChild.matches('.c0721c-avatar'));
    const main = item.querySelector(':scope > .c0721c-main');
    assert.ok(main.contains(item.querySelector('.c0721c-body')));
    const meta = main.querySelector('.c0721c-comment-meta');
    assert.ok(meta.querySelector('.c0721c-author'));
    assert.ok(meta.querySelector('time[datetime]'));
    assert.equal(main.querySelector('.c0721c-reply').tabIndex, 0);
  }
  const parent = view.container.querySelector('.c0721c-parent');
  parent.focus();
  parent.click();
  assert.equal(document.activeElement.id, parent.hash.slice(1));
  assert.equal(view.container.querySelectorAll('textarea,input,form,[contenteditable]').length, 0);
});


test('visual fixture keeps long CJK paragraphs and three-level replies complete in shallow columns', async (t) => {
  const data = layoutSnapshot();
  const view = mount(t, { locale: 'zh-CN' }, {}, transport(data));
  await until(() => view.container.querySelectorAll('.c0721c-body strong').length === 4);
  assert.equal(view.container.querySelectorAll('.c0721c-item').length, 5);
  assert.equal(view.container.querySelectorAll('.c0721c-parent').length, 3);
  for (const item of view.container.querySelectorAll('.c0721c-item')) {
    const depth = Number(item.dataset.depth);
    assert.equal(item.style.getPropertyValue('--0721c-depth'), String(Math.min(depth, 1)));
    assert.equal(item.style.getPropertyValue('--0721c-mobile-depth'), String(Math.min(depth, 1)));
    const main = item.querySelector('.c0721c-main');
    assert.ok(main.querySelector('p'));
    if (depth) assert.equal(main.querySelector('.c0721c-parent').tabIndex, 0);
  }
  assert.ok(view.container.querySelector('[data-depth="0"] .c0721c-body').textContent.includes('长篇中文段落应当自然换行，头像位于左侧，正文始终拥有足够的宽度。'.repeat(12)));
  assert.match(view.container.querySelector('[data-depth="3"] .c0721c-body').textContent, /最后一段完整可读/);
});

test('timeZone formats roots and replies across calendar boundaries and keeps UTC datetime', async (t) => {
  const root = comment(1, { created_at: '2026-10-02T23:30:00Z' });
  root.children = [comment(2, { created_at: '2026-10-03T00:00:00Z', reply_to: root.id })];
  const fixture = transport(snapshot({ comments: [root] }));
  const view = mount(t, { timeZone: 'Asia/Shanghai' }, {}, fixture);
  await until(() => view.container.querySelectorAll('time').length === 2);
  const format = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' });
  for (const [index, record] of [root, ...root.children].entries()) {
    const element = view.container.querySelectorAll('time')[index];
    assert.equal(element.dateTime, record.created_at);
    assert.equal(element.textContent, format.format(new Date(record.created_at)));
    assert.equal(element.title, element.textContent + ' (Asia/Shanghai)');
  }
  assert.equal(fixture.calls.length, 1);
});

test('changing the display time zone rerenders without fetching and observes daylight saving', async (t) => {
  const records = [
    comment(1, { created_at: '2026-01-15T12:00:00Z' }),
    comment(2, { created_at: '2026-07-15T12:00:00Z' }),
  ];
  const fixture = transport(snapshot({ comments: records }));
  const view = mount(t, { timeZone: 'UTC' }, {}, fixture);
  await until(() => view.container.querySelectorAll('time').length === 2);
  view.props.timeZone = 'America/New_York';
  await nextTick();
  const elements = [...view.container.querySelectorAll('time')];
  const format = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
  assert.deepEqual(elements.map(element => element.textContent), records.map(record => format.format(new Date(record.created_at))));
  assert.match(elements[0].textContent, /7:00/);
  assert.match(elements[1].textContent, /8:00/);
  assert.ok(elements.every(element => element.title.endsWith('(America/New_York)')));
  assert.equal(fixture.calls.length, 1);
});

test('omitted or empty timeZone uses the visitor default rather than hardcoded UTC', async (t) => {
  const previous = process.env.TZ;
  process.env.TZ = 'Pacific/Honolulu';
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  const record = comment(1, { created_at: '2026-10-02T03:00:00Z' });
  const fixture = transport(snapshot({ comments: [record] }));
  const view = mount(t, {}, {}, fixture);
  await until(() => view.container.querySelector('time'));
  const expected = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Honolulu' }).format(new Date(record.created_at));
  assert.equal(view.container.querySelector('time').textContent, expected);
  assert.match(view.container.querySelector('time').title, /Pacific\/Honolulu/);
  view.props.timeZone = '';
  await nextTick();
  assert.equal(view.container.querySelector('time').textContent, expected);
  assert.equal(fixture.calls.length, 1);
});

test('invalid timeZone reports configuration error and can recover without a broken render', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const view = mount(t, { timeZone: 'Not/A_TimeZone' }, {}, fixture);
  await until(() => view.container.querySelector('[role=alert]'));
  assert.match(view.container.textContent, /timeZone/);
  assert.equal(fixture.calls.length, 0);
  view.props.timeZone = 'Asia/Shanghai';
  await until(() => view.container.querySelector('time'));
  assert.equal(fixture.calls.length, 1);
  view.props.timeZone = 'Not/A_TimeZone';
  await nextTick();
  assert.ok(view.container.querySelector('[role=alert]'));
  view.props.timeZone = 'UTC';
  await nextTick();
  assert.ok(view.container.querySelector('time'));
  assert.equal(fixture.calls.length, 1);
});


test('a comment permalink reveals a root beyond the first page and focuses a nested reply', async t => {
  const roots = Array.from({ length: 45 }, (_, index) => comment(index + 1));
  const target = comment(100, { reply_to: roots[40].id });
  roots[40].children.push(target);
  window.history.replaceState({}, '', '/article?comment=' + encodeURIComponent(target.id));
  t.after(() => window.history.replaceState({}, '', '/article'));
  const { container } = mount(t, {}, {}, transport(snapshot({ comments: roots })));
  await until(() => document.activeElement?.id.includes(target.id));
  assert.ok(container.querySelector(`[data-comment-id="${target.id}"]`));
  assert.equal(container.querySelectorAll('.c0721c-item').length, 46);
});

test('unknown comment query does not expand unrelated threads or break the component', async t => {
  window.history.replaceState({}, '', '/article?comment=unknown');
  t.after(() => window.history.replaceState({}, '', '/article'));
  const fixture = transport(snapshot({ comments: Array.from({ length: 25 }, (_, i) => comment(i + 1)) }));
  const { container } = mount(t, {}, {}, fixture);
  await until(() => container.querySelector('[data-state="ready"]'));
  assert.equal(container.querySelectorAll('.c0721c-item').length, 20);
});


test('clicking Refresh bypasses a stale raw branch response and renders newly published comments', async t => {
  const old = snapshot({ comments: [comment(1)] });
  const latest = snapshot({ comments: [comment(1), comment(2)] });
  const sha = 'b'.repeat(40);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const target = new URL(url);
    if (target.hostname === 'api.github.com') return jsonResponse({ ref: 'refs/heads/index', object: { type: 'commit', sha } });
    return jsonResponse(target.pathname.includes('/' + sha + '/') ? latest.index : old.index);
  };
  const { container } = mount(t, { fetchImpl });
  await until(() => container.querySelector('.c0721c-comment'));
  assert.equal(container.querySelectorAll('.c0721c-comment').length, 1);
  container.querySelector('.c0721c-refresh').click();
  await until(() => container.querySelectorAll('.c0721c-comment').length === 2);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.cache, 'no-store');
  assert.ok(calls[2].url.includes('/' + sha + '/'));
  assert.equal(calls[2].options.cache, 'no-store');
});
