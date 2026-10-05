import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { comment, deferred, jsonResponse, snapshot, transport } from './fixtures.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://host.invalid/article' });
const saved = new Map();
for (const name of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Live fetch forbidden in configuration tests.'); };
const { computed, createApp, createSSRApp, h, isReadonly, isRef, nextTick, reactive, ref } = await import('vue');
const { renderToString } = await import('vue/server-renderer');
const { Comments0721c, create0721c, provide0721cConfig, use0721cConfig } = await import('../../src/vue/index.mjs');

after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  dom.window.close();
});

async function until(predicate, message = 'Expected configured DOM state', timeout = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await nextTick();
  }
}

function mount(t, source, overrides = {}, slots = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const props = reactive({ articleId: 'article/essay/slug', ...overrides });
  let config, component;
  const app = createApp({
    setup() { config = use0721cConfig(); return () => h(Comments0721c, { ...props, ref: (value) => { component = value; } }, slots); },
  });
  if (source !== undefined) app.use(create0721c(source));
  app.mount(container);
  t.after(() => { app.unmount(); container.remove(); });
  return { app, props, container, get config() { return config; }, get component() { return component; } };
}

function metadata(link) {
  const body = new URL(link.href).searchParams.get('body');
  return JSON.parse(/^<!--\s*0721c-meta:\s*(\{.*\})\s*-->/.exec(body)[1]);
}

test('installing app config once supplies repository-free components and merged computed defaults', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const view = mount(t, { repository: 'configured/comments', fetchImpl: fixture.fetchImpl });
  assert.ok(isRef(view.config));
  assert.ok(isReadonly(view.config));
  assert.ok(Object.isFrozen(view.config.value));
  assert.equal(view.config.value.repository, 'configured/comments');
  assert.equal(view.config.value.locale, 'zh-CN');
  assert.equal(view.config.value.cacheTtlMs, 60000);
  assert.equal(view.config.value.enabled, true);
  await until(() => view.container.querySelector('[data-state="ready"]'));
  assert.equal(view.container.querySelector('h2').textContent, '评论1');
  assert.match(view.container.querySelector('.c0721c-post').href, /configured\/comments\/issues\/new/);
  assert.deepEqual(metadata(view.container.querySelector('.c0721c-post')), { blog_id: 'article/essay/slug', reply_to: null });
  assert.equal(fixture.calls.length, 1);
});

test('provider locale, mirror and zero cache survive undefined props', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const view = mount(t, {
    repository: 'configured/comments', locale: 'en', cacheTtlMs: 0,
    indexBaseUrl: 'https://mirror.invalid/configured/', fetchImpl: fixture.fetchImpl,
  }, { repository: undefined, locale: undefined, cacheTtlMs: undefined, fetchImpl: undefined });
  await until(() => view.container.querySelector('.c0721c-post'));
  assert.equal(view.container.querySelector('h2').textContent, 'Comments1');
  assert.equal(view.config.value.cacheTtlMs, 0);
  assert.deepEqual(fixture.calls.map(({ url }) => url), [
    'https://mirror.invalid/configured/article/essay/slug.json',
  ]);
  assert.match(new URL(view.container.querySelector('.c0721c-post').href).searchParams.get('body'), /Write your comment below/);
});

test('defined props override every provider option and masked provider changes do not reload', async (t) => {
  const inherited = transport(snapshot({ comments: [comment(1)] }));
  const direct = transport(snapshot({ comments: [comment(2)] }));
  const source = reactive({
    repository: 'provider/comments', locale: 'zh-CN', enabled: false,
    indexBaseUrl: 'https://provider.invalid/index/', cacheTtlMs: 60000, fetchImpl: inherited.fetchImpl,
  });
  const view = mount(t, source, {
    repository: 'override/comments', locale: 'en', enabled: true,
    indexBaseUrl: 'https://override.invalid/index/', cacheTtlMs: 0, fetchImpl: direct.fetchImpl,
  });
  await until(() => view.container.querySelector('.c0721c-author'));
  assert.equal(inherited.calls.length, 0);
  assert.equal(view.container.querySelector('.c0721c-author').textContent, '@user-2');
  assert.equal(view.container.querySelector('h2').textContent, 'Comments1');
  assert.ok(direct.calls.every(({ url }) => url.startsWith('https://override.invalid/index/')));
  assert.match(view.container.querySelector('.c0721c-post').href, /override\/comments/);
  Object.assign(source, { repository: 'changed/comments', locale: 'en', enabled: true, cacheTtlMs: 30000, indexBaseUrl: 'https://changed.invalid/' });
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(direct.calls.length, 1);
  assert.equal(inherited.calls.length, 0);
  assert.match(view.container.querySelector('.c0721c-post').href, /override\/comments/);
  view.props.repository = undefined;
  await until(() => view.container.querySelector('.c0721c-post')?.href.includes('/changed/comments/'));
  assert.equal(direct.calls.length, 2);
});

