import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { setup0721cNuxt, DEFAULT_NUXT_OPTIONS } from '../../src/nuxt/setup.mjs';

function setup(overrides = {}, runtime = {}) {
  const plugins = [], components = [];
  const nuxt = { options: { runtimeConfig: { public: runtime }, css: [] } };
  const kit = { addPlugin(value) { plugins.push(value); }, addComponent(value) { components.push(value); }, createResolver(url) { return { resolve: (...parts) => resolve(dirname(fileURLToPath(url)), ...parts) }; } };
  setup0721cNuxt(overrides, nuxt, kit);
  return { nuxt, plugins, components, kit };
}
test('real Nuxt module declares config key and compatible framework metadata', async () => {
  const { default: module } = await import('../../src/nuxt/index.mjs');
  const metadata = await module.getMeta();
  assert.equal(metadata.configKey, 'comments0721c');
  assert.equal(metadata.name, '0721c-nuxt-content');
});
test('one module registers its adapter/config plugin/CSS without altering Markdown content', async () => {
  const { nuxt, plugins, components, kit } = setup({ repository: 'fixtures/comments', content: { pathPrefixes: ['/article'] } });
  assert.equal(nuxt.options.runtimeConfig.public.comments0721c.repository, 'fixtures/comments');
  assert.deepEqual(nuxt.options.runtimeConfig.public.comments0721c.content.pathPrefixes, ['/article']);
  assert.equal(components[0].name, 'ContentComments0721c');
  assert.equal(components[0].export, 'ContentComments0721c');
  await access(components[0].filePath); await access(plugins[0].src); await access(nuxt.options.css[0]);
  setup0721cNuxt({}, nuxt, kit); assert.equal(nuxt.options.css.length, 1);
});
test('public runtime overrides win and unknown credentials are never serialized', () => {
  const { nuxt } = setup({ repository: 'default/comments', token: 'DO_NOT_SERIALIZE', secret: 'DO_NOT_SERIALIZE', content: { pathPrefixes: ['/posts'] } }, {
    comments0721c: { repository: 'runtime/comments', enabled: false, token: 'DO_NOT_SERIALIZE', content: { pathPrefixes: ['/article'] } }, unrelated: { flag: true },
  });
  const config = nuxt.options.runtimeConfig.public.comments0721c;
  assert.equal(config.repository, 'runtime/comments'); assert.equal(config.enabled, false);
  assert.deepEqual(config.content.pathPrefixes, ['/article']);
  assert.ok(nuxt.options.runtimeConfig.public.unrelated.flag);
  assert.doesNotMatch(JSON.stringify(config), /DO_NOT_SERIALIZE|token|secret/);
});
test('module defaults are instance-neutral and cannot activate a fake repository', () => {
  const { nuxt } = setup();
  assert.equal(nuxt.options.runtimeConfig.public.comments0721c.repository, '');
  assert.deepEqual(DEFAULT_NUXT_OPTIONS.content.pathPrefixes, []);
});
test('the generated Nuxt plugin binds runtime config to one Vue app without process-global state', async () => {
  const source = await readFile(new URL('../../src/nuxt/plugin.mjs', import.meta.url), 'utf8');
  const shim = 'data:text/javascript,' + encodeURIComponent('export const defineNuxtPlugin = value => value; export const useRuntimeConfig = () => globalThis.__0721cNuxtFixture;');
  const adapter = new URL('../../src/content/vue.mjs', import.meta.url).href;
  const rewritten = source.replace("'#app'", JSON.stringify(shim)).replace("'../content/vue.mjs'", JSON.stringify(adapter));
  const { default: plugin } = await import('data:text/javascript,' + encodeURIComponent(rewritten));
  const { createSSRApp, h } = await import('vue');
  const { renderToString } = await import('vue/server-renderer');
  const { use0721cConfig } = await import('../../src/vue/index.mjs');
  const probe = { setup() { const config = use0721cConfig(); return () => h('p', config.value.repository); } };
  try {
    globalThis.__0721cNuxtFixture = { public: { comments0721c: { repository: 'one/comments' } } };
    const first = createSSRApp(probe); plugin.setup({ vueApp: first });
    globalThis.__0721cNuxtFixture = { public: { comments0721c: { repository: 'two/comments' } } };
    const second = createSSRApp(probe); plugin.setup({ vueApp: second });
    assert.equal(await renderToString(first), '<p>one/comments</p>');
    assert.equal(await renderToString(second), '<p>two/comments</p>');
  } finally { delete globalThis.__0721cNuxtFixture; }
});


test('canonical site URL is inferred once from host config, with explicit overrides respected', () => {
  const registered = { options: { site: { url: 'https://blog.example' }, runtimeConfig: { public: {} }, css: [] } };
  const { kit } = setup();
  setup0721cNuxt({ ...DEFAULT_NUXT_OPTIONS }, registered, kit);
  assert.equal(registered.options.runtimeConfig.public.comments0721c.siteUrl, 'https://blog.example');
  const { nuxt } = setup({ siteUrl: 'https://inline.example' }, { comments0721c: { siteUrl: 'https://runtime.example' } });
  assert.equal(nuxt.options.runtimeConfig.public.comments0721c.siteUrl, 'https://runtime.example');
});

test('timeZone passes from module options to public config and runtime overrides win', () => {
  const fromModule = setup({ timeZone: 'Asia/Shanghai' });
  assert.equal(fromModule.nuxt.options.runtimeConfig.public.comments0721c.timeZone, 'Asia/Shanghai');
  const fromRuntime = setup({ timeZone: 'UTC' }, { comments0721c: { timeZone: 'America/New_York' } });
  assert.equal(fromRuntime.nuxt.options.runtimeConfig.public.comments0721c.timeZone, 'America/New_York');
  const defaults = setup();
  assert.equal(defaults.nuxt.options.runtimeConfig.public.comments0721c.timeZone, '');
});


test('module setup does not register a website verification hook', () => {
  const { nuxt, kit } = setup();
  nuxt.hook = () => { assert.fail('Module must not generate a verification file'); };
  setup0721cNuxt({ repository: 'example/comments', siteUrl: 'http://localhost:3000' }, nuxt, kit);
});


test('module and runtime messages merge per key into serializable public config', () => {
  const { nuxt } = setup({messages:{error:'检查 GitHub 网络', empty:'还没有留言'}}, {comments0721c:{messages:{error:'运行时错误提示', post:'去 GitHub 评论'}}});
  const messages = nuxt.options.runtimeConfig.public.comments0721c.messages;
  assert.deepEqual(messages, {post:'去 GitHub 评论', empty:'还没有留言', error:'运行时错误提示'});
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), messages);
  assert.deepEqual(setup().nuxt.options.runtimeConfig.public.comments0721c.messages, {});
});
