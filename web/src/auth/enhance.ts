import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';

const english = document.documentElement.lang === 'en';
const text = (de: string, en: string) => (english ? en : de);

function passwordToggles() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
    const input = document.getElementById(button.dataset.toggle ?? '') as HTMLInputElement | null;
    if (!input) continue;
    button.hidden = false;
    const update = () => {
      const visible = input.type === 'text';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? text('Passwort verbergen', 'Hide password') : text('Passwort anzeigen', 'Show password'));
    };
    update();
    button.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      update();
      input.focus();
    });
  }
}

async function post<T>(url: string, csrf: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? text('Das hat nicht geklappt', 'That did not work'));
  return data;
}

function passkeys() {
  const box = document.querySelector<HTMLElement>('[data-passkey]');
  const button = document.querySelector<HTMLButtonElement>('[data-passkey-login]');
  const error = document.querySelector<HTMLElement>('[data-passkey-error]');
  if (!box || !button || !browserSupportsWebAuthn() || !window.isSecureContext) return;
  box.hidden = false;
  const csrf = button.dataset.csrf ?? '';
  const next = button.dataset.next ?? '/files';
  button.addEventListener('click', async () => {
    button.disabled = true;
    if (error) error.hidden = true;
    try {
      const options = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkey/options', csrf, {});
      const response = await startAuthentication({ optionsJSON: options });
      const result = await post<{ redirect: string }>('/api/auth/passkey/verify', csrf, { response, next });
      location.href = result.redirect;
    } catch (reason) {
      const name = (reason as Error).name;
      if (error && name !== 'NotAllowedError' && name !== 'AbortError') {
        error.textContent = (reason as Error).message;
        error.hidden = false;
      }
      button.disabled = false;
    }
  });
}

passwordToggles();
passkeys();
