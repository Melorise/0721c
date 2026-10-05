import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../../styles/index.css', import.meta.url), 'utf8');

test('stylesheet keeps public themes local and supplies capped mobile indentation', () => {
  for (const variable of ['accent', 'border', 'background', 'text', 'muted', 'focus', 'font', 'indent', 'mobile-indent', 'avatar-size']) {
    assert.ok(css.includes(`--0721c-${variable}`));
  }
  assert.match(css, /@media \(max-width: 40rem\)/);
  assert.match(css, /margin-inline-start: calc\(var\(--0721c-mobile-depth, 0\) \* var\(--0721c-mobile-indent, 0\.5rem\)\)/);
  assert.match(css, /:focus-visible/);
  assert.ok(!css.includes('@import'));
  // Defaults must not shadow custom properties inherited from the host wrapper.
  assert.doesNotMatch(css, /(?:^|\n)\s*--0721c-(?:accent|border|surface|text|muted|error|font|indent):/);
  assert.match(css, /var\(--0721c-accent, #3159c5\)/);
  assert.match(css, /var\(--0721c-accent, #a8bcff\)/);
  // Bare selectors would leak presentation into the host site.
  for (const line of css.split('\n').filter((line) => line.includes('{') && !line.trim().startsWith('@'))) {
    assert.ok(line.trim().startsWith('.c0721c'), line);
  }
});

test('long content wraps or scrolls without truncation and controls have usable touch targets', () => {
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /min-block-size: 2\.75rem/);
  assert.doesNotMatch(css, /text-overflow|line-clamp|max-block-size|max-height/);
});


test('comment columns and smaller reply avatars retain shallow gutters and inherited typography', () => {
  assert.match(css, /\.c0721c-comment \{\s*display: flex;/);
  assert.match(css, /\.c0721c-main \{ flex: 1; min-inline-size: 0;/);
  assert.match(css, /--0721c-reply-avatar-size, 1\.75rem/);
  assert.match(css, /\.c0721c-comment-meta \{ display: flex; flex-wrap: wrap; align-items: baseline/);
  assert.match(css, /font-family: var\(--0721c-font, inherit\)/);
  assert.match(css, /line-height: 1\.7/);
  assert.doesNotMatch(css, /c0721c-source|c0721c-comment-footer/);
});
