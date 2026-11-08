import MarkdownIt from 'markdown-it';
import { highlight } from './highlight';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight: (code, language) => {
    try {
      return highlight(code, language.toLowerCase()) ?? '';
    } catch {
      return '';
    }
  },
});

const defaultLink = markdown.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = String(token.attrGet('href') ?? '');
  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer nofollow');
  }
  return defaultLink(tokens, index, options, env, self);
};

markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const alt = markdown.utils.escapeHtml(String(token.content || token.attrGet('alt') || ''));
  return `<span class="md-image">${alt}</span>`;
};

markdown.core.ruler.after('inline', 'tasks', (state) => {
  const tokens = state.tokens;
  for (let index = 2; index < tokens.length; index++) {
    const inline = tokens[index];
    if (inline.type !== 'inline' || tokens[index - 1].type !== 'paragraph_open' || tokens[index - 2].type !== 'list_item_open') continue;
    const first = inline.children?.[0];
    const match = first?.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null;
    if (!first || !match) continue;
    first.content = first.content.slice(match[0].length);
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'}>`;
    inline.children!.unshift(box);
    tokens[index - 2].attrJoin('class', 'task');
  }
});

export const renderMarkdown = (text: string) => markdown.render(text);
