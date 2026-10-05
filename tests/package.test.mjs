import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePackOutput } from '../scripts/pack-output.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

test('public package exposes library entry points and the 0721c command', async () => {
  assert.equal(pkg.name, '0721c');
  assert.notEqual(pkg.private, true);
  assert.deepEqual(pkg.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/', tag: 'latest' });
  assert.deepEqual(pkg.bin, { '0721c': 'src/cli/index.mjs' });
  assert.match(await readFile(new URL(pkg.bin['0721c'], root), 'utf8'), /^#!\/usr\/bin\/env node\n/);
  assert.equal(pkg.type, 'module');
  for (const key of ['.', './vue', './content', './nuxt-content', './nuxt']) {
    await access(new URL(pkg.exports[key].default, root));
    await access(new URL(pkg.exports[key].types, root));
  }
  await access(new URL(pkg.exports['./style.css'], root));
  await access(new URL(pkg.bin['0721c'], root));
});

test('headless entry imports with no browser globals or framework import requirement', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const core = await import('../src/core/index.mjs');
  assert.equal(typeof core.createClient, 'function');
  const client = core.createClient({ repository: 'example-owner/site-comments', fetchImpl() { throw new Error('must not fetch during construction'); } });
  const url = new URL(client.getNewIssueUrl({ articleId: 'post-001' }));
  assert.equal(url.hostname, 'github.com');
  assert.equal(url.pathname, '/example-owner/site-comments/issues/new');
  assert.match(url.searchParams.get('body'), /0721c-meta:/);
  assert.match(url.searchParams.get('body'), /0721c-instructions/);
});

test('Vue and CLI modules can be imported without running a browser or deployment', async () => {
  const vue = await import('../src/vue/index.mjs');
  assert.ok(vue.Comments0721c);
  await import('../src/cli/index.mjs');
});

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

test('core graph is framework-free, browser-safe and independent of this website', async () => {
  for (const file of await filesUnder(new URL('src/core/', root))) {
    if (!file.pathname.endsWith('.mjs')) continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"](?:node:|vue|markdown-it|dompurify|\.\.\/)/);
    assert.doesNotMatch(source, /0721\.hk|melorise-blog|Nuxt|\/article\//);
  }
});

test('deployment runtime is a self-contained copy of this exact package version', async () => {
  const { loadAssets } = await import('../src/cli/assets.mjs');
  const assets = await loadAssets();
  assert.equal(assets.version, pkg.version);
  for (const [path, text] of Object.entries(assets.managed)) {
    if (path.startsWith('.0721c/runtime/')) {
      const relative = path.slice('.0721c/runtime/'.length);
      assert.equal(text, await readFile(new URL(`src/${relative}`, root), 'utf8'));
      if (path.endsWith('.mjs')) {
        assert.doesNotMatch(text, /(?:from\s*|import\s*\()\s*['"](?:vue|markdown-it|dompurify|0721c)/);
      }
    }
  }
  assert.deepEqual(Object.keys(assets.comments), ['README.md']);
  assert.deepEqual(Object.keys(assets.index), ['README.md']);
  assert.ok(!Object.keys(assets.managed).some(path => /(?:deployment|manifest)\.json$/.test(path)));
  assert.equal(assets.hashes, undefined);
  assert.ok(!Object.keys(assets.index).some(path => path.endsWith('.mjs')));
  const directory = await mkdtemp(join(tmpdir(), '0721c-runtime-boundary-'));
  try {
    for (const [path, text] of Object.entries(assets.managed)) {
      if (!path.startsWith('.0721c/runtime/')) continue;
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    const core = await import(pathToFileURL(join(directory, '.0721c/runtime/core/index.mjs')).href);
    assert.equal(typeof core.createClient, 'function');
    assert.equal(core.validateIndexManifest, undefined);
    // Importing installed scripts is inert; no GitHub environment or dependencies exist here.
    for (const name of ['intake-comment', 'validate-comment', 'publish-index']) {
      await import(pathToFileURL(join(directory, `.0721c/runtime/automation/${name}.mjs`)).href);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('pack output accepts npm 11 arrays and npm 12 package-keyed objects', () => {
  const metadata = {name:'0721c', version:'0.3.0', filename:'0721c-0.3.0.tgz', files:[]};
  assert.deepEqual(parsePackOutput(JSON.stringify([metadata]), '0721c'), metadata);
  assert.deepEqual(parsePackOutput(JSON.stringify({'0721c':metadata}), '0721c'), metadata);
  const scoped = {...metadata, name:'@example/comments'};
  assert.deepEqual(parsePackOutput(JSON.stringify({'@example/comments':scoped}), scoped.name), scoped);
});

test('missing pack output reports which package is missing rather than dereferencing undefined', () => {
  for (const output of [[], {}, {other:{name:'other'}}, null]) {
    assert.throws(() => parsePackOutput(JSON.stringify(output), '0721c'), /npm pack did not return metadata for 0721c/);
  }
  assert.throws(() => parsePackOutput('invalid JSON', '0721c'), SyntaxError);
});
