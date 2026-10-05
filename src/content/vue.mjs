import { computed, toValue } from 'vue';
import { create0721c } from '../vue/index.mjs';
import { CONTENT_CONFIG_KEY, normalizeContentOptions } from './identity.mjs';

export { ContentComments0721c } from './comments.mjs';
export { resolveContentArticle, normalizeContentOptions } from './identity.mjs';

/** Registers one app-local configuration for generated Markdown pages. */
export function createContent0721c(options) {
  const config = computed(() => toValue(options) ?? {});
  return { install(app) {
    app.use(create0721c(() => config.value));
    app.provide(CONTENT_CONFIG_KEY, computed(() => normalizeContentOptions(config.value.content)));
  } };
}
