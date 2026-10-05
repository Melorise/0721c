/** Comment UI text overrides. Use {count} or {login} in the corresponding templates. */
export interface Messages0721c {
  title?: string;
  refresh?: string;
  retry?: string;
  post?: string;
  reply?: string;
  loading?: string;
  refreshing?: string;
  empty?: string;
  disabled?: string;
  error?: string;
  stale?: string;
  more?: string;
  total?: string;
  parent?: string;
  avatar?: string;
  comment?: string;
  image?: string;
  invalidTimeZone?: string;
  invalidDocument?: string;
}
export declare function mergeMessages(...sources: (Messages0721c | undefined)[]): Messages0721c;
export declare function resolveMessages(locale: string, overrides?: Messages0721c): Required<Messages0721c>;
export declare function formatMessage(template: string, values: { count?: number; login?: string }): string;
