import { html } from 'htm/preact';
import type { FastifyRequest } from 'fastify';
import * as settings from '../services/settings.ts';
import { legalLinks } from '../lib/html.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { icon, type IconName } from './icons.ts';

type Child = ReturnType<typeof html> | string | null | false | undefined;

function languageSwitch(request: FastifyRequest) {
  const next = request.url.startsWith('/') ? request.url : '/';
  const other: Lang = request.lang === 'de' ? 'en' : 'de';
  return html`<a class="auth__lang" href=${`/lang/${other}?next=${encodeURIComponent(next)}`} hreflang=${other} lang=${other}>
    ${icon('language', 'icon icon--small')}<span>${other === 'en' ? 'English' : 'Deutsch'}</span>
  </a>`;
}

export function shell(request: FastifyRequest, content: Child, options: { wide?: boolean } = {}) {
  const lang = request.lang;
  const links = legalLinks(request);
  return html`<a class="skip" href="#inhalt">${t(lang, 'Zum Inhalt springen')}</a>
    <main id="inhalt" class="auth">
      <div class=${options.wide ? 'auth__card auth__card--wide' : 'auth__card'}>
        <a class="auth__brand" href="/">
          <img src="/favicon.svg" width="44" height="44" alt="" />
          <span>${settings.get('site.name')}</span>
        </a>
        ${content}
      </div>
      <footer class="auth__footer">${languageSwitch(request)} ${links.map((link) => html`<a href=${link.href}>${link.label}</a>`)}</footer>
    </main>`;
}

export function alert(kind: 'error' | 'info' | 'success' | 'warning', message: string | null | undefined) {
  if (!message) return null;
  const name: IconName = kind === 'error' ? 'error' : kind === 'success' ? 'check' : kind === 'warning' ? 'campaign' : 'info';
  return html`<div class=${`alert alert--${kind}`} role=${kind === 'error' ? 'alert' : 'status'}>
    ${icon(name)}<span>${message}</span>
  </div>`;
}

export function field(options: {
  name: string;
  label: string;
  type?: string;
  autocomplete?: string;
  value?: string;
  required?: boolean;
  autofocus?: boolean;
  inputmode?: string;
  pattern?: string;
  minlength?: number;
  maxlength?: number;
  hint?: string;
}) {
  const id = `field-${options.name}`;
  const password = options.type === 'password';
  return html`<div class=${password ? 'field field--password' : 'field'}>
    <input
      id=${id}
      name=${options.name}
      type=${options.type ?? 'text'}
      placeholder=" "
      autocomplete=${options.autocomplete}
      value=${options.value}
      required=${options.required ?? true}
      autofocus=${options.autofocus}
      inputmode=${options.inputmode}
      pattern=${options.pattern}
      minlength=${options.minlength}
      maxlength=${options.maxlength}
      aria-describedby=${options.hint ? `${id}-hint` : undefined}
      autocapitalize="none"
      spellcheck="false"
    />
    <label for=${id}>${options.label}</label>
    ${password ? html`<button type="button" class="field__toggle" data-toggle=${id} hidden>${icon('visibility')}${icon('visibilityOff')}</button>` : null}
    ${options.hint ? html`<p class="field__hint" id=${`${id}-hint`}>${options.hint}</p>` : null}
  </div>`;
}

const hidden = (name: string, value: string) => html`<input type="hidden" name=${name} value=${value} />`;

export interface LoginView {
  csrf: string;
  next: string;
  login?: string;
  error?: string | null;
  notice?: string | null;
  registration: boolean;
  passkeys: boolean;
  forgot: boolean;
  announcement?: { text: string; level: 'info' | 'warning' } | null;
}

