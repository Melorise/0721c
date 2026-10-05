import { createApp, h, reactive } from 'vue';
import type { ComputedRef, Plugin } from 'vue';
import { Comments0721c, create0721c, provide0721cConfig, use0721cConfig } from '../../src/vue/index.js';
import { create0721c as DirectPlugin } from '../../src/vue/config.js';
import type { Options0721c, Config0721cOptions, Config0721cSource, Config0721c } from '../../src/vue/index.js';
import type {
  Comments0721cProps, Comments0721cExposed, Comments0721cSlots,
  Comments0721cSlotContext,
} from '../../src/vue/index.js';
import { Comments0721c as DirectComponent } from '../../src/vue/comments.js';
import type { MarkdownRenderer } from '../../src/vue/markdown.js';

const props: Comments0721cProps = {
  repository: 'fixtures/comments', articleId: 'article/essay/slug', locale: 'en',
  cacheTtlMs: 0, fetchImpl: async () => new Response('{}'), title: 'Discussion',
};
h(Comments0721c, props);
h(DirectComponent, props);
const exposed = (component: InstanceType<typeof Comments0721c>): Promise<void> => component.refresh();
const refresh = (component: Comments0721cExposed): Promise<void> => component.refresh();
const slots: Comments0721cSlots = {
  footer: (context: Comments0721cSlotContext) => h('span', String(context.totalCount)),
};
// @ts-expect-error Only the custom footer slot is public.
const badSlot: Comments0721cSlots = { header: () => h('span') };
// @ts-expect-error Comment action slots were removed in 0.2.0.
const badCommentSlot: Comments0721cSlots = { 'comment-footer': () => h('span') };
void [badSlot, badCommentSlot];
const render = (renderer: MarkdownRenderer): string => renderer.render('**text**', { imageLabel: 'Image' });
// @ts-expect-error Vue locale must match the core contract.
const badLocale: Comments0721cProps = { repository: 'fixtures/comments', articleId: 'article/essay/slug', locale: 'es' };
// @ts-expect-error The articleId is required.
const missingArticle: Comments0721cProps = { repository: 'fixtures/comments' };
// @ts-expect-error Fetch is a function, not a Promise.
const badFetch: Comments0721cProps = { repository: 'fixtures/comments', articleId: 'article/essay/slug', fetchImpl: Promise.resolve(new Response()) };
void [exposed, refresh, slots, render, badLocale, missingArticle, badFetch];


const providerOptions = reactive<Options0721c>({ repository: '', enabled: true, locale: 'en' });
const providerSource: Config0721cSource = () => providerOptions;
const plugin: Plugin = create0721c(providerSource);
createApp({}).use(plugin);
createApp({}).use(create0721c({ repository: 'fixtures/comments', enabled: false }));
createApp({}).use(DirectPlugin());
const unified: ComputedRef<Readonly<Config0721c>> = use0721cConfig();
const inherited: ComputedRef<Readonly<Config0721c>> = provide0721cConfig({ cacheTtlMs: 0 });
const alias: Config0721cOptions = { fetchImpl: async () => new Response('{}') };
const lowLevelProps: Comments0721cProps = { articleId: 'article/essay/slug' };
h(Comments0721c, lowLevelProps);
h(Comments0721c, { articleId: 'article/essay/slug', enabled: false });
const locale: 'zh-CN' | 'en' = unified.value.locale;
const enabled: boolean = unified.value.enabled;
const cacheTtlMs: number = unified.value.cacheTtlMs;
const repository: string = unified.value.repository;
// @ts-expect-error Plugin locale follows the core's supported locales.
create0721c({ locale: 'es' });
// @ts-expect-error Enabled is a boolean.
create0721c({ enabled: 'false' });
// @ts-expect-error Runtime config getters must return the config object.
create0721c(() => 'fixtures/comments');
// @ts-expect-error Computed provider config cannot be mutated by a consumer.
unified.value.repository = 'changed/comments';
// @ts-expect-error Only repository becomes optional; articleId remains required.
const missingLowLevelId: Comments0721cProps = {};
void [inherited, alias, locale, enabled, cacheTtlMs, repository, missingLowLevelId];

create0721c({ repository: 'fixtures/comments', timeZone: 'Asia/Shanghai' });
h(Comments0721c, { articleId: 'article/essay/slug', timeZone: 'America/New_York' });
const displayTimeZone: string | undefined = unified.value.timeZone;
// @ts-expect-error Display time zone must be a string.
create0721c({ timeZone: 8 });
// @ts-expect-error Display time zone must be a string.
h(Comments0721c, { articleId: 'article/essay/slug', timeZone: 8 });
void displayTimeZone;

import type { Messages0721c } from '../../src/vue/index.js';
const messages: Messages0721c = { error: '请检查 GitHub 连接', total: '{count} 条留言', parent: '回复 {login}' };
create0721c({ messages });
h(Comments0721c, { articleId: 'article/example', messages: { empty: '' } });
const inheritedMessages: Readonly<Messages0721c> = unified.value.messages;
// @ts-expect-error Message overrides are serializable strings.
create0721c({ messages: { total: (count: number) => `${count}条` } });
// @ts-expect-error Message keys must exist in the UI contract.
create0721c({ messages: { unknownMessage: 'Text' } });
void inheritedMessages;
