import { createClient } from '0721c';

// Importable factory, not an automatically executed network request.
export function connectComments(repository, articleId) {
  const client = createClient({ repository, locale: 'zh-CN' });
  return {
    issueUrl: client.getNewIssueUrl({ articleId }),
    read: (options) => client.getComments(articleId, options)
  };
}
