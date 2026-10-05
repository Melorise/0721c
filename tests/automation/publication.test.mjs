import test from 'node:test';
import assert from 'node:assert/strict';
import { publishIndex, runPublication } from '../../src/automation/publish-index.mjs';
import { createCommit, serialize } from '../../src/automation/runtime.mjs';
import { record } from '../core/fixtures.mjs';
import { ARTICLE, MockGitHub } from './mock-github.mjs';
const updates = mock => mock.calls.filter(c => c.method === 'PATCH' && c.path.startsWith('/git/refs/'));

test('publication creates an entirely new parentless tree and forces ONLY heads/index', async () => {
  const mock = new MockGitHub({ records: [record()], articles: { 'article/empty': { enabled: false } } });
  const main = mock.refs.get('heads/main'), comments = mock.refs.get('heads/comments');
  const result = await publishIndex({ client: mock.client });
  assert.equal(result.status, 'published'); assert.equal(Object.hasOwn(result, 'manifest'), false);
  assert.deepEqual(mock.commits.get(result.commit).parents, []);
  assert.deepEqual(updates(mock), [{ method: 'PATCH', path: '/git/refs/heads/index', body: { sha: result.commit, force: true } }]);
  assert.equal(mock.refs.get('heads/main'), main); assert.equal(mock.refs.get('heads/comments'), comments);
  const files = mock.contents(result.commit);
  assert.deepEqual(Object.keys(files).sort(), ['README.md', 'article/empty.json', `${ARTICLE}.json`].sort());
  assert.equal(JSON.parse(files['article/empty.json']).comments_enabled, false);
  assert.equal(JSON.parse(files[`${ARTICLE}.json`]).total_count, 1);
  const treeCall = mock.calls.find(c => c.method === 'POST' && c.path === '/git/trees');
  assert.equal(Object.hasOwn(treeCall.body, 'base_tree'), false);
});
test('full force replacement deletes removed articles and arbitrary old files, including an empty snapshot', async () => {
  const mock = new MockGitHub({ records: [record(), record(2, { blog_id: 'notes/removed' })] });
  const first = await publishIndex({ client: mock.client });
  assert.ok(Object.hasOwn(mock.contents(first.commit), 'notes/removed.json'));
  const nextEntries = mock.entries(mock.commentsSha).filter(e => !e.path.startsWith('notes/'));
  mock.refs.set('heads/comments', mock.commit(mock.seedTree(nextEntries), [mock.commentsSha]));
  const second = await publishIndex({ client: mock.client });
  assert.equal(Object.hasOwn(mock.contents(second.commit), 'notes/removed.json'), false);
  assert.equal(Object.hasOwn(mock.contents(second.commit), 'obsolete/article.json'), false);
  assert.deepEqual(mock.commits.get(second.commit).parents, []);
  mock.refs.set('heads/comments', mock.seedCommit({ 'README.md': '# No records\n' }, [mock.refs.get('heads/comments')]));
  const empty = await publishIndex({ client: mock.client });
  assert.deepEqual(Object.keys(mock.contents(empty.commit)), ['README.md']);
  assert.deepEqual(mock.commits.get(empty.commit).parents, []);
  assert.equal(updates(mock).every(c => c.path === '/git/refs/heads/index' && c.body.force === true), true);
});
test('main/comments snapshots are rechecked immediately before force and stale builds are refused', async () => {
  for (const name of ['main', 'comments']) {
    const mock = new MockGitHub({ records: [record()] }), originalIndex = mock.refs.get('heads/index');
    const original = mock.client.request;
    mock.client.request = async (...args) => {
      const response = await original(...args);
      if (args[0] === 'POST' && args[1].endsWith('/git/commits')) {
        const previous = mock.refs.get(`heads/${name}`);
        mock.refs.set(`heads/${name}`, mock.commit(mock.commits.get(previous).tree.sha, [previous]));
      }
      return response;
    };
    await assert.rejects(publishIndex({ client: mock.client }), e => e.code === 'STALE_INDEX_SNAPSHOT');
    assert.equal(mock.refs.get('heads/index'), originalIndex); assert.equal(updates(mock).length, 0);
    const tail = mock.calls.slice(-2).map(c => c.path).sort();
    assert.deepEqual(tail, ['/git/ref/heads/comments', '/git/ref/heads/main']);
  }
});
test('explicitly stale trusted-main checkout is refused, malformed comments never change index', async () => {
  const stale = new MockGitHub();
  const main = await createCommit(stale.client, { parent: stale.mainSha, message: 'new config', files: { 'config/settings.json': serialize({ articlePolicy: { disabledIds: [ARTICLE] } }) } });
  stale.refs.set('heads/main', main);
  await assert.rejects(publishIndex({ client: stale.client, mainCommit: stale.mainSha }), e => e.code === 'STALE_INDEX_SNAPSHOT');
  assert.equal(updates(stale).length, 0);
  for (const kind of ['invalid', 'truncated', 'path']) {
    const mock = new MockGitHub({ records: [record()] });
    if (kind === 'truncated') mock.truncated = true;
    else {
      const entries = mock.entries(mock.commentsSha), entry = entries.find(e => e.path === `${record().id}.json`);
      if (kind === 'path') entry.path = 'wrong/path/1.json'; else entry.sha = mock.blob('{bad json');
      mock.refs.set('heads/comments', mock.commit(mock.seedTree(entries), [mock.commentsSha]));
    }
    await assert.rejects(publishIndex({ client: mock.client })); assert.equal(updates(mock).length, 0);
  }
});
test('lost successful force response is recovered; genuine failure leaves index untouched', async () => {
  for (const after of [true, false]) {
    const mock = new MockGitHub(), previous = mock.refs.get('heads/index');
    mock.fault(c => c.method === 'PATCH' && c.path === '/git/refs/heads/index', { after });
    if (after) assert.equal((await publishIndex({ client: mock.client })).commit, mock.refs.get('heads/index'));
    else { await assert.rejects(publishIndex({ client: mock.client })); assert.equal(mock.refs.get('heads/index'), previous); }
  }
});
test('closed unmerged review is ignored; comments/main pushes, schedule and manual can publish', async () => {
  const mock = new MockGitHub();
  assert.equal((await runPublication({ client: mock.client, eventName: 'pull_request_target', event: { action: 'closed', pull_request: { number: 10, base: { ref: 'comments' }, merged: false } } })).status, 'ignored');
  assert.equal(mock.calls.length, 0);
  for (const [eventName, event] of [['push', { ref: 'refs/heads/comments' }], ['push', { ref: 'refs/heads/main' }], ['schedule', {}], ['workflow_dispatch', {}]]) {
    assert.equal((await runPublication({ client: mock.client, eventName, event })).status, 'published');
  }
  await assert.rejects(runPublication({ client: mock.client, eventName: 'push', event: { ref: 'refs/heads/index' } }));
});
