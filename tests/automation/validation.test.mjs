import test from 'node:test';
import assert from 'node:assert/strict';
import { runIntake } from '../../src/automation/intake-comment.mjs';
import { validatePullRequest, runValidation } from '../../src/automation/validate-comment.mjs';
import { createCommit, serialize } from '../../src/automation/runtime.mjs';
import { record } from '../core/fixtures.mjs';
import { ARTICLE, MockGitHub, issue, intakeOptions } from './mock-github.mjs';
async function setup(options) {
  const mock = new MockGitHub(options), result = await runIntake(intakeOptions(mock));
  return { mock, result, branch: 'heads/comment-1' };
}

test('validation checks actual head and rejects extra executable/workflow files and record modes', async () => {
  for (const file of ['evil.mjs', '.github/workflows/attack.yml']) {
    const { mock, result, branch } = await setup();
    const head = await createCommit(mock.client, { parent: result.candidate.sha, message: 'extra file', files: { [file]: 'throw new Error("must not execute")' } });
    mock.refs.set(branch, head);
    await assert.rejects(validatePullRequest({ client: mock.client, prNumber: result.pr.number }));
    assert.equal(mock.statuses.at(-1).sha, head); assert.equal(mock.statuses.at(-1).state, 'failure');
  }
  for (const mode of ['120000', '100755', '160000']) {
    const { mock, result, branch } = await setup();
    const entries = mock.entries(result.candidate.sha), entry = entries.find(e => e.path === result.candidate.path);
    entry.mode = mode; entry.type = mode === '160000' ? 'commit' : 'blob';
    const head = mock.commit(mock.seedTree(entries), [mock.commentsSha]); mock.refs.set(branch, head);
    await assert.rejects(validatePullRequest({ client: mock.client, prNumber: result.pr.number }));
    assert.equal(mock.statuses.at(-1).state, 'failure');
  }
});
test('approved record modifications/removals and candidate branch/path mismatches fail', async () => {
  for (const kind of ['modified', 'removed', 'wrongpath', 'wrongid', 'wrongissue']) {
    const { mock, result, branch } = await setup({ records: [record(99)] });
    let entries = mock.entries(result.candidate.sha);
    if (kind === 'modified') entries.find(e => e.path === `${record(99).id}.json`).sha = mock.blob(serialize(record(99, { body_markdown: 'Changed approved body' })));
    if (kind === 'removed') entries = entries.filter(e => e.path !== `${record(99).id}.json`);
    if (kind === 'wrongpath') entries.find(e => e.path === result.candidate.path).path = 'other/path/1.json';
    if (kind === 'wrongid') entries.find(e => e.path === result.candidate.path).sha = mock.blob(serialize(record(2)));
    if (kind === 'wrongissue') {
      const entry = entries.find(e => e.path === result.candidate.path);
      entry.path = `${record(2).id}.json`;
      entry.sha = mock.blob(serialize(record(2)));
    }
    mock.refs.set(branch, mock.commit(mock.seedTree(entries), [mock.commentsSha]));
    await assert.rejects(validatePullRequest({ client: mock.client, prNumber: result.pr.number }));
    assert.equal(mock.statuses.at(-1).state, 'failure');
  }
});
test('comments advancing still validates the same candidate against current approved records', async () => {
  const { mock, result } = await setup();
  const other = await runIntake(intakeOptions(mock, issue({ number: 2 })));
  mock.closePR(other.pr.number, true);
  const verified = await validatePullRequest({ client: mock.client, prNumber: result.pr.number });
  assert.equal(verified.headSha, result.candidate.sha); assert.equal(verified.record.id, result.candidate.record.id);
  assert.equal(mock.statuses.at(-1).state, 'success');
});
test('live policy, configured limits, approved parent tree and truncated trees are checked', async () => {
  for (const kind of ['disabled', 'bodylimit', 'orphan', 'truncated']) {
    const { mock, result } = await setup();
    if (kind === 'disabled' || kind === 'bodylimit') {
      const settings = kind === 'disabled' ? { articlePolicy: { disabledIds: [ARTICLE] } } : { limits: { bodyCodepoints: 1 } };
      const main = await createCommit(mock.client, { parent: mock.mainSha, message: 'policy', files: { 'config/settings.json': serialize(settings) } });
      mock.refs.set('heads/main', main);
    }
    if (kind === 'orphan') {
      const entries = mock.entries(mock.commentsSha);
      entries.push({ path: `${record(99).id}.json`, mode: '100644', type: 'blob', sha: mock.blob(serialize(record(99, { reply_to: record(98).id }))) });
      mock.refs.set('heads/comments', mock.commit(mock.seedTree(entries), [mock.commentsSha]));
    }
    if (kind === 'truncated') mock.truncated = true;
    await assert.rejects(validatePullRequest({ client: mock.client, prNumber: result.pr.number }));
    assert.equal(mock.statuses.at(-1).state, 'failure');
  }
});
test('head changes during validation cannot receive a success status', async () => {
  const { mock, result, branch } = await setup();
  const head = await createCommit(mock.client, { parent: result.candidate.sha, message: 'moves', files: { 'evil.mjs': 'bad' } });
  const request = mock.client.request;
  mock.client.request = async (...args) => {
    const response = await request(...args);
    if (args[0] === 'GET' && args[1].includes('/git/blobs/')) mock.refs.set(branch, head);
    return response;
  };
  const successes = mock.statuses.filter(s => s.state === 'success').length;
  await assert.rejects(validatePullRequest({ client: mock.client, prNumber: result.pr.number }), /head, base or state changed/);
  assert.equal(mock.statuses.filter(s => s.state === 'success').length, successes);
  assert.equal(mock.statuses.some(s => s.sha === head && s.state === 'success'), false);
});
test('foreign repository heads are rejected before writing statuses; dispatch validates by pr_number', async () => {
  const { mock, result } = await setup();
  assert.equal((await runValidation({ client: mock.client, eventName: 'workflow_dispatch', event: { inputs: { pr_number: String(result.pr.number) } } })).valid, true);
  await assert.rejects(runValidation({ client: mock.client, eventName: 'push', event: {} }));
  mock.pulls[0].head.repo = { id: 999, full_name: 'attacker/fork' };
  const before = mock.statuses.length;
  await assert.rejects(validatePullRequest({ client: mock.client, prNumber: result.pr.number }));
  assert.equal(mock.statuses.length, before);
});

test('base changing after the fixed head was inspected cannot receive a success status', async () => {
  const { mock, result } = await setup();
  const request = mock.client.request;
  mock.client.request = async (...args) => {
    const response = await request(...args);
    if (args[0] === 'GET' && args[1].includes('/git/blobs/')) mock.pulls[0].base.ref = 'main';
    return response;
  };
  const successes = mock.statuses.filter(s => s.state === 'success').length;
  await assert.rejects(validatePullRequest({ client: mock.client, prNumber: result.pr.number }), /head, base or state changed/);
  assert.equal(mock.statuses.filter(s => s.state === 'success').length, successes);
});
