import test from 'node:test';
import assert from 'node:assert/strict';
import { runIntake, createCommentId } from '../../src/automation/intake-comment.mjs';
import { record } from '../core/fixtures.mjs';
import { ARTICLE, MockGitHub, issue, issueBody, intakeOptions, dispatchOptions } from './mock-github.mjs';
const writes = mock => mock.calls.filter(c => c.method !== 'GET');

test('intake saves article path + Issue number comment ID, validates the PR, then closes the Issue', async () => {
  const mock = new MockGitHub(), source = issue({ number: 37, body: issueBody({ article: { title: 'My article', url: 'https://blog.example/' + ARTICLE }, body: 'Full **comment**\nLast line.' }) });
  const result = await runIntake(intakeOptions(mock, source));
  assert.equal(result.status, 'pending'); assert.equal(result.candidate.record.id, `${ARTICLE}/comments-37`);
  assert.equal(result.candidate.path, `${result.candidate.record.id}.json`);
  assert.notEqual(result.pr.number, source.number);
  assert.equal(result.pr.head.ref, 'comment-37'); assert.equal(result.pr.base.ref, 'comments');
  assert.deepEqual(Object.keys(result.candidate.record).sort(), ['article', 'author', 'blog_id', 'body_markdown', 'created_at', 'id', 'reply_to']);
  assert.deepEqual(result.candidate.record.author, { login: 'alice', avatar_url: source.user.avatar_url });
  assert.equal(mock.issues.get(37).state, 'closed');
  const postPR = mock.calls.findIndex(c => c.method === 'POST' && c.path === '/pulls');
  const validated = mock.calls.findIndex(c => c.path.startsWith('/statuses/') && c.body.state === 'success');
  const closed = mock.calls.findIndex(c => c.method === 'PATCH' && c.path === '/issues/37');
  assert.ok(postPR < validated && validated < closed);
  assert.deepEqual(mock.calls.filter(c => c.path === '/git/refs').map(c => c.body.ref), ['refs/heads/comment-37']);
  assert.equal(mock.calls.some(c => c.path.includes('/tags/')), false);
  assert.match(result.pr.body, /My article/); assert.match(result.pr.body, /Last line\./);
  assert.doesNotMatch(result.pr.body, /\/issues\/|Source Issue|来源：/);
});
test('ordinary Issues are ignored; parse, policy and reply failures create nothing and leave Issues open', async () => {
  const ordinary = new MockGitHub(); assert.equal((await runIntake(intakeOptions(ordinary, issue({ body: 'Other issue' })))).status, 'ignored');
  assert.equal(writes(ordinary).length, 0);
  const cases = [
    [{}, issue({ body: '<!-- 0721c-meta:bad -->\nbody' })],
    [{ settings: { articlePolicy: { disabledIds: [ARTICLE] } } }, issue()],
    [{ settings: { articlePolicy: { mode: 'allowlist' } } }, issue()],
    [{ settings: { limits: { bodyCodepoints: 2 } } }, issue()],
    [{}, issue({ body: issueBody({ replyTo: record(99).id }) })],
    [{ records: [record(99, { blog_id: 'other/path' })] }, issue({ body: issueBody({ replyTo: record(99).id }) })],
    [{ settings: { limits: { maxReplyDepth: 0 } }, records: [record(99)] }, issue({ body: issueBody({ replyTo: record(99).id }) })],
  ];
  for (const [options, source] of cases) {
    const mock = new MockGitHub(options);
    await assert.rejects(runIntake(intakeOptions(mock, source)));
    assert.equal(mock.issues.get(1).state, 'open'); assert.equal(writes(mock).length, 0);
  }
});
test('manual conversion needs issue_number only; rerun reuses saved body without reading edited Issue', async () => {
  const mock = new MockGitHub(); mock.issues.set(1, issue());
  const first = await runIntake(dispatchOptions(mock));
  mock.issues.get(1).body = 'Edited and no longer routable'; mock.calls.length = 0;
  const second = await runIntake(dispatchOptions(mock));
  assert.equal(second.candidate.sha, first.candidate.sha);
  assert.equal(second.candidate.record.body_markdown, 'Hello **Markdown**');
  assert.equal(second.pr.number, first.pr.number); assert.equal(mock.pulls.length, 1);
  assert.equal(mock.calls.some(c => c.method === 'GET' && c.path === '/issues/1'), false);
  assert.equal(mock.calls.some(c => c.method === 'POST' && ['/pulls', '/git/refs', '/git/commits'].includes(c.path)), false);
});
test('PR creation failure leaves saved candidate and open Issue; retry uses that record and creates one PR', async () => {
  const mock = new MockGitHub(); mock.fault(c => c.method === 'POST' && c.path === '/pulls');
  await assert.rejects(runIntake(intakeOptions(mock)));
  const saved = mock.refs.get('heads/comment-1'); assert.ok(saved); assert.equal(mock.issues.get(1).state, 'open');
  mock.issues.get(1).body = issueBody({ body: 'Edited body should not be captured' });
  const result = await runIntake(dispatchOptions(mock));
  assert.equal(result.candidate.sha, saved); assert.equal(result.candidate.record.body_markdown, 'Hello **Markdown**');
  assert.equal(mock.pulls.length, 1); assert.equal(mock.issues.get(1).state, 'closed');
});
test('lost branch/PR responses recover the existing candidate and PR without duplication', async () => {
  for (const path of ['/git/refs', '/pulls']) {
    const mock = new MockGitHub(); mock.fault(c => c.method === 'POST' && c.path === path, { after: true });
    const result = await runIntake(intakeOptions(mock));
    assert.equal(result.status, 'pending'); assert.equal(mock.pulls.length, 1);
    assert.equal(mock.issues.get(1).state, 'closed');
  }
});
test('failed head validation never closes the Issue; failed close retries the same PR', async () => {
  const mock = new MockGitHub();
  mock.fault(c => c.method === 'GET' && /\/pulls\/\d+\/files$/.test(c.path));
  await assert.rejects(runIntake(intakeOptions(mock)));
  assert.equal(mock.issues.get(1).state, 'open'); assert.equal(mock.calls.some(c => c.method === 'PATCH' && c.path === '/issues/1'), false);
  mock.fault(c => c.method === 'PATCH' && c.path === '/issues/1');
  await assert.rejects(runIntake(dispatchOptions(mock))); assert.equal(mock.issues.get(1).state, 'open');
  await runIntake(dispatchOptions(mock)); assert.equal(mock.pulls.length, 1); assert.equal(mock.issues.get(1).state, 'closed');
});
test('closed or merged PR remains closed even if its branch was deleted', async () => {
  for (const merged of [false, true]) {
    const mock = new MockGitHub(); const first = await runIntake(intakeOptions(mock));
    mock.closePR(first.pr.number, merged); mock.refs.delete('heads/comment-1'); mock.calls.length = 0;
    const result = await runIntake(dispatchOptions(mock));
    assert.equal(result.status, merged ? 'approved' : 'rejected'); assert.equal(mock.pulls.length, 1);
    assert.equal(mock.pulls[0].state, 'closed');
    assert.deepEqual(writes(mock), [{ method: 'PATCH', path: '/issues/1', body: { state: 'closed' } }]);
  }
});
test('reply PR includes approved parent context and the entire comment', async () => {
  const mock = new MockGitHub({ records: [record(99, { body_markdown: 'Parent line\nParent end' })] });
  const body = 'First line\n' + '😀'.repeat(3000) + '\nEnd of full body';
  const result = await runIntake(intakeOptions(mock, issue({ body: issueBody({ replyTo: record(99).id, body }) })));
  assert.match(result.pr.body, /回复的评论/); assert.match(result.pr.body, /@user\\-99/);
  assert.match(result.pr.body, /> Parent end/); assert.ok(result.pr.body.includes('😀'.repeat(3000)));
  assert.match(result.pr.body, /> End of full body/); assert.doesNotMatch(result.pr.body, /\/issues\//);
});

test('a head change after successful validation still leaves the source Issue open', async () => {
  const mock = new MockGitHub(), request = mock.client.request;
  mock.client.request = async (...args) => {
    const response = await request(...args);
    if (args[0] === 'POST' && args[1].includes('/statuses/') && args[2].state === 'success') {
      const old = mock.refs.get('heads/comment-1');
      const entries = mock.entries(old);
      entries.push({ path: 'evil.mjs', mode: '100644', type: 'blob', sha: mock.blob('bad') });
      mock.refs.set('heads/comment-1', mock.commit(mock.seedTree(entries), [old]));
    }
    return response;
  };
  await assert.rejects(runIntake(intakeOptions(mock)), /head or base changed/);
  assert.equal(mock.issues.get(1).state, 'open');
  assert.equal(mock.calls.some(c => c.method === 'PATCH' && c.path === '/issues/1'), false);
});

for (const merged of [false, true]) {
  test(`failed Issue closure recovers after the review PR is ${merged ? 'merged' : 'rejected'}`, async () => {
    const mock = new MockGitHub();
    mock.fault(c => c.method === 'PATCH' && c.path === '/issues/37');
    await assert.rejects(runIntake(intakeOptions(mock, issue({ number: 37 }))), e => e.status === 503);
    assert.equal(mock.issues.get(37).state, 'open');
    assert.equal(mock.statuses.at(-1).state, 'success');
    assert.equal(mock.pulls.length, 1);
    const number = mock.pulls[0].number;
    mock.closePR(number, merged);
    mock.refs.delete('heads/comment-37');
    mock.issues.get(37).body = 'Edited Issue: no valid metadata and no recapture';
    const processed = structuredClone(mock.pulls[0]);
    for (let attempt = 0; attempt < 2; attempt++) {
      mock.calls.length = 0;
      const result = await runIntake(dispatchOptions(mock, 37));
      assert.equal(result.status, merged ? 'approved' : 'rejected');
      assert.equal(result.pr.number, number);
      assert.equal(mock.issues.get(37).state, 'closed');
      assert.equal(mock.pulls.length, 1);
      assert.deepEqual(mock.pulls[0], processed);
      assert.deepEqual(writes(mock), [{ method: 'PATCH', path: '/issues/37', body: { state: 'closed' } }]);
      assert.equal(mock.calls.some(c => c.method === 'GET' && c.path === '/issues/37'), false);
      assert.equal(mock.calls.some(c => c.path.startsWith('/git/commits/')), false);
    }
  });
}

test('reviews closing at later conversion steps also close the Issue without reopening the PR', async () => {
  for (const stage of ['create', 'validation', 'presentation']) {
    const mock = new MockGitHub(), request = mock.client.request;
    mock.client.request = async (...args) => {
      const response = await request(...args);
      if (stage === 'create' && args[0] === 'POST' && args[1].endsWith('/pulls')) return mock.closePR(response.number);
      if (args[0] === 'POST' && args[1].includes('/statuses/') && args[2].state === 'success') {
        if (stage === 'validation') mock.closePR(mock.pulls[0].number);
        if (stage === 'presentation') mock.pulls[0].body = 'Presentation needs repair';
      }
      if (stage === 'presentation' && args[0] === 'PATCH' && /\/pulls\/\d+$/.test(args[1])) mock.closePR(mock.pulls[0].number);
      return response;
    };
    const result = await runIntake(intakeOptions(mock));
    assert.equal(result.status, 'rejected');
    assert.equal(mock.issues.get(1).state, 'closed');
    assert.equal(mock.pulls.length, 1);
    assert.equal(mock.pulls[0].state, 'closed');
    const issueClose = mock.calls.filter(c => c.method === 'PATCH' && c.path === '/issues/1');
    assert.deepEqual(issueClose, [{ method: 'PATCH', path: '/issues/1', body: { state: 'closed' } }]);
    assert.equal(mock.calls.some(c => c.method === 'PATCH' && c.path.startsWith('/pulls/') && Object.hasOwn(c.body, 'state')), false);
  }
});


test('distinct Issues at the same timestamp produce deterministic IDs and keep both records', async () => {
  const mock = new MockGitHub();
  const first = await runIntake(intakeOptions(mock));
  const second = await runIntake(intakeOptions(mock, issue({ number: 2 })));
  assert.notEqual(first.candidate.record.id, second.candidate.record.id);
  assert.equal(first.candidate.record.created_at, second.candidate.record.created_at);
  assert.equal(first.candidate.record.blog_id, second.candidate.record.blog_id);
  assert.equal(first.candidate.record.id, `${ARTICLE}/comments-1`);
  assert.equal(second.candidate.record.id, `${ARTICLE}/comments-2`);
  assert.equal(mock.calls.some(call => call.path.startsWith('/git/matching-refs/')), false);
  const repeated = await runIntake(dispatchOptions(mock));
  assert.equal(repeated.candidate.record.id, first.candidate.record.id);
  mock.closePR(first.pr.number, true);
  mock.closePR(second.pr.number, true);
  const files = mock.contents(mock.refs.get('heads/comments'));
  assert.ok(files[first.candidate.path]); assert.ok(files[second.candidate.path]);
});

test('Issue IDs are deterministic, readable and limited to positive safe integers', () => {
  assert.equal(createCommentId(ARTICLE, 37), `${ARTICLE}/comments-37`);
  assert.equal(createCommentId(ARTICLE, 37), createCommentId(ARTICLE, 37));
  assert.equal(createCommentId('文章/随笔/hello.world', 9007199254740991), '文章/随笔/hello.world/comments-9007199254740991');
  for (const number of [0, -1, 1.5, '37', NaN, 9007199254740992]) assert.throws(() => createCommentId(ARTICLE, number));
  assert.throws(() => createCommentId('../unsafe', 1));
});
