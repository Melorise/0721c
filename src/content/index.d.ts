export interface ContentDocument0721c {
  id?: string | null;
  title?: string;
  stem?: string | null;
  path?: string | null;
  extension?: string;
  commentId?: string | null;
  comments?: boolean | null;
  meta?: Record<string, unknown>;
}
export interface ContentOptions0721c { pathPrefixes?: string[]; markdownOnly?: boolean }
export interface ContentArticle0721c { articleId: string; identity: 'explicit' | 'stem' | 'path' }
export declare const DEFAULT_CONTENT_OPTIONS: Readonly<{ pathPrefixes: readonly string[]; markdownOnly: true }>;
export declare function normalizeContentOptions(options?: ContentOptions0721c): { pathPrefixes: string[]; markdownOnly: boolean };
export declare function resolveContentArticle(document: ContentDocument0721c | null | undefined, options?: ContentOptions0721c): ContentArticle0721c | null;
