export const ARTICLE_ID = 'article/essay/slug';

export function comment(number, options = {}) {
  const created_at = options.created_at ?? new Date(Date.parse('2026-10-02T09:00:00Z') + number * 1000).toISOString();
  return {
    id: `${ARTICLE_ID}/comments-${number}`, reply_to: null,
    author: { login: `user-${number}`, avatar_url: `https://avatars.githubusercontent.com/u/${number}` },
    created_at, body_markdown: `Comment ${number}`, children: [],
    ...options,
  };
}

export function chain(depth) {
  const root = comment(100);
  let parent = root;
  for (let offset = 1; offset <= depth; offset++) {
    const child = comment(100 + offset, { reply_to: parent.id });
    parent.children.push(child);
    parent = child;
  }
  return root;
}

export function snapshot({ articleId = ARTICLE_ID, comments = [], enabled = true } = {}) {
  comments = structuredClone(comments);
  const stack = [...comments];
  let total = 0;
  while (stack.length) {
    const node = stack.pop();
    const forArticle = id => `${articleId}/${id.slice(id.lastIndexOf('/') + 1)}`;
    node.id = forArticle(node.id);
    if (node.reply_to !== null) node.reply_to = forArticle(node.reply_to);
    total++;
    stack.push(...node.children);
  }
  return {
    index: {
      blog_id: articleId, total_count: total, root_count: comments.length,
      comments_enabled: enabled, comments,
    },
  };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

/** Local-only transport: unknown URLs fail instead of reaching the network. */
export function transport(initial = snapshot(), status = 200) {
  let current = initial;
  let failure = null;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (failure) throw failure;
    if (new URL(url).hostname === 'api.github.com') return jsonResponse({ ref: 'refs/heads/index', object: { type: 'commit', sha: 'a'.repeat(40) } });
    const path = decodeURIComponent(new URL(url).pathname);
    if (path.endsWith(`/${current.index.blog_id}.json`)) return jsonResponse(current.index, status);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  return { calls, fetchImpl, setSnapshot(value) { current = value; }, fail(value) { failure = value; } };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}


/** Offline visual fixture for main's isolated desktop/mobile screenshots. */
export function layoutSnapshot() {
  const root = chain(3);
  const authors = ['Maple', 'River', 'Moss', 'Leaf'];
  let node = root;
  for (let depth = 0; node; depth++, node = node.children[0]) {
    node.author = { login: authors[depth] };
    node.body_markdown = [
      '**秋日随笔**，从一段可以慢慢阅读的评论开始。',
      '长篇中文段落应当自然换行，头像位于左侧，正文始终拥有足够的宽度。'.repeat(depth === 0 ? 12 : 5),
      '> 引用也保留段落的呼吸感。',
      '- 保留文章的完整路径\n- 回复指向准确的父评论',
      '`https://example.invalid/' + 'readable-path-'.repeat(12) + '`',
      '最后一段完整可读。',
    ].join('\n\n');
  }
  const second = comment(200, {
    author: { login: 'Pine' },
    body_markdown: '另一条评论。\n\n```js\nconst articleId = "article/essay/slug";\n```',
  });
  return snapshot({ comments: [root, second] });
}
