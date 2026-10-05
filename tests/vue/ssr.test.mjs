import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Fresh processes prove there is no pre-existing window, renderer or import cache.
for (const locale of ['zh-CN', 'en']) {
  test(`SSR is DOM-free and does not load Markdown dependencies or fetch (${locale})`, () => {
    const script = `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      assert.equal(typeof window, 'undefined');
      assert.equal(typeof document, 'undefined');
      registerHooks({ resolve(specifier, context, next) {
        if (['markdown-it', 'dompurify', 'jsdom'].includes(specifier)) throw new Error('SSR loaded DOM dependency: ' + specifier);
        return next(specifier, context);
      } });
      const { createSSRApp, h } = await import('vue');
      const { renderToString } = await import('vue/server-renderer');
      const { Comments0721c } = await import('./src/vue/index.mjs');
      let calls = 0;
      const app = createSSRApp({ render: () => h(Comments0721c, {
        repository: 'fixtures/comments', articleId: 'article/essay/slug', locale: ${JSON.stringify(locale)},
        title: '<script>unsafe</script>', fetchImpl: () => { calls++; throw new Error('Unexpected fetch'); },
      }) });
      const html = await renderToString(app);
      assert.equal(calls, 0);
      assert.ok(html.includes('data-state="loading"'));
      assert.ok(html.includes('aria-live="polite"'));
      assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
      assert.ok(!html.includes('<script>'));
      process.stdout.write('SSR passed\\n');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'SSR passed');
  });
}


test('config plugins isolate concurrent SSR apps without DOM, fetch or Markdown dependencies', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    registerHooks({ resolve(specifier, context, next) {
      if (['markdown-it', 'dompurify', 'jsdom'].includes(specifier)) throw new Error('SSR loaded DOM dependency: ' + specifier);
      return next(specifier, context);
    } });
    const { createSSRApp, h } = await import('vue');
    const { renderToString } = await import('vue/server-renderer');
    const { Comments0721c, create0721c, use0721cConfig } = await import('./src/vue/index.mjs');
    let calls = 0;
    const fetchImpl = () => { calls++; throw new Error('SSR fetched'); };
    function app(options) {
      const instance = createSSRApp({
        setup() {
          const config = use0721cConfig();
          return () => h('main', [
            h('span', { 'data-config-repository': config.value.repository }, config.value.locale),
            h(Comments0721c, { articleId: 'article/essay/slug' }),
          ]);
        },
      });
      instance.use(create0721c(() => ({ ...options, fetchImpl })));
      return instance;
    }
    const [english, chinese, disabled, unconfigured] = await Promise.all([
      renderToString(app({ repository: 'first/comments', locale: 'en' })),
      renderToString(app({ repository: 'second/comments', locale: 'zh-CN' })),
      renderToString(app({ repository: 'disabled/comments', enabled: false })),
      renderToString(app({ repository: '' })),
    ]);
    assert.ok(english.includes('data-config-repository="first/comments"'));
    assert.ok(english.includes('Loading comments'));
    assert.ok(!english.includes('second/comments'));
    assert.ok(chinese.includes('data-config-repository="second/comments"'));
    assert.ok(chinese.includes('正在加载评论'));
    assert.ok(!chinese.includes('first/comments'));
    assert.ok(!disabled.includes('<section'));
    assert.ok(!unconfigured.includes('<section'));
    assert.equal(calls, 0);
    assert.equal(use0721cConfig().value.repository, '');
    process.stdout.write('SSR configuration passed\\n');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'SSR configuration passed');
});
