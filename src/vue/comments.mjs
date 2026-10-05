import {
  computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted,
  ref, shallowRef, useId, watch,
} from 'vue';
import { RotateCw } from 'lucide';
import { assertArticleId, createClient } from '../core/index.mjs';
import { use0721cConfig } from './config.mjs';

const ROOT_PAGE_SIZE = 20;
const messages = {
  'zh-CN': {
    title: '评论', refresh: '刷新', retry: '重试', post: '发表评论', reply: '回复',
    loading: '正在加载评论…', refreshing: '正在刷新…',
    empty: '暂无评论。', disabled: '本文未开放评论。',
    error: '评论加载失败，请重试。', stale: '刷新失败，请重试。',
    more: (count) => `显示更多（${count} 个话题）`, total: (count) => `${count} 条评论`,
    parent: (login) => `回复 @${login}`, avatar: (login) => `${login} 的头像`,
    comment: (login) => `${login} 的评论`, image: '图片', invalidTimeZone: '评论时区配置无效，请检查 timeZone。',
  },
  en: {
    title: 'Comments', refresh: 'Refresh', retry: 'Retry', post: 'Post a comment', reply: 'Reply',
    loading: 'Loading comments…', refreshing: 'Refreshing…',
    empty: 'No comments yet.', disabled: 'Comments are closed for this article.',
    error: 'Unable to load comments. Please retry.', stale: 'Refresh failed. Please retry.',
    more: (count) => `Show ${count} more threads`, total: (count) => `${count} comments`,
    parent: (login) => `Reply to @${login}`, avatar: (login) => `Avatar for ${login}`,
    comment: (login) => `Comment by ${login}`, image: 'Image', invalidTimeZone: 'Invalid comment time zone. Check timeZone.',
  },
};

const externalLink = (url, label, className, extra = {}) => h('a', {
  href: url, target: '_blank', rel: 'noopener noreferrer nofollow ugc',
  class: className, ...extra,
}, label);

// SSR and the first hydration pass render escaped, complete plain text.
// Only a successfully sanitized client result is assigned to innerHTML.
const MarkdownBody = defineComponent({
  name: 'Comments0721cMarkdown',
  props: {
    source: { type: String, required: true },
    imageLabel: { type: String, default: 'Image' },
  },
  setup(props) {
    const element = ref(null);
    const html = ref(null);
    let mounted = false;
    let revision = 0;
    async function render() {
      const current = ++revision;
      html.value = null;
      try {
        const { createMarkdownRenderer } = await import('./markdown.mjs');
        const renderer = await createMarkdownRenderer(element.value.ownerDocument.defaultView);
        const sanitized = renderer.render(props.source, { imageLabel: props.imageLabel });
        if (mounted && current === revision) html.value = sanitized;
      } catch {
        // Dependency/DOM failure preserves the full, escaped comment body.
      }
    }
    onMounted(() => { mounted = true; void render(); });
    watch(() => [props.source, props.imageLabel], () => { if (mounted) void render(); });
    onBeforeUnmount(() => { mounted = false; revision++; });
    return () => html.value === null
      ? h('div', { ref: element, class: 'c0721c-body' }, [h('div', { class: 'c0721c-body-plain' }, props.source)])
      : h('div', { ref: element, class: 'c0721c-body', innerHTML: html.value });
  },
});

const Avatar = defineComponent({
  name: 'Comments0721cAvatar',
  props: { author: { type: Object, required: true }, label: { type: String, required: true } },
  setup(props) {
    const broken = ref(false);
    const source = computed(() => {
      const value = props.author.avatar_url;
      if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
      try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
      } catch { return null; }
    });
    watch(source, () => { broken.value = false; });
    return () => h('span', { class: 'c0721c-avatar', role: 'img', 'aria-label': props.label },
      source.value && !broken.value
        ? [h('img', {
          src: source.value, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
          onError: () => { broken.value = true; },
        })]
        : [h('span', { 'aria-hidden': 'true', class: 'c0721c-avatar-fallback' },
          Array.from(props.author.login)[0]?.toUpperCase() || '?')]);
  },
});

