import { computed, hasInjectionContext, inject, provide } from 'vue';
import { mergeMessages } from './messages.mjs';

// The key is shared; configuration and computed refs are created per installation.
const configurationKey = Symbol('0721c configuration');
const defaults = Object.freeze({
  repository: '', locale: 'zh-CN', timeZone: undefined, indexBaseUrl: undefined, siteUrl: undefined,
  cacheTtlMs: 60000, fetchImpl: undefined, enabled: true, messages: Object.freeze({}),
});

function resolveConfig(source, inherited) {
  return computed(() => {
    const configured = (typeof source === 'function' ? source() : source) ?? {};
    const merged = { ...(inherited?.value ?? defaults) };
    for (const key of Object.keys(defaults)) {
      if (configured[key] !== undefined) merged[key] = configured[key];
    }
    merged.messages = Object.freeze(mergeMessages(inherited?.value.messages, configured.messages));
    return Object.freeze(merged);
  });
}

/** Install once on each Vue app; reactive objects and getters remain reactive. */
export function create0721c(optionsOrGetter = {}) {
  return {
    install(app) {
      app.provide(configurationKey, resolveConfig(optionsOrGetter));
    },
  };
}

/** Always returns a computed, complete configuration, including without a plugin. */
export function use0721cConfig() {
  const inherited = hasInjectionContext() ? inject(configurationKey, null) : null;
  return inherited ?? resolveConfig({});
}

/** Override defined settings for a component subtree, inheriting its app config. */
export function provide0721cConfig(optionsOrGetter = {}) {
  const resolved = resolveConfig(optionsOrGetter, use0721cConfig());
  provide(configurationKey, resolved);
  return resolved;
}