export function loginPage(request: FastifyRequest, view: LoginView) {
  const lang = request.lang;
  return shell(
    request,
    html`<h1>${t(lang, 'Anmelden')}</h1>
      <p class="auth__lead">${t(lang, 'Melde dich an, um zu deinen Dateien zu kommen.')}</p>
      ${view.announcement ? alert(view.announcement.level === 'warning' ? 'warning' : 'info', view.announcement.text) : null}
      ${alert('error', view.error)} ${alert('success', view.notice)}
      <form method="post" action="/login" class="form" data-login>
        ${hidden('_csrf', view.csrf)} ${hidden('next', view.next)}
        ${field({ name: 'login', label: t(lang, 'Benutzername oder E-Mail'), autocomplete: 'username webauthn', value: view.login, autofocus: !view.login })}
        ${field({ name: 'password', label: t(lang, 'Passwort'), type: 'password', autocomplete: 'current-password', autofocus: Boolean(view.login) })}
        ${view.forgot ? html`<p class="form__aside"><a href="/forgot">${t(lang, 'Passwort vergessen?')}</a></p>` : null}
        <button class="button button--filled" type="submit">${t(lang, 'Anmelden')}</button>
      </form>
      ${
        view.passkeys
          ? html`<div class="auth__passkey" data-passkey hidden>
              <div class="divider"><span>${t(lang, 'oder')}</span></div>
              <button type="button" class="button button--tonal" data-passkey-login data-csrf=${view.csrf} data-next=${view.next}>
                ${icon('key', 'icon button__icon')}<span>${t(lang, 'Mit Passkey anmelden')}</span>
              </button>
              <p class="field__hint field__hint--center" data-passkey-error hidden role="alert"></p>
            </div>`
          : null
      }
      ${
        view.registration
          ? html`<p class="auth__alt">${t(lang, 'Noch kein Konto?')} <a href="/register">${t(lang, 'Konto erstellen')}</a></p>`
          : null
      }`
  );
}

export function secondFactorPage(request: FastifyRequest, view: { csrf: string; next: string; error?: string | null }) {
  const lang = request.lang;
  return shell(
    request,
    html`<h1>${t(lang, 'Bestätige die Anmeldung')}</h1>
      <p class="auth__lead">${t(lang, 'Gib den Code aus deiner Authenticator-App ein. Ein Wiederherstellungscode geht auch.')}</p>
      ${alert('error', view.error)}
      <form method="post" action="/login/2fa" class="form">
        ${hidden('_csrf', view.csrf)} ${hidden('next', view.next)}
        ${field({ name: 'code', label: t(lang, 'Code'), autocomplete: 'one-time-code', autofocus: true, maxlength: 20 })}
        <button class="button button--filled" type="submit">${t(lang, 'Bestätigen')}</button>
      </form>
      <p class="auth__alt"><a href="/login">${icon('arrowBack', 'icon icon--small')} ${t(lang, 'Zurück zur Anmeldung')}</a></p>`
  );
}

export interface RegisterView {
  csrf: string;
  invite?: string;
  error?: string | null;
  values?: Record<string, string>;
}

export function registerPage(request: FastifyRequest, view: RegisterView) {
  const lang = request.lang;
  const values = view.values ?? {};
  return shell(
    request,
    html`<h1>${t(lang, 'Konto erstellen')}</h1>
      <p class="auth__lead">${t(lang, 'Mit einem Konto speicherst du deine Dateien auf diesem Server und teilst sie mit anderen.')}</p>
      ${alert('error', view.error)}
      <form method="post" action="/register" class="form">
        ${hidden('_csrf', view.csrf)} ${view.invite ? hidden('invite', view.invite) : null}
        ${field({ name: 'name', label: t(lang, 'Name'), autocomplete: 'name', value: values.name, autofocus: true, maxlength: 80 })}
        ${field({
          name: 'username',
          label: t(lang, 'Benutzername'),
          autocomplete: 'username',
          value: values.username,
          maxlength: 32,
          hint: t(lang, 'Buchstaben, Ziffern, Punkt, Minus und Unterstrich. Damit meldest du dich an.'),
        })}
        ${field({ name: 'email', label: t(lang, 'E-Mail (freiwillig)'), type: 'email', autocomplete: 'email', value: values.email, required: false })}
        ${field({
          name: 'password',
          label: t(lang, 'Passwort'),
          type: 'password',
          autocomplete: 'new-password',
          minlength: 10,
          hint: t(lang, 'Mindestens 10 Zeichen.'),
        })}
        <button class="button button--filled" type="submit">${t(lang, 'Konto erstellen')}</button>
      </form>
      <p class="auth__alt">${t(lang, 'Schon ein Konto?')} <a href="/login">${t(lang, 'Anmelden')}</a></p>`
  );
}

export function messagePage(
  request: FastifyRequest,
  view: { icon: IconName; title: string; text: string; action?: { label: string; href: string } | null }
) {
  return shell(
    request,
    html`<div class="message">
      <div class="message__icon">${icon(view.icon)}</div>
      <h1>${view.title}</h1>
      <p class="auth__lead">${view.text}</p>
      ${view.action ? html`<a class="button button--filled" href=${view.action.href}>${view.action.label}</a>` : null}
    </div>`
  );
}

