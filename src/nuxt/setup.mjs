import { mergeMessages } from '../vue/messages.mjs';

export const DEFAULT_NUXT_OPTIONS = Object.freeze({
  enabled: true, repository: '', siteUrl: '', locale: 'zh-CN', timeZone: '', indexBaseUrl: '', cacheTtlMs: 60000, messages: Object.freeze({}),
  content: Object.freeze({ pathPrefixes: Object.freeze([]), markdownOnly: true }),
});

/** Injected kit helpers make registration testable without building any website. */
export function setup0721cNuxt(options, nuxt, kit) {
  const resolver = kit.createResolver(import.meta.url);
  const publicConfig = nuxt.options.runtimeConfig.public ??= {};
  const previous = publicConfig.comments0721c ?? {};
  // Explicit public allowlist: never serialize arbitrary module options/tokens.
  const selected = {};
  for (const field of ['enabled', 'repository', 'locale', 'timeZone', 'indexBaseUrl', 'cacheTtlMs']) selected[field] = previous[field] ?? options[field] ?? DEFAULT_NUXT_OPTIONS[field];
  selected.siteUrl = previous.siteUrl ?? (options.siteUrl || nuxt.options.site?.url || '');
  selected.messages = mergeMessages(options.messages, previous.messages);
  selected.content = {
    pathPrefixes: previous.content?.pathPrefixes ?? options.content?.pathPrefixes ?? [],
    markdownOnly: previous.content?.markdownOnly ?? options.content?.markdownOnly ?? true,
  };
  publicConfig.comments0721c = selected;
  const style = resolver.resolve('../../styles/index.css');
  if (!nuxt.options.css.includes(style)) nuxt.options.css.push(style);
  kit.addPlugin({ src: resolver.resolve('./plugin.mjs') });
  kit.addComponent({ name: 'ContentComments0721c', filePath: resolver.resolve('../content/comments.mjs'), export: 'ContentComments0721c' });
}
