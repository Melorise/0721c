import { defineNuxtModule, addPlugin, addComponent, createResolver } from '@nuxt/kit';
import { setup0721cNuxt, DEFAULT_NUXT_OPTIONS } from './setup.mjs';

export default defineNuxtModule({
  meta: { name: '0721c-nuxt-content', configKey: 'comments0721c', compatibility: { nuxt: '>=3.17.0 <5' } },
  defaults: () => ({ ...DEFAULT_NUXT_OPTIONS, messages: {}, content: { pathPrefixes: [], markdownOnly: true } }),
  setup(options, nuxt) { setup0721cNuxt(options, nuxt, { addPlugin, addComponent, createResolver }); },
});
