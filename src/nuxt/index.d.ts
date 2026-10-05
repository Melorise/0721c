import type { ContentConfig0721c } from '../content/vue.js';
export interface ModuleOptions extends Omit<ContentConfig0721c, 'fetchImpl'> {}
/** Structurally compatible Nuxt module; does not pull Nuxt's entire type graph into browser consumers. */
interface Module0721c {
  (inlineOptions?: ModuleOptions, nuxt?: unknown): Promise<void>;
  getMeta(): Promise<{ name: string; configKey: 'comments0721c'; compatibility: { nuxt: string } }>;
  getOptions(inlineOptions?: ModuleOptions, nuxt?: unknown): Promise<ModuleOptions>;
}
declare const module0721c: Module0721c;
export default module0721c;
