import type { App } from 'vue';
declare const plugin: {
  name: string;
  setup(nuxtApp: { vueApp: App }): void;
};
export default plugin;
