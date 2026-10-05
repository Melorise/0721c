import { loadAssets } from './assets.mjs';
import { GitStore } from './git-store.mjs';
import { resolveRepository } from './repository.mjs';
import { fail } from './errors.mjs';
const API_VERSION = '2026-03-10';
class PublicAPIError extends Error {
  constructor(status) { super('Anonymous public diagnostic request failed.'); this.status = status; }
}

/** Anonymous public diagnostics. No credentials, login helpers or API writes. */
export async function publicContext(options = {}) {
  const assets = await loadAssets(options);
  const repository = await resolveRepository(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  const injected = options.githubClient;
  const client = {
    async request(method, path, body) {
      if (method !== 'GET' || body !== undefined) fail('READ_ONLY_OPERATION', 'Public diagnostics accept GET requests only.');
      if (typeof path !== 'string' || !(path === base || path.startsWith(`${base}/`)) || /[\\#\s]/.test(path)) fail('UNSAFE_API_PATH', 'Diagnostics are restricted to the selected public repository.');
      const decoded = decodeURIComponent(path.split('?')[0]);
      if (decoded.split('/').some(part => part === '.' || part === '..') || /[\\\x00-\x20]/.test(decoded)) fail('UNSAFE_API_PATH', 'Unsafe public API path.');
      const route = path.slice(base.length).split('?')[0];
      if (route && !/^\/git\/(ref\/heads\/(main|comments|index)|commits\/[a-f0-9]{40}|trees\/[a-f0-9]{40}|blobs\/[a-f0-9]{40})$/.test(route)) fail('UNSAFE_API_PATH', 'Only public branch and file diagnostics are supported.');
      if (injected) return injected.request('GET', path);
      const url = new URL(path, 'https://api.github.com');
      if (url.origin !== 'https://api.github.com') fail('UNSAFE_API_PATH', 'Only the GitHub public API origin is accepted.');
      let response;
      try {
        response = await fetchImpl(url.href, { method: 'GET', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': '0721c-public-diagnostics' } });
      } catch { throw new PublicAPIError(0); }
      if (!response.ok) throw new PublicAPIError(response.status);
      try { return await response.json(); } catch { throw new PublicAPIError(response.status); }
    }
  };
  return { assets, repository, store: new GitStore(client, repository) };
}