export function legalPage(request: FastifyRequest, title: string, text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return shell(
    request,
    html`<h1>${title}</h1>
      <div class="legal">
        ${paragraphs.map((block) =>
          block.startsWith('## ')
            ? html`<h2>${block.slice(3)}</h2>`
            : html`<p>${block.split('\n').map((line, index) => (index ? [html`<br />`, line] : line))}</p>`
        )}
      </div>
      <p class="auth__alt"><a href="/">${icon('arrowBack', 'icon icon--small')} ${t(request.lang, 'Zur Startseite')}</a></p>`,
    { wide: true }
  );
}

export function sharePasswordPage(request: FastifyRequest, view: { csrf: string; name: string; error?: string | null }) {
  const lang = request.lang;
  return shell(
    request,
    html`<div class="message message--left">
        <div class="message__icon">${icon('lock')}</div>
        <h1>${t(lang, 'Geschützter Link')}</h1>
        <p class="auth__lead">${t(lang, '„{name}“ ist mit einem Passwort geschützt.', { name: view.name })}</p>
      </div>
      ${alert('error', view.error)}
      <form method="post" class="form">
        ${hidden('_csrf', view.csrf)}
        ${field({ name: 'password', label: t(lang, 'Passwort'), type: 'password', autocomplete: 'off', autofocus: true })}
        <button class="button button--filled" type="submit">${t(lang, 'Öffnen')}</button>
      </form>`
  );
}

export function forgotPage(request: FastifyRequest, view: { csrf: string; login?: string; sent?: boolean; error?: string | null }) {
  const lang = request.lang;
  if (view.sent) {
    return shell(
      request,
      html`<div class="message">
          <div class="message__icon">${icon('mailRead')}</div>
          <h1>${t(lang, 'Schau in dein Postfach')}</h1>
          <p class="auth__lead">
            ${t(lang, 'Gibt es ein Konto mit dieser Adresse und E-Mail, kommt gleich eine Nachricht mit einem Link. Er gilt eine Stunde.')}
          </p>
        </div>
        <p class="auth__alt"><a href="/login">${icon('arrowBack', 'icon icon--small')} ${t(lang, 'Zurück zur Anmeldung')}</a></p>`
    );
  }
  return shell(
    request,
    html`<h1>${t(lang, 'Passwort vergessen')}</h1>
      <p class="auth__lead">
        ${t(lang, 'Gib deinen Benutzernamen oder deine E-Mail-Adresse ein. Du bekommst einen Link, mit dem du ein neues Passwort festlegst.')}
      </p>
      ${alert('error', view.error)}
      <form method="post" action="/forgot" class="form">
        ${hidden('_csrf', view.csrf)}
        ${field({ name: 'login', label: t(lang, 'Benutzername oder E-Mail'), autocomplete: 'username', value: view.login, autofocus: true })}
        <button class="button button--filled" type="submit">${t(lang, 'Link schicken')}</button>
      </form>
      <p class="auth__alt"><a href="/login">${icon('arrowBack', 'icon icon--small')} ${t(lang, 'Zurück zur Anmeldung')}</a></p>`
  );
}

export function resetPage(request: FastifyRequest, view: { csrf: string; token: string; name?: string; error?: string | null }) {
  const lang = request.lang;
  return shell(
    request,
    html`<div class="message message--left">
        <div class="message__icon">${icon('lockReset')}</div>
        <h1>${t(lang, 'Neues Passwort')}</h1>
        <p class="auth__lead">
          ${view.name ? t(lang, 'Leg ein neues Passwort für {name} fest. Danach bist du auf allen Geräten abgemeldet.', { name: view.name }) : ''}
        </p>
      </div>
      ${alert('error', view.error)}
      <form method="post" action="/reset" class="form">
        ${hidden('_csrf', view.csrf)} ${hidden('token', view.token)}
        ${field({
          name: 'password',
          label: t(lang, 'Neues Passwort'),
          type: 'password',
          autocomplete: 'new-password',
          minlength: 10,
          autofocus: true,
          hint: t(lang, 'Mindestens 10 Zeichen.'),
        })}
        <button class="button button--filled" type="submit">${t(lang, 'Passwort speichern')}</button>
      </form>`
  );
}

export function maintenancePage(request: FastifyRequest, text: string) {
  const lang = request.lang;
  return shell(
    request,
    html`<div class="message">
      <div class="message__icon">${icon('construction')}</div>
      <h1>${t(lang, 'Gleich wieder da')}</h1>
      <p class="auth__lead">${text || t(lang, 'Wir arbeiten gerade an diesem Server. Versuch es in ein paar Minuten noch einmal.')}</p>
      <a class="button button--tonal" href="/login">${t(lang, 'Als Admin anmelden')}</a>
    </div>`
  );
}
