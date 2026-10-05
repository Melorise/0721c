import { record, metadataLine } from '../core/fixtures.mjs';
import { serialize } from '../../src/automation/runtime.mjs';

export const ARTICLE = record().blog_id;
const copy = value => structuredClone(value);
export function issueBody({ blog = ARTICLE, replyTo = null, body = 'Hello **Markdown**', article } = {}) {
  return `${metadataLine({ blog_id: blog, reply_to: replyTo, ...(article ? { article } : {}) })}\n<!-- 0721c-instructions\nDo not edit the template.\n-->\n\n${body}`;
}
export function issue({ number = 1, body = issueBody(), user, ...overrides } = {}) {
  return { id: 8000 + number, number, state: 'open', body, created_at: record().created_at,
    user: user ?? { id: 42, login: 'alice', avatar_url: 'https://avatars.githubusercontent.com/u/42' }, ...overrides };
}
export function intakeOptions(mock, source = issue()) {
  mock.issues.set(source.number, copy(source));
  return { client: mock.client, eventName: 'issues', event: { action: 'opened', issue: source } };
}
export function dispatchOptions(mock, number = 1) {
  return { client: mock.client, eventName: 'workflow_dispatch', event: { inputs: { issue_number: String(number) } } };
}

/** In-memory Git/PR API only. No fetch, Git process, credentials or remote mutations. */
export class MockGitHub {
  constructor({ settings = {}, articles, records = [] } = {}) {
    this.repository = { id: 700, full_name: 'example/comments', default_branch: 'main' };
    this.nextId = 100; this.blobs = new Map(); this.trees = new Map(); this.commits = new Map();
    this.refs = new Map(); this.issues = new Map(); this.pulls = []; this.calls = []; this.statuses = []; this.failures = []; this.users = new Map();
    const main = { 'config/settings.json': serialize(settings) };
    if (articles !== undefined) main['config/articles.json'] = serialize({ schema_version: 1, articles });
    this.mainSha = this.seedCommit(main);
    this.commentsSha = this.seedCommit({ 'README.md': '# Comments\n', ...Object.fromEntries(records.map(r => [`${r.id}.json`, serialize(r)])) });
    this.indexSha = this.seedCommit({ 'README.md': '# Index\n', 'obsolete/article.json': '{}' });
    for (const [name, sha] of [['main', this.mainSha], ['comments', this.commentsSha], ['index', this.indexSha]]) this.refs.set(`heads/${name}`, sha);
    this.client = { owner: 'example', repo: 'comments', basePath: '/repos/example/comments',
      request: this.request.bind(this), readFile: async (path, sha) => {
        const file = await this.request('GET', `/repos/example/comments/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`);
        return Buffer.from(file.content, 'base64').toString('utf8');
      } };
  }
  id() { return (this.nextId++).toString(16).padStart(40, '0'); }
  blob(text) { const sha = this.id(); this.blobs.set(sha, text); return sha; }
  seedTree(entries) { const sha = this.id(); this.trees.set(sha, copy(entries)); return sha; }
  commit(tree, parents = [], message = 'fixture') {
    const sha = this.id(); this.commits.set(sha, { sha, tree: { sha: tree }, parents: parents.map(sha => ({ sha })), message }); return sha;
  }
  seedCommit(files, parents = [], modes = {}) {
    return this.commit(this.seedTree(Object.entries(files).map(([path, text]) => ({ path, mode: modes[path] ?? '100644',
      type: modes[path] === '160000' ? 'commit' : 'blob', sha: this.blob(text) }))), parents);
  }
  entries(sha) { return copy(this.trees.get(this.commits.get(sha).tree.sha)); }
  contents(sha) { return Object.fromEntries(this.entries(sha).map(entry => [entry.path, this.blobs.get(entry.sha)])); }
  ancestors(sha) {
    const seen = new Set(), pending = [sha];
    while (pending.length) { const next = pending.shift(); if (seen.has(next)) continue; seen.add(next); pending.push(...this.commits.get(next).parents.map(p => p.sha)); }
    return seen;
  }
  mergeBase(base, head) { const bases = this.ancestors(base); return [...this.ancestors(head)].find(sha => bases.has(sha)); }
  diff(base, head) {
    const old = new Map(this.entries(base).map(e => [e.path, e])), next = new Map(this.entries(head).map(e => [e.path, e]));
    return [...new Set([...old.keys(), ...next.keys()])].filter(path => JSON.stringify(old.get(path)) !== JSON.stringify(next.get(path))).map(path => ({
      filename: path, sha: next.get(path)?.sha, status: !old.has(path) ? 'added' : !next.has(path) ? 'removed' : 'modified',
    }));
  }
  prData(pr) {
    const result = copy(pr);
    result.head.sha = this.refs.get(`heads/${pr.head.ref}`) ?? pr.head.sha;
    result.base.sha = this.refs.get('heads/comments');
    result.changed_files = pr.reviewFiles?.length ?? this.diff(this.mergeBase(result.base.sha, result.head.sha), result.head.sha).length;
    return result;
  }
  closePR(number, merged = false) {
    const pr = this.pulls.find(p => p.number === number), snapshot = this.prData(pr);
    if (merged) {
      pr.reviewFiles = this.diff(this.mergeBase(snapshot.base.sha, snapshot.head.sha), snapshot.head.sha);
      const entries = new Map(this.entries(snapshot.base.sha).map(e => [e.path, e]));
      for (const entry of this.entries(snapshot.head.sha)) if (!entries.has(entry.path)) entries.set(entry.path, entry);
      const sha = this.commit(this.seedTree([...entries.values()]), [snapshot.base.sha, snapshot.head.sha]);
      this.refs.set('heads/comments', sha);
    }
    Object.assign(pr, { state: 'closed', merged, merged_at: merged ? record().created_at : null });
    return this.prData(pr);
  }
  fault(predicate, { after = false, effect, status = 503 } = {}) { this.failures.push({ predicate, after, effect, status }); }
  async request(method, apiPath, body) {
    const url = new URL(apiPath, 'https://api.github.com');
    const call = { method, path: decodeURIComponent(url.pathname.replace('/repos/example/comments', '')), query: url.searchParams, body };
    this.calls.push(copy({ method, path: call.path, body }));
    const fault = this.failures.find(f => f.predicate(call));
    if (fault) this.failures.splice(this.failures.indexOf(fault), 1);
    if (fault && !fault.after) { fault.effect?.(this, call); throw Object.assign(new Error('Mock failure'), { status: fault.status }); }
    const result = this.route(call);
    if (fault) { fault.effect?.(this, call); throw Object.assign(new Error('Mock failure'), { status: fault.status }); }
    return copy(result);
  }
  route({ method, path, query, body }) {
    const missing = () => { throw Object.assign(new Error('Mock missing'), { status: 404 }); };
    const page = list => list.slice((Number(query.get('page') ?? 1) - 1) * 100, Number(query.get('page') ?? 1) * 100);
    if (method === 'GET' && path === '') return this.repository;
    if (method === 'GET' && path.startsWith('/users/')) return this.users.get(path.slice(7)) ?? missing();
    if (method === 'GET' && path.startsWith('/contents/')) {
      const sha = query.get('ref'), content = this.contents(sha)[path.slice(10)];
      if (content === undefined) return missing();
      return { type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') };
    }
    if (method === 'GET' && path.startsWith('/git/ref/')) {
      const sha = this.refs.get(path.slice(9)); if (!sha) return missing();
      return { object: { type: 'commit', sha } };
    }
    if (method === 'GET' && path.startsWith('/git/matching-refs/')) {
      const prefix = path.slice('/git/matching-refs/'.length);
      return page([...this.refs].filter(([name]) => name.startsWith(prefix)).map(([name, sha]) => ({ ref: `refs/${name}`, object: { type: 'commit', sha } })));
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = body.ref.slice(5);
      if (this.refs.has(name)) throw Object.assign(new Error('Mock ref exists'), { status: 422 });
      this.refs.set(name, body.sha); return { object: { type: 'commit', sha: body.sha } };
    }
    if (method === 'PATCH' && path.startsWith('/git/refs/')) {
      const name = path.slice(10);
      if (body.force && name !== 'heads/index') throw new Error('Only index may be forced');
      if (!body.force && !this.ancestors(body.sha).has(this.refs.get(name))) throw Object.assign(new Error('Not fast-forward'), { status: 422 });
      this.refs.set(name, body.sha); return { object: { type: 'commit', sha: body.sha } };
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) return this.commits.get(path.slice(13)) ?? missing();
    if (method === 'GET' && path.startsWith('/git/trees/')) return { tree: this.trees.get(path.slice(11)), truncated: Boolean(this.truncated) };
    if (method === 'GET' && path.startsWith('/git/blobs/')) return { encoding: 'base64', content: Buffer.from(this.blobs.get(path.slice(11))).toString('base64') };
    if (method === 'POST' && path === '/git/blobs') return { sha: this.blob(body.content) };
    if (method === 'POST' && path === '/git/trees') {
      const entries = new Map((body.base_tree ? this.trees.get(body.base_tree) : []).map(e => [e.path, e]));
      for (const entry of body.tree) entries.set(entry.path, entry);
      return { sha: this.seedTree([...entries.values()]) };
    }
    if (method === 'POST' && path === '/git/commits') return { sha: this.commit(body.tree, body.parents, body.message) };
    if (method === 'GET' && path.startsWith('/compare/')) {
      const [base, head] = path.slice(9).split('...'); return { merge_base_commit: { sha: this.mergeBase(base, head) } };
    }
    if (method === 'GET' && /^\/issues\/\d+$/.test(path)) return this.issues.get(Number(path.split('/')[2])) ?? missing();
    if (method === 'PATCH' && /^\/issues\/\d+$/.test(path)) {
      const source = this.issues.get(Number(path.split('/')[2])); if (!source) return missing(); Object.assign(source, body); return source;
    }
    if (method === 'POST' && path.startsWith('/statuses/')) { this.statuses.push({ sha: path.slice(10), ...body }); return body; }
    if (method === 'GET' && path === '/pulls') return page(this.pulls.filter(p => query.get('head') === `example:${p.head.ref}` && query.get('base') === p.base.ref).map(p => this.prData(p)));
    if (method === 'POST' && path === '/pulls') {
      if (this.pulls.some(p => p.head.ref === body.head)) throw Object.assign(new Error('Mock PR exists'), { status: 422 });
      const number = this.nextId++;
      const pr = { number, html_url: `https://github.com/example/comments/pull/${number}`, state: 'open', merged_at: null, ...body,
        head: { ref: body.head, sha: this.refs.get(`heads/${body.head}`), repo: this.repository },
        base: { ref: body.base, sha: this.refs.get(`heads/${body.base}`), repo: this.repository } };
      this.pulls.push(pr); return this.prData(pr);
    }
    if (/^\/pulls\/\d+(?:\/files)?$/.test(path)) {
      const pr = this.pulls.find(p => p.number === Number(path.split('/')[2])); if (!pr) return missing();
      if (method === 'PATCH') { Object.assign(pr, body); return this.prData(pr); }
      const snapshot = this.prData(pr);
      return path.endsWith('/files') ? page(pr.reviewFiles ?? this.diff(this.mergeBase(snapshot.base.sha, snapshot.head.sha), snapshot.head.sha)) : snapshot;
    }
    throw new Error(`Unexpected mock route: ${method} ${path}`);
  }
}
