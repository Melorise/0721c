const defaults = {
  'zh-CN': {
    title: '评论', refresh: '刷新', retry: '重试', post: '发表评论', reply: '回复',
    loading: '正在加载评论…', refreshing: '正在刷新…',
    empty: '暂无评论', disabled: '本文未开放评论',
    error: '评论加载失败，请重试', stale: '刷新失败，请重试',
    more: '显示更多（{count} 个话题）', total: '{count} 条评论',
    parent: '回复 @{login}', avatar: '{login} 的头像',
    comment: '{login} 的评论', invalidDocument: '本文的评论配置无效，请检查文档标识或评论设置', image: '图片', invalidTimeZone: '评论时区配置无效，请检查 timeZone',
  },
  en: {
    title: 'Comments', refresh: 'Refresh', retry: 'Retry', post: 'Post a comment', reply: 'Reply',
    loading: 'Loading comments…', refreshing: 'Refreshing…',
    empty: 'No comments yet', disabled: 'Comments are closed for this article',
    error: 'Unable to load comments. Please retry', stale: 'Refresh failed. Please retry',
    more: 'Show {count} more threads', total: '{count} comments',
    parent: 'Reply to @{login}', avatar: 'Avatar for {login}',
    comment: 'Comment by {login}', invalidDocument: 'Comment configuration for this document is invalid', image: 'Image', invalidTimeZone: 'Invalid comment time zone. Check timeZone',
  },
};

/** Merge supported string overrides; undefined entries inherit earlier values. */
export function mergeMessages(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const key of Object.keys(defaults['zh-CN'])) {
      if (typeof source?.[key] === 'string') merged[key] = source[key];
    }
  }
  return merged;
}

export function resolveMessages(locale, overrides) {
  return { ...(defaults[locale] ?? defaults['zh-CN']), ...mergeMessages(overrides) };
}

export function formatMessage(template, values) {
  return template.replace(/\{(count|login)\}/g, (token, key) => values[key] === undefined ? token : String(values[key]));
}
