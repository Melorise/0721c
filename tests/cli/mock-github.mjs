import assert from 'node:assert/strict';

export const apiError = (status = 503) => Object.assign(new Error('mock transport failure'), { status });

/** Doctor's anonymous GET-only public repository fixture. No write API exists. */
export class MockGitHub {
  constructor() {
    this.repo = { private: false, visibility: 'public', archived: false, disabled: false, fork: false, default_branch: 'main', has_issues: true };
    this.branches = new Map(); this.calls = []; this.objects = new Map(); this.counter = 0;
    this.blocked = new Map(); this.truncated = false;
  }
  object(value) {
    const id = (++this.counter).toString(16).padStart(40, '0');
    this.objects.set(id, value);
    return id;
  }
  set(branch, files) { this.branches.set(branch, { ...files }); }
  async request(method, path) {
    assert.equal(method, 'GET', 'Only doctor mocks may use the public transport');
    this.calls.push({ method, path });
    if (this.blocked.has(path)) throw apiError(this.blocked.get(path));
    const base = '/repos/owner/comments';
    if (path === base) { if (!this.repo) throw apiError(404); return this.repo; }
    if (path.startsWith(`${base}/git/ref/heads/`)) {
      const branch = path.slice(`${base}/git/ref/heads/`.length);
      const files = this.branches.get(branch);
      if (!files) throw apiError(404);
      const tree = Object.entries(files).map(([name, text]) => ({ path: name, type: 'blob', mode: '100644', sha: this.object({ encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text) }) }));
      const treeId = this.object({ tree, truncated: this.truncated });
      const commit = this.object({ tree: { sha: treeId } });
      return { ref: `refs/heads/${branch}`, object: { type: 'commit', sha: commit } };
    }
    const id = path.split('/').at(-1).split('?')[0];
    if (/\/git\/(commits|trees|blobs)\//.test(path) && this.objects.has(id)) return this.objects.get(id);
    throw new Error(`Unexpected public diagnostic route: ${path}`);
  }
}
