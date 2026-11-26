export interface XmlNode {
  ns: string;
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? match;
  });
}

export function parseXml(input: string, limit = 2_000_000): XmlNode | null {
  const text = input.replace(/^﻿/, '').trim();
  if (!text) return null;
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new XmlError('DTDs sind nicht erlaubt');
  if (text.length > limit) throw new XmlError('Die Anfrage ist zu groß');
  let index = 0;
  const scopes: Record<string, string>[] = [{ xml: 'http://www.w3.org/XML/1998/namespace' }];
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  const resolve = (prefix: string) => {
    for (let level = scopes.length - 1; level >= 0; level--) if (prefix in scopes[level]) return scopes[level][prefix];
    return prefix ? prefix : '';
  };
  while (index < text.length) {
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index);
      if (end < 0) throw new XmlError('Unvollständige Anweisung');
      index = end + 2;
      continue;
    }
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index);
      if (end < 0) throw new XmlError('Unvollständiger Kommentar');
      index = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index);
      if (end < 0) throw new XmlError('Unvollständiger CDATA-Block');
      if (stack.length) stack[stack.length - 1].text += text.slice(index + 9, end);
      index = end + 3;
      continue;
    }
    if (text[index] === '<' && text[index + 1] === '/') {
      const end = text.indexOf('>', index);
      if (end < 0) throw new XmlError('Unvollständiges Ende');
      const node = stack.pop();
      scopes.pop();
      if (!node) throw new XmlError('Unerwartetes Ende');
      index = end + 1;
      continue;
    }
    if (text[index] === '<') {
      let end = index + 1;
      let quote: string | null = null;
      while (end < text.length) {
        const char = text[end];
        if (quote) {
          if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '>') break;
        end++;
      }
      if (end >= text.length) throw new XmlError('Unvollständiges Element');
      let inner = text.slice(index + 1, end);
      const selfClosing = inner.endsWith('/');
      if (selfClosing) inner = inner.slice(0, -1);
      const nameMatch = /^([^\s/>]+)/.exec(inner);
      if (!nameMatch) throw new XmlError('Element ohne Namen');
      const qualified = nameMatch[1];
      const rawAttrs: Record<string, string> = {};
      const attrPattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      for (let match = attrPattern.exec(inner.slice(qualified.length)); match; match = attrPattern.exec(inner.slice(qualified.length))) {
        rawAttrs[match[1]] = decode(match[3] ?? match[4] ?? '');
      }
      const scope: Record<string, string> = {};
      const attrs: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawAttrs)) {
        if (key === 'xmlns') scope[''] = value;
        else if (key.startsWith('xmlns:')) scope[key.slice(6)] = value;
        else attrs[key.includes(':') ? key.split(':')[1] : key] = value;
      }
      scopes.push(scope);
      const [prefix, local] = qualified.includes(':') ? qualified.split(':', 2) : ['', qualified];
      const node: XmlNode = { ns: resolve(prefix), name: local, attrs, children: [], text: '' };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else if (!root) root = node;
      if (selfClosing) scopes.pop();
      else stack.push(node);
      index = end + 1;
      if (stack.length > 64) throw new XmlError('Zu tief verschachtelt');
      continue;
    }
    const next = text.indexOf('<', index);
    const chunk = text.slice(index, next < 0 ? text.length : next);
    if (stack.length) stack[stack.length - 1].text += decode(chunk);
    index = next < 0 ? text.length : next;
  }
  return root;
}

export const child = (node: XmlNode | null | undefined, ns: string, name: string) =>
  node?.children.find((entry) => entry.ns === ns && entry.name === name) ?? null;

export const children = (node: XmlNode | null | undefined, ns: string, name: string) =>
  node?.children.filter((entry) => entry.ns === ns && entry.name === name) ?? [];

export const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function textOf(node: XmlNode | null | undefined): string {
  if (!node) return '';
  return (node.text + node.children.map(textOf).join('')).trim();
}
