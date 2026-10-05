import module0721c from '0721c/nuxt';
import type { ModuleOptions } from '0721c/nuxt';
const options: ModuleOptions = { repository: 'owner/comments', content: { pathPrefixes: ['/posts'] } };
void [module0721c, options];
// @ts-expect-error Installation credentials are not public module configuration.
const secret: ModuleOptions = { token: 'do-not-expose' };
void secret;
// Mirrors Nuxt's generated component/plugin import paths (not package aliases).
import { ContentComments0721c as registeredComponent } from '../../src/content/comments.mjs';
import runtimePlugin from '../../src/nuxt/plugin.mjs';
import { h } from 'vue';
h(registeredComponent, { document: { id: 'article/auto.md' } });
void runtimePlugin;

const zonedOptions: ModuleOptions = { repository: 'owner/comments', timeZone: 'Asia/Shanghai' };
// @ts-expect-error Module timeZone must be a string.
const invalidTimeZone: ModuleOptions = { timeZone: 8 };
void [zonedOptions, invalidTimeZone];

const customMessages: ModuleOptions = { messages: { error: '请检查 GitHub 连接', total: '{count} 条留言' } };
// @ts-expect-error Runtime messages must be serializable strings.
const invalidMessages: ModuleOptions = { messages: { empty: false } };
void [customMessages, invalidMessages];
