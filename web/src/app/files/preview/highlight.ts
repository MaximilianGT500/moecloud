import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import properties from 'highlight.js/lib/languages/properties';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  markdown,
  nginx,
  perl,
  php,
  powershell,
  properties,
  python,
  r,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dart: 'dart',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  ini: 'ini',
  toml: 'ini',
  conf: 'ini',
  env: 'properties',
  properties: 'properties',
  java: 'java',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  geojson: 'json',
  webmanifest: 'json',
  kt: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  markdown: 'markdown',
  nginx: 'nginx',
  pl: 'perl',
  php: 'php',
  ps1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sql: 'sql',
  swift: 'swift',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  svelte: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
};

export function highlight(code: string, extension: string) {
  const language = BY_EXTENSION[extension];
  if (!language) return null;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
