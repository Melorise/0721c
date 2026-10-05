import type { DefineComponent, VNodeChild } from 'vue';
import type { createClient } from '../core/index.js';
export { create0721c, use0721cConfig, provide0721cConfig } from './config.js';
export type { Options0721c, Config0721cOptions, Config0721cSource, Config0721c } from './config.js';

type ClientOptions = Parameters<typeof createClient>[0];
type Client = ReturnType<typeof createClient>;
type CommentsResult = Awaited<ReturnType<Client['getComments']>>;

/** Article information and display options for the comment component. */
export interface Comments0721cProps {
  /** Overrides the app provider when defined. */
  repository?: ClientOptions['repository'];
  articleId: Parameters<Client['getComments']>[0];
  articleTitle?: string;
  articleUrl?: string;
  locale?: ClientOptions['locale'];
  /** Overrides the provider's display time zone. */
  timeZone?: string;
  indexBaseUrl?: ClientOptions['indexBaseUrl'];
  cacheTtlMs?: ClientOptions['cacheTtlMs'];
  /** Injectable fetch for offline tests or a host-controlled transport. */
  fetchImpl?: ClientOptions['fetchImpl'];
  enabled?: boolean;
  title?: string;
}

export interface Comments0721cExposed {
  /** Reloads the current article directly, bypassing the core cache. */
  refresh(): Promise<void>;
}

export interface Comments0721cSlotContext {
  title: string;
  articleId: Comments0721cProps['articleId'];
  status: 'loading' | 'error' | CommentsResult['status'];
  busy: boolean;
  totalCount: number;
  rootCount: number;
  canComment: boolean;
  newIssueUrl: string | null;
  refresh(): Promise<void>;
}

export interface Comments0721cSlots {
  /** Optional custom content below the comments. No default footer is rendered. */
  footer?: (props: Comments0721cSlotContext) => VNodeChild;
}

export declare const Comments0721c: DefineComponent<Comments0721cProps, Comments0721cExposed> & {
  new(): { $slots: Comments0721cSlots };
};