export const Comments0721c = defineComponent({
  name: 'Comments0721c',
  props: {
    repository: { type: String, default: undefined },
    articleId: { type: String, required: true },
    articleTitle: { type: String, default: undefined },
    articleUrl: { type: String, default: undefined },
    locale: { type: String, default: undefined },
    timeZone: { type: String, default: undefined },
    indexBaseUrl: { type: String, default: undefined },
    cacheTtlMs: { type: Number, default: undefined },
    fetchImpl: { type: Function, default: undefined },
    enabled: { type: Boolean, default: undefined },
    title: { type: String, default: undefined },
  },
  setup(props, { slots, expose }) {
    const provider = use0721cConfig();
    const config = computed(() => {
      const merged = { ...provider.value };
      for (const key of Object.keys(merged)) {
        if (props[key] !== undefined) merged[key] = props[key];
      }
      return merged;
    });
    const active = computed(() => config.value.enabled !== false
      && !(typeof config.value.repository === 'string' && !config.value.repository.trim()));
    const identity = `0721c-${useId()}`;
    const state = ref('loading');
    const busy = ref(false);
    const result = shallowRef(null);
    const error = shallowRef(null);
    const context = shallowRef(null);
    const visibleRoots = ref(ROOT_PAGE_SIZE);
    const commentElements = new Map();
    const text = computed(() => messages[config.value.locale] ?? messages['zh-CN']);
    const title = computed(() => props.title ?? text.value.title);
    let mounted = false;
    let revision = 0;
    let controller = null;
    let deepLinkRevision = 0;
    const onLocationChange = () => { void revealLinkedComment(); };

    async function revealLinkedComment() {
      const current = ++deepLinkRevision;
      if (!mounted || !result.value) return;
      const target = new URL(window.location.href).searchParams.get('comment');
      if (!target) return;
      const roots = result.value.comments;
      let rootIndex = -1;
      for (let index = 0; index < roots.length; index++) {
        const pending = [roots[index]];
        while (pending.length) {
          const node = pending.pop();
          if (node.id === target) { rootIndex = index; break; }
          pending.push(...node.children);
        }
        if (rootIndex >= 0) break;
      }
      if (rootIndex < 0) return;
      visibleRoots.value = Math.max(visibleRoots.value, Math.ceil((rootIndex + 1) / ROOT_PAGE_SIZE) * ROOT_PAGE_SIZE);
      await nextTick();
      if (!mounted || current !== deepLinkRevision) return;
      const element = commentElements.get(target);
      element?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
      element?.focus({ preventScroll: true });
    }

    async function load(force = false, reset = false) {
      if (!mounted) return;
      const current = ++revision;
      controller?.abort();
      controller = null;
      if (reset || !active.value) {
        context.value = null;
        result.value = null;
        visibleRoots.value = ROOT_PAGE_SIZE;
        state.value = 'loading';
        commentElements.clear();
      }
      error.value = null;
      busy.value = false;
      if (!active.value) return;
      controller = new AbortController();
      const options = config.value;
      busy.value = true;
      try {
        if (!formatter.value) throw new RangeError('Invalid timeZone configuration');
        if (!context.value) {
          assertArticleId(props.articleId);
          const client = createClient({
            repository: options.repository, locale: options.locale,
            indexBaseUrl: options.indexBaseUrl, cacheTtlMs: options.cacheTtlMs,
            fetchImpl: options.fetchImpl,
          });
          context.value = { client };
        }
        const data = await context.value.client.getComments(props.articleId, {
          force, signal: controller.signal,
        });
        if (!mounted || current !== revision) return;
        result.value = data;
        state.value = data.status;
        void revealLinkedComment();
      } catch (failure) {
        if (!mounted || current !== revision) return;
        error.value = failure instanceof Error ? failure : new Error('Unable to load comments.');
        if (!result.value) state.value = 'error';
      } finally {
        if (mounted && current === revision) busy.value = false;
      }
    }

    const refresh = () => load(true);
    expose({ refresh });
    onMounted(() => { mounted = true; window.addEventListener('popstate', onLocationChange); void load(false, true); });
    watch([
      () => config.value.repository, () => props.articleId, () => config.value.locale,
      () => config.value.indexBaseUrl, () => config.value.cacheTtlMs,
      () => config.value.fetchImpl, () => config.value.enabled,
    ], () => { if (mounted) void load(false, true); });
    watch(() => config.value.timeZone, () => {
      if (mounted && !result.value) void load(false, true);
    });
    onBeforeUnmount(() => { mounted = false; revision++; deepLinkRevision++; window.removeEventListener('popstate', onLocationChange); controller?.abort(); commentElements.clear(); });

    const canComment = computed(() => Boolean(active.value && result.value?.commentsEnabled && state.value !== 'disabled'));
    const articleContext = computed(() => props.articleTitle ? { title: props.articleTitle, ...(props.articleUrl ? { url: props.articleUrl } : {}) } : undefined);
    const newIssueUrl = computed(() => canComment.value
      ? context.value.client.getNewIssueUrl({ articleId: props.articleId, replyTo: null, article: articleContext.value }) : null);
    const entries = computed(() => {
      const output = [];
      const stack = (result.value?.comments ?? []).slice(0, visibleRoots.value)
        .map((comment) => ({ comment, depth: 0, parent: null })).reverse();
      while (stack.length) {
        const entry = stack.pop();
        output.push(entry);
        for (let index = entry.comment.children.length - 1; index >= 0; index--) {
          stack.push({ comment: entry.comment.children[index], depth: entry.depth + 1, parent: entry.comment });
        }
      }
      return output;
    });
    const formatter = computed(() => {
      try {
        return new Intl.DateTimeFormat(config.value.locale === 'en' ? 'en' : 'zh-CN', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: config.value.timeZone || undefined,
        });
      } catch {
        return null;
      }
    });
    const liveMessage = computed(() => {
      if (busy.value) return result.value ? text.value.refreshing : text.value.loading;
      if (error.value) return result.value ? text.value.stale : text.value.error;
      if (state.value === 'empty') return text.value.empty;
      if (state.value === 'disabled') return text.value.disabled;
      return result.value ? text.value.total(result.value.totalCount) : text.value.loading;
    });
    const slotContext = () => ({
      title: title.value, articleId: props.articleId, status: state.value, busy: busy.value,
      totalCount: result.value?.totalCount ?? 0, rootCount: result.value?.rootCount ?? 0,
      canComment: canComment.value, newIssueUrl: newIssueUrl.value, refresh,
    });
    const action = (label, callback, className) => h('button', {
      type: 'button', class: className, disabled: busy.value, onClick: callback,
    }, label);
    const commentId = (id) => `${identity}-comment-${id}`;

    function renderComment({ comment, depth, parent }) {
      const replyUrl = canComment.value
        ? context.value.client.getNewIssueUrl({ articleId: props.articleId, replyTo: comment.id, article: articleContext.value }) : null;
      return h('li', {
        key: comment.id, class: ['c0721c-item', { 'c0721c-item-reply': depth > 0 }],
        'data-comment-id': comment.id, 'data-reply-to': comment.reply_to ?? undefined, 'data-depth': depth,
        style: { '--0721c-depth': Math.min(depth, 1), '--0721c-mobile-depth': Math.min(depth, 1) },
      }, [h('article', {
        id: commentId(comment.id), class: 'c0721c-comment', tabindex: -1,
        'aria-label': text.value.comment(comment.author.login),
        ref: (element) => { if (element) commentElements.set(comment.id, element); else commentElements.delete(comment.id); },
      }, [
        h(Avatar, { author: comment.author, label: text.value.avatar(comment.author.login) }),
        h('div', { class: 'c0721c-main' }, [
          h('header', { class: 'c0721c-comment-header' }, [
            h('div', { class: 'c0721c-comment-meta' }, [
              externalLink(`https://github.com/${encodeURIComponent(comment.author.login)}`,
                `@${comment.author.login}`, 'c0721c-author'),
              h('time', { datetime: comment.created_at, title: formatter.value.format(new Date(comment.created_at)) + ' (' + formatter.value.resolvedOptions().timeZone + ')' },
                formatter.value.format(new Date(comment.created_at))),
            ]),
            replyUrl ? externalLink(replyUrl, text.value.reply, 'c0721c-reply', {
              'aria-label': `${text.value.reply}: @${comment.author.login}`,
            }) : null,
          ]),
          parent ? h('a', {
            class: 'c0721c-parent', href: `#${commentId(parent.id)}`,
            onClick: () => { commentElements.get(parent.id)?.focus({ preventScroll: true }); },
          }, text.value.parent(parent.author.login)) : null,
          h(MarkdownBody, { source: comment.body_markdown, imageLabel: text.value.image }),
        ]),
      ])]);
    }

    async function showMore() {
      const first = result.value.comments[visibleRoots.value];
      visibleRoots.value += ROOT_PAGE_SIZE;
      await nextTick();
      if (first) commentElements.get(first.id)?.focus();
    }

    return () => !active.value ? null : !formatter.value
      ? h('p', { class: 'c0721c c0721c-notice c0721c-error', role: 'alert' }, text.value.invalidTimeZone)
      : h('section', {
      class: 'c0721c', 'data-state': state.value, 'data-article-id': props.articleId,
      'aria-labelledby': `${identity}-title`, 'aria-busy': busy.value || state.value === 'loading',
    }, [
      h('header', { class: 'c0721c-header' }, [
        h('h2', { id: `${identity}-title`, class: 'c0721c-title' }, [title.value,
          result.value ? h('span', { class: 'c0721c-count', 'aria-label': text.value.total(result.value.totalCount) }, String(result.value.totalCount)) : null]),
        h('div', { class: 'c0721c-actions' }, [
          h('button', {
            type: 'button', class: 'c0721c-refresh', disabled: busy.value,
            'aria-label': text.value.refresh, title: text.value.refresh, onClick: refresh,
          }, [h(RotateCw[0], {
            ...RotateCw[1], width: 20, height: 20,
            'aria-hidden': 'true', focusable: 'false',
          }, RotateCw[2].map(([tag, attributes]) => h(tag, attributes)))]),
          newIssueUrl.value ? externalLink(newIssueUrl.value, text.value.post, 'c0721c-post') : null,
        ]),
      ]),
      h('p', { class: 'c0721c-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, liveMessage.value),
      state.value === 'loading' ? h('div', { class: 'c0721c-notice c0721c-loading' }, text.value.loading) : null,
      busy.value && result.value ? h('p', { class: 'c0721c-notice c0721c-refreshing' }, text.value.refreshing) : null,
      error.value ? h('div', { class: 'c0721c-notice c0721c-error' }, [
        h('p', null, result.value ? text.value.stale : text.value.error),
        action(text.value.retry, refresh, 'c0721c-retry'),
      ]) : null,
      state.value === 'empty' ? h('div', { class: 'c0721c-notice c0721c-empty' }, text.value.empty) : null,
      state.value === 'disabled' ? h('div', { class: 'c0721c-notice c0721c-disabled' }, text.value.disabled) : null,
      entries.value.length ? h('ol', { class: 'c0721c-list', 'aria-label': text.value.title }, entries.value.map(renderComment)) : null,
      result.value && visibleRoots.value < result.value.rootCount
        ? action(text.value.more(Math.min(ROOT_PAGE_SIZE, result.value.rootCount - visibleRoots.value)), showMore, 'c0721c-more') : null,
      result.value && slots.footer
        ? h('footer', { class: 'c0721c-footer' }, slots.footer(slotContext())) : null,
    ]);
  },
});
