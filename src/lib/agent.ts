import { t, type Lang } from './i18n.ts';

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

export function deviceOf(lang: Lang, agent: string | null | undefined) {
  if (!agent) return t(lang, 'Unbekanntes Gerät');
  const browser =
    BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] ??
    (/curl|rclone|WebDAV|Microsoft-WebDAV|davfs|gvfs/i.test(agent) ? agent.split(/[ /]/)[0] : t(lang, 'Browser'));
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  return system ? t(lang, '{browser} auf {system}', { browser, system }) : browser;
}
