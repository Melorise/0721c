import type { DefineComponent, Plugin, MaybeRefOrGetter } from 'vue';
import type { ContentDocument0721c, ContentOptions0721c } from './index.js';
import type { Comments0721cSlots, Messages0721c } from '../vue/index.js';
export type { Messages0721c } from '../vue/index.js';
export * from './index.js';
export interface ContentConfig0721c {
  messages?: Messages0721c;
  repository?: string; siteUrl?: string; enabled?: boolean; locale?: 'zh-CN' | 'en'; indexBaseUrl?: string;
  timeZone?: string; cacheTtlMs?: number; fetchImpl?: typeof globalThis.fetch; content?: ContentOptions0721c;
}
export declare function createContent0721c(options: MaybeRefOrGetter<ContentConfig0721c>): Plugin;
export declare const ContentComments0721c: DefineComponent<{ document?: ContentDocument0721c | null }> & {
  new(): { $slots: Comments0721cSlots };
};
