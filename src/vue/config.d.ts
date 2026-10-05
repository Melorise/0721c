import type { ComputedRef, Plugin } from 'vue';
import type { ClientOptions } from '../core/index.js';
import type { Messages0721c } from './messages.js';

export interface Options0721c {
  messages?: Messages0721c;
  /** Blank means unconfigured; no comments UI or network requests are created. */
  repository?: ClientOptions['repository'];
  siteUrl?: string;
  locale?: ClientOptions['locale'];
  /** IANA time zone, e.g. Asia/Shanghai. Omitted follows the visitor's time zone. */
  timeZone?: string;
  indexBaseUrl?: ClientOptions['indexBaseUrl'];
  cacheTtlMs?: ClientOptions['cacheTtlMs'];
  fetchImpl?: ClientOptions['fetchImpl'];
  /** Defaults to true; false hides the UI and cancels active reads. */
  enabled?: boolean;
}
export type Config0721cOptions = Options0721c;
export type Config0721cSource = Options0721c | (() => Options0721c);

/** Merged defaults: blank repository, zh-CN, 60000ms cache, enabled true. */
export interface Config0721c {
  messages: Readonly<Messages0721c>;
  repository: ClientOptions['repository'];
  siteUrl: string | undefined;
  locale: NonNullable<ClientOptions['locale']>;
  timeZone: string | undefined;
  indexBaseUrl: ClientOptions['indexBaseUrl'];
  cacheTtlMs: NonNullable<ClientOptions['cacheTtlMs']>;
  fetchImpl: ClientOptions['fetchImpl'];
  enabled: boolean;
}

export declare function create0721c(optionsOrGetter?: Config0721cSource): Plugin;
export declare function use0721cConfig(): ComputedRef<Readonly<Config0721c>>;
/** Call during component setup to override the inherited config for descendants. */
export declare function provide0721cConfig(optionsOrGetter?: Config0721cSource): ComputedRef<Readonly<Config0721c>>;