test('disabled and unconfigured components render nothing and never call fetch or slots', async (t) => {
  const cases = [
    { options: { repository: 'configured/comments', enabled: false } },
    { options: { repository: '' } },
    { options: { repository: '   ' } },
    { options: { repository: 'configured/comments' }, props: { enabled: false } },
    { options: { repository: 'configured/comments' }, props: { repository: '' } },
  ];
  for (const { options, props } of cases) {
    const fixture = transport();
    let slotCalls = 0;
    const view = mount(t, { ...options, fetchImpl: fixture.fetchImpl }, props, { footer: () => { slotCalls++; return h('span', 'Unexpected UI'); } });
    await nextTick();
    await view.component.refresh();
    assert.equal(view.container.textContent, '');
    assert.equal(view.container.querySelector('section'), null);
    assert.equal(fixture.calls.length, 0);
    assert.equal(slotCalls, 0);
  }
  const unprovided = mount(t, undefined);
  await nextTick();
  assert.equal(unprovided.container.querySelector('section'), null);
  assert.equal(unprovided.config.value.repository, '');
});

test('runtime-config getter starts unconfigured then reacts when the repository becomes available', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const runtimeConfig = reactive({ public: { comments0721c: { repository: '', locale: 'en', fetchImpl: fixture.fetchImpl } } });
  const view = mount(t, () => runtimeConfig.public.comments0721c);
  assert.equal(view.container.querySelector('section'), null);
  assert.equal(fixture.calls.length, 0);
  runtimeConfig.public.comments0721c.repository = 'runtime/comments';
  await until(() => view.container.querySelector('.c0721c-comment'));
  assert.equal(view.config.value.repository, 'runtime/comments');
  assert.equal(view.container.querySelector('h2').textContent, 'Comments1');
  assert.match(view.container.querySelector('.c0721c-post').href, /runtime\/comments/);
});

test('replacing reactive config cancels refresh, clears old history and resets root pagination', async (t) => {
  const oldData = snapshot({ comments: Array.from({ length: 21 }, (_, index) => comment(index + 1)) });
  const newData = snapshot({ comments: Array.from({ length: 21 }, (_, index) => comment(index + 50)) });
  const oldGate = deferred();
  const newGate = deferred();
  let holdOld = false, oldSignal, newCalls = 0;
  const oldFetch = async (url, options) => {
    if (holdOld) { oldSignal = options.signal; return oldGate.promise; }
    return jsonResponse(oldData.index);
  };
  const newFetch = async () => { newCalls++; return newGate.promise; };
  const source = ref({ repository: 'old/comments', locale: 'en', fetchImpl: oldFetch });
  const view = mount(t, () => source.value);
  await until(() => view.container.querySelectorAll('[data-depth="0"]').length === 20);
  view.container.querySelector('.c0721c-more').click();
  await until(() => view.container.querySelectorAll('[data-depth="0"]').length === 21);
  holdOld = true;
  const pendingRefresh = view.component.refresh();
  await until(() => oldSignal);
  source.value = { repository: 'new/comments', locale: 'zh-CN', fetchImpl: newFetch };
  await until(() => newCalls === 1);
  assert.equal(oldSignal.aborted, true);
  assert.equal(view.container.querySelectorAll('.c0721c-comment').length, 0);
  assert.equal(view.container.querySelector('section').dataset.state, 'loading');
  newGate.resolve(jsonResponse(newData.index));
  await until(() => view.container.querySelectorAll('[data-depth="0"]').length === 20);
  assert.equal(view.container.querySelector('h2').textContent, '评论21');
  assert.equal(view.container.querySelector('.c0721c-author').textContent, '@user-50');
  assert.match(view.container.querySelector('.c0721c-post').href, /new\/comments/);
  oldGate.resolve(jsonResponse(oldData.index));
  await pendingRefresh;
  await nextTick();
  assert.equal(view.container.querySelector('.c0721c-author').textContent, '@user-50');
  assert.equal(newCalls, 1);
});

test('reactively disabling or clearing the repository cancels reads; enabling creates a fresh client', async (t) => {
  for (const field of ['enabled', 'repository']) {
    const data = snapshot({ comments: [comment(1)] });
    const gate = deferred();
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, signal: options.signal });
      if (calls.length === 1) return gate.promise;
      return jsonResponse(data.index);
    };
    const options = reactive({ repository: 'configured/comments', enabled: true, fetchImpl });
    const view = mount(t, options);
    await until(() => calls.length === 1);
    options[field] = field === 'enabled' ? false : '';
    await nextTick();
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(view.container.querySelector('section'), null);
    gate.resolve(jsonResponse(data.index));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await view.component.refresh();
    assert.equal(calls.length, 1);
    options[field] = field === 'enabled' ? true : 'configured/comments';
    await until(() => view.container.querySelector('.c0721c-comment'));
    assert.equal(calls.length, 2);
  }
});

