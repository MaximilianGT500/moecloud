import { createTransport } from 'nodemailer';
import { config } from '../config.ts';
import { escapeHtml } from '../lib/http.ts';
import { t, type Lang } from '../lib/i18n.ts';
import * as settings from './settings.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export const outbox: Mail[] = [];

type Transport = ReturnType<typeof createTransport>;

let cached: { key: string; transport: Transport } | null = null;

export function mailReady() {
  return settings.get('mail.enabled') && Boolean(settings.get('mail.host').trim()) && Boolean(settings.get('mail.from').trim());
}

function options() {
  const security = settings.get('mail.security');
  const user = settings.get('mail.user');
  return {
    host: settings.get('mail.host').trim(),
    port: settings.get('mail.port'),
    secure: security === 'tls',
    requireTLS: security === 'starttls',
    ignoreTLS: security === 'none',
    auth: user ? { user, pass: settings.get('mail.password') } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
}

function transport(): Transport {
  if (config.test) return createTransport({ jsonTransport: true });
  const current = options();
  const key = JSON.stringify(current);
  if (!cached || cached.key !== key) {
    cached?.transport.close();
    cached = { key, transport: createTransport(current) };
  }
  return cached.transport;
}

function sender() {
  const name = settings.get('mail.fromName').trim() || settings.get('site.name');
  return { name, address: settings.get('mail.from').trim() };
}

export async function sendMail(mail: Mail) {
  if (!mailReady()) throw new Error('mail-not-configured');
  await transport().sendMail({ from: sender(), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  if (config.test) outbox.push(mail);
}

export async function verifyMail() {
  if (config.test) return true;
  await transport().verify();
  return true;
}

export interface Template {
  lang: Lang;
  title: string;
  lines: string[];
  action?: { label: string; url: string };
  note?: string;
}

export function render(template: Template, to: string): Mail {
  const site = settings.get('site.name');
  const palette = settings.get('site.palette').light;
  const primary = palette.primary ?? '#6b38d4';
  const onPrimary = palette.onPrimary ?? '#ffffff';
  const surface = palette.surfaceContainer ?? '#f3edf7';
  const ink = palette.onSurface ?? '#1d1b20';
  const muted = palette.onSurfaceVariant ?? '#49454f';
  const footer = t(template.lang, 'Diese E-Mail kommt von {site}.', { site });
  const text = [
    template.title,
    '',
    ...template.lines,
    ...(template.action ? ['', `${template.action.label}: ${template.action.url}`] : []),
    ...(template.note ? ['', template.note] : []),
    '',
    '-- ',
    footer,
  ].join('\n');
  const paragraphs = template.lines
    .map((line) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${ink}">${escapeHtml(line)}</p>`)
    .join('');
  const button = template.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(template.action.url)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:${primary};color:${onPrimary};font-weight:700;font-size:15px;text-decoration:none">${escapeHtml(template.action.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${muted};word-break:break-all">${escapeHtml(template.action.url)}</p>`
    : '';
  const note = template.note
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${muted}">${escapeHtml(template.note)}</p>`
    : '';
  const html = `<!doctype html><html lang="${template.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(template.title)}</title></head>
<body style="margin:0;padding:24px 12px;background:${surface};font-family:'M PLUS Rounded 1c','Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px">
<tr><td style="padding:28px 28px 8px;font-size:14px;font-weight:700;color:${primary}">${escapeHtml(site)}</td></tr>
<tr><td style="padding:4px 28px 28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${ink}">${escapeHtml(template.title)}</h1>
${paragraphs}${button}${note}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:${muted}">${escapeHtml(footer)}</p>
</td></tr></table></body></html>`;
  return { to, subject: template.title, text, html };
}

export async function deliver(to: string, template: Template) {
  await sendMail(render(template, to));
}
