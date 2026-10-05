import { fail } from './errors.mjs';
import { validPath } from './model.mjs';
const oid = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export class GitStore {
  constructor(client, repository) {
    if (!client || typeof client.request !== 'function') fail('INVALID_CLIENT', 'An injected GitHubClient must implement request(method,path,body).');
    this.client = client;
    this.base = `/repos/${repository.owner}/${repository.repo}`;
  }
  request(method, path, body) {
    if (method !== 'GET' || body !== undefined) fail('READ_ONLY_OPERATION', 'Public diagnostics accept GET requests only.');
    return this.client.request('GET', path);
  }
  async optional(path, statuses = [404]) {
    try { return await this.request('GET', path); } catch (error) {
      if (statuses.includes(error.status)) return null;
      throw error;
    }
  }
  async repository() { return this.optional(this.base); }
  async head(branch) {
    const ref = await this.optional(`${this.base}/git/ref/heads/${encodeURIComponent(branch)}`, [404, 409]);
    if (!ref) return null;
    if (ref.ref !== `refs/heads/${branch}` || !oid(ref.object?.sha) || ref.object?.type !== 'commit') fail('INVALID_REMOTE', 'Invalid Git branch response.');
    return ref.object.sha;
  }
  async snapshot(branch) {
    const head = await this.head(branch);
    if (!head) return null;
    const commit = await this.request('GET', `${this.base}/git/commits/${head}`);
    if (!oid(commit.tree?.sha)) fail('INVALID_REMOTE', 'Invalid Git tree object.');
    const result = await this.request('GET', `${this.base}/git/trees/${commit.tree.sha}?recursive=1`);
    if (result.truncated || !Array.isArray(result.tree)) fail('TREE_TOO_LARGE', 'A complete repository tree is required; no changes were made.');
    const entries = Object.create(null);
    for (const entry of result.tree) {
      if (!validPath(entry.path)) fail('INVALID_REMOTE_PATH', 'The repository contains an unsafe file path.');
      if (Object.hasOwn(entries, entry.path)) fail('INVALID_REMOTE', 'The Git tree contains duplicate paths.');
      if (entry.type !== 'tree') {
        if (!oid(entry.sha)) fail('INVALID_REMOTE', 'Invalid Git blob object.');
        entries[entry.path] = entry;
      }
    }
    return { head, tree: commit.tree.sha, entries };
  }
  async read(snapshot, path) {
    const entry = snapshot?.entries[path];
    if (!entry) return null;
    if (entry.type !== 'blob' || !['100644'].includes(entry.mode)) fail('UNSAFE_REMOTE_FILE', 'Deployment files must be ordinary files.', { path });
    const blob = await this.request('GET', `${this.base}/git/blobs/${entry.sha}`);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.size > 16 * 1024 * 1024) fail('INVALID_REMOTE_BLOB', 'A deployment file is too large or has unsupported encoding.', { path });
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(blob.content.replace(/\s/g, ''), 'base64')); }
    catch { fail('INVALID_REMOTE_BLOB', 'A deployment file is not valid UTF-8.', { path }); }
  }
}
