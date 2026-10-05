// This module and its DOM dependencies are loaded only after client mounting.
const renderers = new WeakMap();
const linkRel = 'noopener noreferrer nofollow ugc';
const allowedTags = [
  'p', 'br', 'hr', 'em', 'strong', 's', 'blockquote', 'ul', 'ol', 'li',
  'pre', 'code', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

export function safeHttpUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function createMarkdownRenderer(windowLike) {
  if (!windowLike?.document?.createElement) throw new TypeError('A client DOM window is required.');
  if (renderers.has(windowLike)) return renderers.get(windowLike);
  const pending = loadRenderer(windowLike);
  renderers.set(windowLike, pending);
  try {
    return await pending;
  } catch (error) {
    renderers.delete(windowLike);
    throw error;
  }
}

async function loadRenderer(windowLike) {
  const [{ default: MarkdownIt }, { default: createDOMPurify }] = await Promise.all([
    import('markdown-it'),
    import('dompurify'),
  ]);
  const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const purifier = createDOMPurify(windowLike);
  // Attribute checks also cover future changes to markdown-it's rendering rules.
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return;
    const url = safeHttpUrl(node.getAttribute('href'));
    if (url) {
      node.setAttribute('href', url);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', linkRel);
    } else {
      node.removeAttribute('href');
      node.removeAttribute('target');
      node.removeAttribute('rel');
    }
  });
  markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
    const token = tokens[index];
    const url = safeHttpUrl(token.attrGet('href'));
    token.attrs = (token.attrs ?? []).filter(([name]) => !['href', 'target', 'rel'].includes(name));
    if (url) {
      token.attrSet('href', url);
      token.attrSet('target', '_blank');
      token.attrSet('rel', linkRel);
    }
    return renderer.renderToken(tokens, index, options);
  };
  markdown.renderer.rules.image = (tokens, index, options, environment) => {
    const token = tokens[index];
    const url = safeHttpUrl(token.attrGet('src'));
    const label = `${environment.imageLabel ?? 'Image'}: ${token.content || url || ''}`;
    const escapedLabel = markdown.utils.escapeHtml(label);
    if (!url) return escapedLabel;
    return `<a href="${markdown.utils.escapeHtml(url)}" target="_blank" rel="${linkRel}">${escapedLabel}</a>`;
  };
  return Object.freeze({
    render(source, { imageLabel = 'Image' } = {}) {
      if (typeof source !== 'string') throw new TypeError('Markdown source must be a string.');
      // Every string returned for innerHTML passes through this allowlist.
      return purifier.sanitize(markdown.render(source, { imageLabel }), {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: ['href', 'title', 'start', 'target', 'rel'],
        ALLOWED_URI_REGEXP: /^https?:\/\//iu,
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        SANITIZE_NAMED_PROPS: true,
        RETURN_TRUSTED_TYPE: false,
      });
    },
  });
}
