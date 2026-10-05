export interface MarkdownRenderer {
  /** Returns only HTML sanitized using the renderer's fixed allowlist. */
  render(source: string, options?: { imageLabel?: string }): string;
}
export declare function safeHttpUrl(value: unknown): string | null;
export declare function createMarkdownRenderer(windowLike: Window): Promise<MarkdownRenderer>;