test('two Vue apps keep separate config, requests and reactive changes', async (t) => {
  const transportA = transport(snapshot({ comments: [comment(1)] }));
  const transportB = transport(snapshot({ comments: [comment(2)] }));
  const configA = reactive({ repository: 'first/comments', locale: 'en', fetchImpl: transportA.fetchImpl });
  const appA = mount(t, configA);
  const appB = mount(t, { repository: 'second/comments', locale: 'zh-CN', fetchImpl: transportB.fetchImpl });
  await until(() => appA.container.querySelector('.c0721c-comment') && appB.container.querySelector('.c0721c-comment'));
  assert.notEqual(appA.config, appB.config);
  assert.equal(appA.container.querySelector('h2').textContent, 'Comments1');
  assert.equal(appB.container.querySelector('h2').textContent, '评论1');
  configA.repository = 'third/comments';
  await until(() => appA.container.querySelector('.c0721c-post')?.href.includes('/third/comments/'));
  assert.equal(appB.config.value.repository, 'second/comments');
  assert.match(appB.container.querySelector('.c0721c-post').href, /second\/comments/);
  assert.equal(transportB.calls.length, 1);
});

test('subtree providers merge defined values with the inherited reactive app config', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const parent = reactive({ repository: 'parent/comments', locale: 'en', enabled: false, cacheTtlMs: 0, fetchImpl: fixture.fetchImpl });
  const child = reactive({ repository: 'child/comments', enabled: true });
  let parentConfig, childConfig;
  const Child = {
    setup() { childConfig = provide0721cConfig(() => child); return () => h(Comments0721c, { articleId: 'article/essay/slug' }); },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    setup() { parentConfig = use0721cConfig(); return () => h('div', [h(Comments0721c, { articleId: 'article/essay/slug' }), h(Child)]); },
  });
  app.use(create0721c(parent));
  app.mount(container);
  t.after(() => { app.unmount(); container.remove(); });
  await until(() => container.querySelector('.c0721c-comment'));
  assert.equal(container.querySelectorAll('section').length, 1);
  assert.equal(parentConfig.value.enabled, false);
  assert.equal(childConfig.value.repository, 'child/comments');
  assert.equal(childConfig.value.locale, 'en');
  assert.equal(childConfig.value.cacheTtlMs, 0);
  parent.locale = 'zh-CN';
  await until(() => container.querySelector('h2')?.textContent === '评论1');
  assert.equal(childConfig.value.locale, 'zh-CN');
  assert.equal(parentConfig.value.repository, 'parent/comments');
  child.enabled = false;
  await nextTick();
  assert.equal(container.querySelector('section'), null);
});

test('composable works in app.runWithContext and outside an app without global configuration', (t) => {
  const baseline = use0721cConfig();
  const a = createApp({});
  const b = createApp({});
  a.use(create0721c({ repository: 'first/comments', locale: 'en' }));
  b.use(create0721c({ repository: 'second/comments' }));
  assert.equal(a.runWithContext(use0721cConfig).value.repository, 'first/comments');
  assert.equal(b.runWithContext(use0721cConfig).value.repository, 'second/comments');
  assert.equal(b.runWithContext(use0721cConfig).value.locale, 'zh-CN');
  assert.equal(baseline.value.repository, '');
  assert.equal(use0721cConfig().value.repository, '');
});

test('configured SSR markup hydrates with repository-free props and preserved slots', async (t) => {
  const fixture = transport(snapshot({ comments: [comment(1)] }));
  const options = reactive({ repository: 'configured/comments', locale: 'en', fetchImpl: fixture.fetchImpl });
  const render = () => h(Comments0721c, { articleId: 'article/essay/slug' }, { footer: ({ title }) => h('span', { class: 'custom-footer' }, title) });
  const server = createSSRApp({ render });
  server.use(create0721c(() => options));
  const html = await renderToString(server);
  assert.equal(fixture.calls.length, 0);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const warnings = [];
  const client = createSSRApp({ render });
  client.use(create0721c(() => options));
  client.config.warnHandler = (message) => warnings.push(message);
  client.mount(container);
  t.after(() => { client.unmount(); container.remove(); });
  await until(() => container.querySelector('.c0721c-comment'));
  assert.deepEqual(warnings, []);
  assert.equal(fixture.calls.length, 1);
  assert.equal(container.querySelector('.custom-footer').textContent, 'Comments');
});

test('provider timeZone is inherited, reactive and can be overridden by a component', async (t) => {
  const record = comment(1);
  const fixture = transport(snapshot({ comments: [record] }));
  const source = reactive({ repository: 'configured/comments', locale: 'en', timeZone: 'Asia/Shanghai', fetchImpl: fixture.fetchImpl });
  const view = mount(t, source, { timeZone: undefined });
  await until(() => view.container.querySelector('time'));
  const expected = zone => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(record.created_at));
  assert.equal(view.config.value.timeZone, 'Asia/Shanghai');
  assert.equal(view.container.querySelector('time').textContent, expected('Asia/Shanghai'));
  source.timeZone = 'America/New_York';
  await nextTick();
  assert.equal(view.container.querySelector('time').textContent, expected('America/New_York'));
  view.props.timeZone = 'UTC';
  await nextTick();
  source.timeZone = 'Asia/Shanghai';
  await nextTick();
  assert.equal(view.container.querySelector('time').textContent, expected('UTC'));
  view.props.timeZone = undefined;
  await nextTick();
  assert.equal(view.container.querySelector('time').textContent, expected('Asia/Shanghai'));
  assert.equal(fixture.calls.length, 1);
});
