import { defineNuxtPlugin, useRuntimeConfig } from '#app';
import { createContent0721c } from '../content/vue.mjs';

export default defineNuxtPlugin({
  name: '0721c-content-config',
  setup(nuxtApp) {
    const runtime = useRuntimeConfig();
    nuxtApp.vueApp.use(createContent0721c(() => {
      const config = runtime.public.comments0721c;
      return { ...config, indexBaseUrl: config.indexBaseUrl || undefined };
    }));
  },
});
