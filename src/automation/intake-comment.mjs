import { randomBytes } from 'node:crypto';
import { commentTimestamp } from '../core/shared.mjs';
import { parseIssueBody, validateCommentRecord, assertArticleId } from '../core/index.mjs';
import { buildIndexes, commentsEnabled } from './build-index.mjs';
import { validatePullRequest } from './validate-comment.mjs';
import { buildReviewPullRequest } from './review-presentation.mjs';
import { actionContext, loadDeployment, requiredRef, readRecords, readTree, parseRecordPath, ref, list, positiveInteger, inputNumber, candidateFromCommit, createCommit, recordPath, serialize, isDirectEntry, reportFailure } from './runtime.mjs';

// A saved Issue branch makes retries reuse the first capture; it is not the comment ID.
export function createCommentId(articleId, createdAt, existingIds = new Set(), entropy = randomBytes) {
  const prefix = `${assertArticleId(articleId)}/${commentTimestamp(createdAt)}-`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = entropy(6).toString('hex');
    if (!/^[0-9a-f]{12}$/.test(suffix)) throw new Error('Invalid comment ID entropy');
    const id = prefix + suffix;
    if (!existingIds.has(id)) return id;
  }
  throw new Error('Unable to allocate a unique comment ID; existing comments were not changed');
}
export async function findCommentPullRequest(client, number) {
  const branch = `comment-${positiveInteger(number, 'Issue number')}`;
  const prs = await list(client, `${client.basePath}/pulls?state=all&base=comments&head=${encodeURIComponent(`${client.owner}:${branch}`)}`);
  const matching = prs.filter(pr => pr.base?.ref === 'comments' && pr.head?.ref === branch &&
    pr.head?.repo?.full_name?.toLowerCase() === `${client.owner}/${client.repo}`.toLowerCase());
  if (matching.length > 1) throw new Error('Multiple review PRs for one Issue');
  return matching[0] ?? null;
}
async function closedResult(client, number, pr, repositoryId) {
  assertReviewHead(pr, pr.head?.sha, String(number), repositoryId);
  // A confirmed review already processed this conversion; retry a failed Issue close.
  await client.request('PATCH', `${client.basePath}/issues/${number}`, { state: 'closed' });
  return { status: pr.merged_at ? 'approved' : 'rejected', pr };
}
function assertReviewHead(pr, sha, id, repositoryId) {
  if (pr.head?.sha !== sha || pr.head?.ref !== `comment-${id}` || pr.base?.ref !== 'comments' ||
      pr.base?.repo?.id !== repositoryId || pr.head?.repo?.id !== repositoryId) throw new Error('PR head or base changed after validation');
}

export async function runIntake({ client, event, eventName, mainCommit }) {
  if (eventName !== 'workflow_dispatch' && (eventName !== 'issues' || event.action !== 'opened')) throw new Error('Unsupported intake event');
  const number = eventName === 'workflow_dispatch' ? inputNumber(event.inputs?.issue_number, 'Issue number') : positiveInteger(event.issue?.number, 'Issue number');
  const branch = `comment-${number}`;
  const context = await loadDeployment(client, mainCommit);
  let pr = await findCommentPullRequest(client, number);
  if (pr?.state === 'closed') return closedResult(client, number, pr, context.repository.id);
  const saved = await ref(client, `heads/${branch}`);
  let candidate;
  if (saved || pr) {
    candidate = await candidateFromCommit(client, saved?.object.sha ?? pr.head.sha);
  } else {
    const issue = eventName === 'issues' ? event.issue : await client.request('GET', `${client.basePath}/issues/${number}`);
    if (!issue || issue.pull_request || issue.number !== number) throw new Error('Intake expects the requested Issue, not a PR');
    if (eventName === 'issues' && (typeof issue.body !== 'string' || !issue.body.includes('0721c-meta'))) return { status: 'ignored' };
    const parsed = parseIssueBody(issue.body, context.settings.limits);
    const parent = await requiredRef(client, 'heads/comments');
    const approved = await readRecords(client, parent);
    const existingIds = new Set(approved.records.map(record => record.id));
    const pending = await list(client, `${client.basePath}/git/matching-refs/heads/comment-`);
    for (const saved of pending) {
      const tree = await readTree(client, saved.object.sha);
      for (const entry of tree.entries) {
        if (entry.type === 'blob' && entry.path.endsWith('.json')) existingIds.add(parseRecordPath(entry.path).id);
      }
    }
    const id = createCommentId(parsed.metadata.blog_id, issue.created_at, existingIds);
    const record = validateCommentRecord({
      id, blog_id: parsed.metadata.blog_id, reply_to: parsed.metadata.reply_to,
      author: { login: issue.user?.login, ...(issue.user?.avatar_url ? { avatar_url: issue.user.avatar_url } : {}) },
      created_at: issue.created_at, body_markdown: parsed.body_markdown,
      ...(parsed.article ? { article: parsed.article } : {}),
    });
    if (!commentsEnabled(record.blog_id, context.settings, context.articles)) throw new Error('Article does not accept new comments');
    buildIndexes({ records: [...approved.records, record], settings: context.settings, articles: context.articles });
    const path = recordPath(record);
    const sha = await createCommit(client, { parent, message: `Add comment ${record.id}`, files: { [path]: serialize(record) } });
    try {
      await client.request('POST', `${client.basePath}/git/refs`, { ref: `refs/heads/${branch}`, sha });
      candidate = { sha, record, path };
    } catch (error) {
      // A lost response or concurrent intake must reuse the saved branch, never recapture it.
      const existing = await ref(client, `heads/${branch}`);
      if (!existing) throw error;
      candidate = await candidateFromCommit(client, existing.object.sha);
    }
  }
  const approved = await readRecords(client, await requiredRef(client, 'heads/comments'));
  const presentation = buildReviewPullRequest(candidate.record, {
    articles: context.articles,
    parent: approved.records.find(record => record.id === candidate.record.reply_to && record.blog_id === candidate.record.blog_id),
  });
  if (!pr) {
    try {
      pr = await client.request('POST', `${client.basePath}/pulls`, { head: branch, base: 'comments', ...presentation });
    } catch (error) {
      pr = await findCommentPullRequest(client, number);
      if (!pr) throw error;
    }
  }
  if (pr.state === 'closed') return closedResult(client, number, pr, context.repository.id);
  // Validate the actual live PR head. Candidate code is never checked out or executed.
  const validation = await validatePullRequest({ client, prNumber: pr.number, context });
  if (serialize(validation.record) !== serialize(candidate.record)) throw new Error('PR head differs from the saved candidate');
  pr = await client.request('GET', `${client.basePath}/pulls/${pr.number}`);
  assertReviewHead(pr, validation.headSha, String(number), context.repository.id);
  if (pr.state === 'closed') return closedResult(client, number, pr, context.repository.id);
  if (pr.title !== presentation.title || pr.body !== presentation.body) {
    await client.request('PATCH', `${client.basePath}/pulls/${pr.number}`, presentation);
    pr = await client.request('GET', `${client.basePath}/pulls/${pr.number}`);
    assertReviewHead(pr, validation.headSha, String(number), context.repository.id);
    if (pr.state === 'closed') return closedResult(client, number, pr, context.repository.id);
  }
  // Conversion has succeeded; failures before this point leave the source Issue open.
  await client.request('PATCH', `${client.basePath}/issues/${number}`, { state: 'closed' });
  return { status: 'pending', candidate, pr };
}
if (isDirectEntry(import.meta.url)) {
  actionContext().then(runIntake).then(result => process.stdout.write(`0721c intake: ${result.status}.\n`)).catch(reportFailure);
}
