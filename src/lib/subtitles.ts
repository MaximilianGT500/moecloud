import { splitName } from './names.ts';

export const SUBTITLE = /\.(srt|vtt)$/i;
export const MAX_SUBTITLE = 2 * 1024 * 1024;

export function decodeText(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function toVtt(buffer: Buffer, name: string) {
  const text = decodeText(buffer).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/\.vtt$/i.test(name)) return /^WEBVTT/.test(text) ? text : `WEBVTT\n\n${text}`;
  const body = text
    .replace(
      /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g,
      (_match, time: string, fraction: string) => `${time.padStart(8, '0')}.${fraction.padEnd(3, '0')}`
    )
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/\{\\[^}]*\}/g, '')
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

export function subtitleLanguage(video: string, subtitle: string): string | null | undefined {
  const [stem] = splitName(video);
  const [base] = splitName(subtitle);
  const key = stem.toLowerCase();
  const lower = base.toLowerCase();
  if (lower === key) return null;
  if (!lower.startsWith(`${key}.`)) return undefined;
  const lang = base.slice(key.length + 1);
  return /^[\p{L}\d_.-]{1,24}$/u.test(lang) ? lang : undefined;
}
