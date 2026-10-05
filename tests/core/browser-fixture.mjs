// Executed in a separate Node vm solely to prove the browser core needs no Node globals.
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
const context = createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, Uint8Array, Response, ReadableStream });
const modules = new Map();
async function moduleAt(url) {
  const key = url.href;
  if (!key.startsWith(new URL('../../src/core/', import.meta.url).href)) throw new Error(`Module escaped browser core: ${key}`);
  if (!modules.has(key)) modules.set(key, readFile(url, 'utf8').then(source => new SourceTextModule(source, { context, identifier: key })));
  return modules.get(key);
}
const module = await moduleAt(new URL('../../src/core/index.mjs', import.meta.url));
await module.link(async (specifier, parent) => {
  if (!specifier.startsWith('./') || !specifier.endsWith('.mjs')) throw new Error(`Non-browser dependency: ${specifier}`);
  return moduleAt(new URL(specifier, parent.identifier));
});
await module.evaluate();
if ('process' in context || 'Buffer' in context || 'require' in context || 'window' in context) throw new Error('The fixture supplied a Node or DOM application global');
const core = module.namespace;
const client = core.createClient({ repository: 'example/comments', fetchImpl: async () => new Response(null,{status:404}) });
const result = await client.getComments('new-post');
if (result.status !== 'empty' || !result.commentsEnabled) throw new Error('Browser-only direct article read failed');
const issue = new URL(client.getNewIssueUrl({ articleId: 'new-post' }));
if (core.parseIssueBody(issue.searchParams.get('body') + 'Browser body').body_markdown !== 'Browser body') throw new Error('Browser-only protocol roundtrip failed');
console.log(`Browser realm loaded ${modules.size} local core modules; Node globals absent; direct article and protocol roundtrip passed.`);
