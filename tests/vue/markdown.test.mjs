import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createMarkdownRenderer, safeHttpUrl } from '../../src/vue/markdown.mjs';

async function render(t, source, options) {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'https://host.invalid/article' });
  t.after(() => dom.window.close());
  const renderer = await createMarkdownRenderer(dom.window);
  const main = dom.window.document.querySelector('main');
  main.innerHTML = renderer.render(source, options);
  return main;
}

test('supports prose, emphasis, quotes, lists, code and safe HTTP(S) links', async (t) => {
  const main = await render(t, '**bold** *em*\n\n> quote\n\n1. first\n2. second\n\n```js\nconst x = "<img>";\n```\n\n[site](https://example.invalid/path?q=1&x=2)');
  assert.equal(main.querySelector('strong').textContent, 'bold');
  assert.equal(main.querySelector('em').textContent, 'em');
  assert.equal(main.querySelector('blockquote').textContent.trim(), 'quote');
  assert.equal(main.querySelectorAll('ol li').length, 2);
  assert.match(main.querySelector('pre code').textContent, /<img>/);
  assert.equal(main.querySelector('pre code').hasAttribute('class'), false);
  const link = main.querySelector('a');
  assert.equal(link.href, 'https://example.invalid/path?q=1&x=2');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer nofollow ugc');
});

test('images become escaped safe links without requesting image resources', async (t) => {
  const main = await render(t, '![a " <b>](https://images.invalid/a.png "title")\n\n![bad](javascript:alert(1))', { imageLabel: '图片' });
  assert.equal(main.querySelectorAll('img').length, 0);
  const link = main.querySelector('a');
  assert.equal(link.href, 'https://images.invalid/a.png');
  assert.match(link.textContent, /图片: a " <b>/);
  assert.equal(main.querySelector('b'), null);
  assert.equal(main.querySelectorAll('a[href]').length, 1);
});

test('raw HTML, scripts, event handlers, SVG, iframe and styles remain inert text', async (t) => {
  const attacks = [
    '<script>globalThis.pwned=1</script>',
    '<img src=x onerror="alert(1)">',
    '<svg onload="alert(1)"><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<iframe src="https://attacker.invalid"></iframe>',
    '<div style="position:fixed" onclick="alert(1)">text</div>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">',
  ];
  const main = await render(t, attacks.join('\n\n'));
  assert.equal(main.querySelectorAll('script,img,svg,iframe,style,math,div').length, 0);
  for (const source of attacks) assert.ok(main.textContent.includes(source));
  for (const element of main.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) assert.ok(!/^on/i.test(name));
  }
});

test('blocks javascript, data, vbscript, relative, protocol-relative and credential URLs', async (t) => {
  const urls = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,evil', 'vbscript:msgbox(1)', '/local', '//evil.invalid', 'mailto:user@example.invalid', 'https://name:secret@example.invalid/'];
  const main = await render(t, urls.map((url) => `[unsafe](${url})`).join('\n\n') + '\n\n[encoded](java&#x73;cript:alert(1))\n\n[control](java%0ascript:alert(1))');
  assert.equal(main.querySelectorAll('a[href]').length, 0);
  for (const link of main.querySelectorAll('a')) {
    assert.equal(link.hasAttribute('target'), false);
    assert.equal(link.hasAttribute('rel'), false);
  }
});

test('URL guard permits only absolute credential-free HTTP(S)', () => {
  for (const value of [null, 7, '', 'javascript:alert(1)', 'https://user:secret@host.invalid', 'https:\n//host.invalid', '//host.invalid', '/path', 'file:///etc/passwd', 'data:image/png;base64,AAAA']) {
    assert.equal(safeHttpUrl(value), null, String(value));
  }
  assert.equal(safeHttpUrl('https://example.invalid/a?q=b'), 'https://example.invalid/a?q=b');
  assert.equal(safeHttpUrl('http://example.invalid/a'), 'http://example.invalid/a');
});

test('renderer is cached per DOM window and fails safely without a window', async (t) => {
  const a = new JSDOM('');
  const b = new JSDOM('');
  t.after(() => { a.window.close(); b.window.close(); });
  const [first, second] = await Promise.all([createMarkdownRenderer(a.window), createMarkdownRenderer(a.window)]);
  assert.equal(first, second);
  assert.notEqual(first, await createMarkdownRenderer(b.window));
  await assert.rejects(createMarkdownRenderer(undefined), TypeError);
  assert.throws(() => first.render(null), TypeError);
});

test('preserves the full long body, escaping code and Markdown labels', async (t) => {
  const text = '长正文'.repeat(2000);
  const main = await render(t, `${text}\n\n\`<script>alert(1)</script>\`\n\n[end](https://example.invalid/)`);
  assert.ok(main.textContent.includes(text));
  assert.equal(main.querySelector('code').textContent, '<script>alert(1)</script>');
  assert.equal(main.querySelector('script'), null);
  assert.equal(main.querySelector('a').textContent, 'end');
});
