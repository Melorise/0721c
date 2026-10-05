import { computed, defineComponent, h, inject } from 'vue';
import { Comments0721c, use0721cConfig } from '../vue/index.mjs';
import { CONTENT_CONFIG_KEY, resolveContentArticle } from './identity.mjs';
import { resolveMessages } from '../vue/messages.mjs';

export const ContentComments0721c = defineComponent({
  name: 'ContentComments0721c',
  inheritAttrs: false,
  props: { document: { type: Object, default: null } },
  setup(props, { attrs, slots }) {
    const config = use0721cConfig();
    const content = inject(CONTENT_CONFIG_KEY, computed(() => ({})));
    const article = computed(() => {
      if (config.value.enabled === false || !config.value.repository) return { value: null, error: false };
      try { return { value: resolveContentArticle(props.document, content.value), error: false }; }
      catch { return { value: null, error: true }; }
    });
    const articleTitle = computed(() => typeof props.document?.title === 'string' ? props.document.title.replace(/\s+/g, ' ').trim() : undefined);
    const articleUrl = computed(() => {
      const path = props.document?.path;
      const base = config.value.siteUrl || (typeof window === 'undefined' ? undefined : window.location.origin);
      if (!base || typeof path !== 'string' || !/^\/(?!\/)/.test(path)) return undefined;
      try { return new URL(path, base).href; } catch { return undefined; }
    });
    return () => {
      if (article.value.error) return h('p', { ...attrs, class: ['c0721c-content-error', attrs.class], role: 'alert' },
        resolveMessages(config.value.locale, config.value.messages).invalidDocument);
      return article.value.value ? h(Comments0721c, { ...attrs, articleId: article.value.value.articleId, articleTitle: articleTitle.value, articleUrl: articleUrl.value }, slots) : null;
    };
  },
});
