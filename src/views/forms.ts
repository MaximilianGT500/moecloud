import { html } from 'htm/preact';
import type { FastifyRequest } from 'fastify';
import { t, type Lang } from '../lib/i18n.ts';
import { FORM_LIMITS, visibleQuestions, type FormRow, type Question } from '../services/forms.ts';
import { icon } from './icons.ts';
import { alert, hidden, shell } from './pages.ts';

export interface FormView {
  form: FormRow;
  csrf: string;
  values: Record<string, unknown>;
  errors: Record<string, string>;
  error?: string | null;
  person?: string | null;
}

function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => html`<p class="auth__lead form-page__text">${block}</p>`);
}

const value = (values: Record<string, unknown>, name: string) => {
  const raw = values[name];
  return typeof raw === 'string' ? raw : '';
};

function control(lang: Lang, entry: Question, values: Record<string, unknown>, describedBy: string | undefined) {
  const name = `q-${entry.id}`;
  const id = `frage-${entry.id}`;
  const current = value(values, name);
  switch (entry.kind) {
    case 'longtext':
      return html`<textarea
        id=${id}
        name=${name}
        class="question__input question__input--long"
        rows="5"
        maxlength=${FORM_LIMITS.longtext}
        required=${entry.required}
        aria-describedby=${describedBy}
        value=${current}
      />`;
    case 'single':
      return html`<div class="choices" role="radiogroup" aria-labelledby=${`${id}-titel`}>
        ${entry.options.map(
          (choice) =>
            html`<label class="choice">
              <input type="radio" name=${name} value=${choice.id} checked=${current === choice.id} required=${entry.required} />
              <span>${choice.label}</span>
            </label>`
        )}
      </div>`;
    case 'multiple':
      return html`<div class="choices">
        ${entry.options.map(
          (choice) =>
            html`<label class="choice">
              <input type="checkbox" name=${`${name}-${choice.id}`} value="1" checked=${value(values, `${name}-${choice.id}`) !== ''} />
              <span>${choice.label}</span>
            </label>`
        )}
      </div>`;
    case 'scale': {
      const min = entry.min ?? 1;
      const max = entry.max ?? 5;
      return html`<div class="scale">
        ${entry.low ? html`<span class="scale__end">${entry.low}</span>` : null}
        <div class="scale__steps" role="radiogroup" aria-labelledby=${`${id}-titel`}>
          ${Array.from({ length: max - min + 1 }, (_, index) => {
            const step = String(min + index);
            return html`<label class="scale__step">
              <input type="radio" name=${name} value=${step} checked=${current === step} required=${entry.required} />
              <span>${step}</span>
            </label>`;
          })}
        </div>
        ${entry.high ? html`<span class="scale__end">${entry.high}</span>` : null}
      </div>`;
    }
    default: {
      const type = entry.kind === 'email' ? 'email' : entry.kind === 'date' ? 'date' : 'text';
      return html`<input
        id=${id}
        name=${name}
        class="question__input"
        type=${type}
        value=${current}
        maxlength=${entry.kind === 'text' ? FORM_LIMITS.text : entry.kind === 'email' ? 320 : 40}
        inputmode=${entry.kind === 'number' ? 'decimal' : undefined}
        autocomplete=${entry.kind === 'email' ? 'email' : 'off'}
        required=${entry.required}
        aria-describedby=${describedBy}
        placeholder=${
          entry.kind === 'number' && entry.min !== null && entry.max !== null
            ? t(lang, '{min} bis {max}', { min: entry.min, max: entry.max })
            : undefined
        }
      />`;
    }
  }
}

function questionBlock(lang: Lang, entry: Question, values: Record<string, unknown>, error: string | undefined) {
  const id = `frage-${entry.id}`;
  const hint = entry.description ? `${id}-hinweis` : undefined;
  const problem = error ? `${id}-fehler` : undefined;
  const describedBy = [hint, problem].filter(Boolean).join(' ') || undefined;
  const grouped = entry.kind === 'single' || entry.kind === 'multiple' || entry.kind === 'scale';
  const title = html`${entry.title || t(lang, 'Frage ohne Titel')}${
    entry.required ? html`<span class="question__required" aria-label=${t(lang, 'Pflichtfeld')}> *</span>` : null
  }`;
  const body = html`${entry.description ? html`<p class="question__hint" id=${hint}>${entry.description}</p>` : null}
  ${control(lang, entry, values, describedBy)}
  ${error ? html`<p class="question__error" id=${problem} role="alert">${icon('error', 'icon icon--small')}<span>${error}</span></p>` : null}`;
  return grouped
    ? html`<fieldset class=${error ? 'question question--error' : 'question'} data-question=${entry.id} aria-describedby=${describedBy}>
        <legend class="question__title" id=${`${id}-titel`}>${title}</legend>
        ${body}
      </fieldset>`
    : html`<div class=${error ? 'question question--error' : 'question'} data-question=${entry.id}>
        <label class="question__title" for=${id} id=${`${id}-titel`}>${title}</label>
        ${body}
      </div>`;
}

export function formPage(request: FastifyRequest, view: FormView) {
  const lang = request.lang;
  const questions = visibleQuestions(view.form);
  const required = questions.some((entry) => entry.required);
  return shell(
    request,
    html`<div class="form-page">
      <div class="message message--left">
        <div class="message__icon">${icon('assignment')}</div>
        <h1>${view.form.title}</h1>
        ${paragraphs(view.form.description)}
      </div>
      ${view.person ? html`<p class="form-page__person">${t(lang, 'Du antwortest als {name}.', { name: view.person })}</p>` : null}
      ${alert('error', view.error)}
      <form method="post" class="form form-page__form">
        ${hidden('_csrf', view.csrf)}
        <div class="form-page__trap" aria-hidden="true">
          <label>${t(lang, 'Bitte leer lassen')}<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
        </div>
        ${questions.map((entry) => questionBlock(lang, entry, view.values, view.errors[entry.id]))}
        ${required ? html`<p class="form-page__note">${t(lang, 'Fragen mit * brauchen eine Antwort.')}</p>` : null}
        <button class="button button--filled" type="submit">${t(lang, 'Absenden')}</button>
      </form>
    </div>`,
    { wide: true }
  );
}

export function formDonePage(request: FastifyRequest, view: { form: FormRow; again: boolean; token: string }) {
  const lang = request.lang;
  const text = view.form.confirmation.trim() || t(lang, 'Deine Antwort ist angekommen.');
  return shell(
    request,
    html`<div class="message">
      <div class="message__icon">${icon('taskAlt')}</div>
      <h1>${t(lang, 'Danke für deine Antwort')}</h1>
      ${paragraphs(text)}
      ${view.again ? html`<a class="button button--tonal" href=${`/f/${view.token}`}>${t(lang, 'Noch eine Antwort senden')}</a>` : null}
    </div>`
  );
}
