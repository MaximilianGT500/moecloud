import { Fragment, createElement, type ReactNode } from 'react';
import { boot } from './boot';

type Params = Record<string, string | number | null | undefined>;

export const language = boot().lang === 'en' ? 'en' : 'de';
export const locale = language === 'en' ? 'en-GB' : 'de-DE';

let messages: Record<string, string> = {};
try {
  messages = JSON.parse(document.getElementById('moe-i18n')?.textContent || '{}') as Record<string, string>;
} catch {
  messages = {};
}

function lookup(text: string, plural: boolean) {
  const forms = (messages[text] ?? text).split('|');
  return (plural && forms[1]) || forms[0];
}

function fill(template: string, params?: Params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key] ?? '') : match));
}

export const t = (text: string, params?: Params) => fill(lookup(text, false), params);

export const tp = (text: string, params?: Params) => fill(lookup(text, true), params);

export function tn(count: number, one: string, other: string, params?: Params): string {
  return fill(lookup(count === 1 ? one : other, count !== 1), { count: new Intl.NumberFormat(locale).format(count), ...params });
}

export function rich(text: string, nodes: Record<string, ReactNode>, params?: Params): ReactNode[] {
  return t(text, params)
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((part, index) => {
      const match = /^\{(\w+)\}$/.exec(part);
      return createElement(Fragment, { key: index }, match && match[1] in nodes ? nodes[match[1]] : part);
    });
}
