import type { FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { all, value } from '../lib/db.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { isPublicAddress } from '../lib/netguard.ts';
import { plainAddress } from '../lib/networks.ts';
import { adminNetworks } from './adminnet.ts';
import { hasSecondFactor, lockouts } from './auth.ts';
import { baseUrl, linkBlock, linkState, type LinkRow } from './links.ts';
import { mailReady } from './mail.ts';
import { activePlugins } from './plugins.ts';
import * as settings from './settings.ts';
import { updateStatus } from './updates.ts';
import { ACTIVE, type UserRow } from './users.ts';

export type CheckLevel = 'ok' | 'hint' | 'warn';

export interface Check {
  id: string;
  level: CheckLevel;
  title: string;
  text: string;
  link: string | null;
}

const DAY = 86_400_000;

const listed = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(', ')} …` : names.join(', '));

function localHost(host: string) {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return name === 'localhost' || name.endsWith('.local') || name.endsWith('.lan') || name.endsWith('.internal') || !name.includes('.')
    ? true
    : /^[\d.]+$|:/.test(name) && !isPublicAddress(name);
}

export function securityChecks(request: FastifyRequest): Check[] {
  const lang: Lang = request.lang;
  const now = Date.now();
  const checks: Check[] = [];
  const add = (id: string, level: CheckLevel, title: string, text: string, link: string | null = null) =>
    checks.push({ id, level, title, text, link });

  const base = baseUrl(request);
  const host = base.replace(/^https?:\/\//, '').split('/')[0];
  if (base.startsWith('https://')) {
    add('https', 'ok', t(lang, 'Die Cloud läuft über HTTPS'), t(lang, 'Passwörter und Dateien sind auf dem Weg verschlüsselt.'));
  } else if (localHost(host)) {
    add(
      'https',
      'hint',
      t(lang, 'Die Cloud läuft ohne HTTPS'),
      t(lang, 'Im eigenen Netz ist das vertretbar. Soll sie von außen erreichbar sein, stell einen Proxy mit HTTPS davor.')
    );
  } else {
    add(
      'https',
      'warn',
      t(lang, 'Die Cloud läuft ohne HTTPS'),
      t(lang, 'Passwörter und Dateien gehen unverschlüsselt durchs Netz. Stell einen Proxy mit HTTPS davor.')
    );
  }

  if (settings.get('site.url').trim()) {
    add(
      'address',
      'ok',
      t(lang, 'Die Adresse der Cloud ist festgelegt'),
      t(lang, 'Links in E-Mails zeigen immer auf {url}.', { url: base })
    );
  } else {
    add(
      'address',
      'hint',
      t(lang, 'Die Adresse der Cloud ist nicht festgelegt'),
      t(lang, 'Links in E-Mails richten sich dann nach der Adresse, über die sich zuletzt ein Admin angemeldet hat. Trag die Adresse ein.'),
      '/admin/settings'
    );
  }

  const admins = all<UserRow>(`SELECT * FROM users WHERE role = 'admin' AND ${ACTIVE} ORDER BY name`, now);
  const bare = admins.filter((user) => !hasSecondFactor(user) && Boolean(user.password_hash));
  if (bare.length === 0) {
    add(
      'admins',
      'ok',
      t(lang, 'Alle Admins melden sich mit zweitem Faktor an'),
      t(lang, 'Ein erratenes Passwort reicht bei keinem Admin-Konto.')
    );
  } else {
    add(
      'admins',
      'warn',
      bare.length === 1
        ? t(lang, 'Ein Admin-Konto hat keinen zweiten Faktor')
        : t(lang, '{count} Admin-Konten haben keinen zweiten Faktor', { count: bare.length }),
      t(lang, 'Betroffen: {names}. Richte unter Konto eine Authenticator-App oder einen Passkey ein.', {
        names: listed(bare.map((user) => user.name)),
      }),
      '/account'
    );
  }

  const policy = settings.get('auth.require2fa');
  if (policy === 'off') {
    add(
      'policy',
      'hint',
      t(lang, 'Die Zwei-Faktor-Anmeldung ist für niemanden Pflicht'),
      t(lang, 'Unter Einstellungen › Anmeldung schreibst du sie für Admins oder für alle vor.'),
      '/admin/settings'
    );
  } else {
    add(
      'policy',
      'ok',
      policy === 'all'
        ? t(lang, 'Die Zwei-Faktor-Anmeldung ist für alle Pflicht')
        : t(lang, 'Die Zwei-Faktor-Anmeldung ist für Admins Pflicht'),
      t(lang, 'Wer noch keinen zweiten Faktor hat, richtet ihn bei der nächsten Anmeldung ein.')
    );
  }

  const registration = settings.get('auth.registration');
  const guarded = settings.get('auth.confirmEmail') || Boolean(settings.get('auth.domains').trim());
  if (registration === 'open' && !guarded) {
    add(
      'registration',
      'warn',
      t(lang, 'Jeder kann ein Konto anlegen'),
      t(lang, 'Die Registrierung ist offen und prüft weder die E-Mail-Adresse noch die Domain. Beschränk sie oder lass Konten freigeben.'),
      '/admin/settings'
    );
  } else if (registration === 'open') {
    add(
      'registration',
      'hint',
      t(lang, 'Die Registrierung ist offen'),
      t(lang, 'Neue Konten müssen ihre E-Mail-Adresse bestätigen oder zu einer erlaubten Domain gehören.'),
      '/admin/settings'
    );
  } else {
    add(
      'registration',
      'ok',
      t(lang, 'Konten entstehen nur mit deiner Zustimmung'),
      t(lang, 'Die Registrierung ist geschlossen oder braucht eine Einladung oder Freigabe.')
    );
  }

  const min = settings.get('auth.passwordMin');
  const breach = settings.get('auth.passwordBreach');
  if (min >= 12 && breach) {
    add(
      'passwords',
      'ok',
      t(lang, 'Passwörter müssen lang und unbekannt sein'),
      t(lang, 'Mindestens {count} Zeichen, und bekannte Passwörter aus Datenlecks werden abgelehnt.', { count: min })
    );
  } else {
    add(
      'passwords',
      'hint',
      t(lang, 'Die Regeln für Passwörter sind locker'),
      breach
        ? t(lang, 'Mindestens {count} Zeichen. Ab 12 Zeichen wird Raten deutlich schwerer.', { count: min })
        : t(lang, 'Mindestens {count} Zeichen, und Passwörter aus bekannten Datenlecks werden nicht abgelehnt.', { count: min }),
      '/admin/settings'
    );
  }

  const tokens = all<{ name: string; owner: string }>(
    `SELECT a.name AS name, u.name AS owner FROM app_passwords a JOIN users u ON u.id = a.user_id
     WHERE a.scope = 'admin' AND u.role = 'admin' AND (a.expires_at IS NULL OR a.expires_at > ?) ORDER BY a.created_at DESC`,
    now
  );
  if (tokens.length === 0) {
    add(
      'tokens',
      'ok',
      t(lang, 'Kein App-Passwort bedient die Verwaltung'),
      t(lang, 'Wer ein App-Passwort erbeutet, kommt an Dateien, aber nicht an Einstellungen oder Konten.')
    );
  } else {
    add(
      'tokens',
      'hint',
      tokens.length === 1
        ? t(lang, 'Ein App-Passwort darf die Verwaltung bedienen')
        : t(lang, '{count} App-Passwörter dürfen die Verwaltung bedienen', { count: tokens.length }),
      t(lang, 'Betroffen: {names}. Widerruf, was kein Skript mehr braucht, unter Konto › WebDAV und App-Passwörter.', {
        names: listed(tokens.map((token) => `${token.name} (${token.owner})`)),
      }),
      '/account'
    );
  }

  const links = all<LinkRow>('SELECT * FROM links');
  const live = links.filter((link) => linkState(link) === 'active' && !linkBlock(link));
  const open = live.filter((link) => !link.password_hash && !link.expires_at && !link.upload_only);
  if (open.length === 0) {
    add(
      'links',
      'ok',
      t(lang, 'Kein öffentlicher Link ist dauerhaft ohne Schutz'),
      t(lang, 'Jeder aktive Link hat ein Passwort oder ein Ablaufdatum.')
    );
  } else {
    add(
      'links',
      'hint',
      open.length === 1
        ? t(lang, 'Ein öffentlicher Link hat weder Passwort noch Ablaufdatum')
        : t(lang, '{count} öffentliche Links haben weder Passwort noch Ablaufdatum', { count: open.length }),
      t(
        lang,
        'Wer die Adresse kennt, kommt für immer an den Inhalt. Unter Einstellungen › Teilen schreibst du ein Passwort oder eine Höchstdauer vor.'
      ),
      '/admin/links'
    );
  }

  if (settings.get('scan.enabled')) {
    add('scan', 'ok', t(lang, 'Hochgeladene Dateien werden auf Viren geprüft'), t(lang, 'Funde sperrt MoeCloud und meldet sie dir.'));
  } else {
    add('scan', 'hint', t(lang, 'Der Virenscan ist aus'), t(lang, 'Mit ClamAV prüft MoeCloud jede Datei beim Hochladen.'), '/admin/scan');
  }

  const last = Number(settings.get('backup.last')) || 0;
  if (!settings.get('backup.enabled')) {
    add(
      'backups',
      'warn',
      t(lang, 'Die tägliche Sicherung ist aus'),
      t(lang, 'Ohne Sicherung der Datenbank sind nach einem Defekt alle Ordner, Freigaben und Konten weg.'),
      '/admin/backups'
    );
  } else if (last && now - last < 3 * DAY) {
    add(
      'backups',
      'ok',
      t(lang, 'Die Datenbank wird täglich gesichert'),
      t(lang, 'Denk daran, auch den Datenordner mit den Dateien zu sichern.')
    );
  } else {
    add(
      'backups',
      last ? 'warn' : 'hint',
      last ? t(lang, 'Die letzte Sicherung ist älter als drei Tage') : t(lang, 'Es gibt noch keine Sicherung'),
      t(lang, 'Sieh unter Sicherungen nach, ob die nächtliche Sicherung läuft.'),
      '/admin/backups'
    );
  }

  const updates = updateStatus();
  const latest = updates.latest;
  if (latest && latest.version !== config.version && latest.security) {
    add(
      'updates',
      'warn',
      t(lang, 'Ein Sicherheitsupdate wartet'),
      t(lang, 'Version {version} schließt Sicherheitslücken. Spiel sie bald ein.', { version: latest.version }),
      '/admin/system'
    );
  } else if (latest && latest.version !== config.version) {
    add(
      'updates',
      'hint',
      t(lang, 'Eine neue Version ist da'),
      t(lang, 'Version {version} steht bereit.', { version: latest.version }),
      '/admin/system'
    );
  } else if (!updates.enabled) {
    add(
      'updates',
      'hint',
      t(lang, 'Die Suche nach Updates ist aus'),
      t(lang, 'Von Sicherheitsupdates erfährst du dann nur, wenn du selbst nachsiehst.'),
      '/admin/system'
    );
  } else {
    add(
      'updates',
      'ok',
      t(lang, 'MoeCloud ist auf dem neuesten Stand'),
      t(lang, 'Version {version} ist die aktuelle.', { version: config.version })
    );
  }

  if (settings.get('import.private') || settings.get('push.private')) {
    add(
      'private',
      'hint',
      t(lang, 'Mitglieder dürfen Adressen im eigenen Netz ansprechen'),
      t(
        lang,
        'Downloads oder Push erreichen damit auch Router, NAS und andere Dienste hinter der Firewall. Lass das nur an, wenn du allen Mitgliedern vertraust.'
      ),
      '/admin/settings'
    );
  } else {
    add(
      'private',
      'ok',
      t(lang, 'Das eigene Netz ist für Downloads und Push gesperrt'),
      t(lang, 'Niemand kann über die Cloud Geräte hinter der Firewall ansprechen.')
    );
  }

  if (config.trustProxy === true) {
    add(
      'proxy',
      'warn',
      t(lang, 'MoeCloud glaubt jedem Absender die Angaben eines Proxys'),
      t(
        lang,
        'Mit TRUST_PROXY=true kann jeder seine IP-Adresse fälschen und Sperren umgehen. Trag stattdessen die Adresse deines Proxys ein.'
      )
    );
  }

  if (mailReady()) {
    add(
      'mail',
      'ok',
      t(lang, 'Der E-Mail-Versand ist eingerichtet'),
      t(lang, 'Mitglieder erfahren per E-Mail von neuen Anmeldungen und Änderungen an ihrem Konto.')
    );
  } else {
    add(
      'mail',
      'hint',
      t(lang, 'Der E-Mail-Versand ist nicht eingerichtet'),
      t(lang, 'Mitglieder erfahren von neuen Anmeldungen dann nur in der Cloud, und Passwörter setzt nur die Verwaltung zurück.'),
      '/admin/mail'
    );
  }

  const plugins = activePlugins().length;
  if (plugins > 0) {
    add(
      'plugins',
      'hint',
      plugins === 1 ? t(lang, 'Ein Plugin ist eingeschaltet') : t(lang, '{count} Plugins sind eingeschaltet', { count: plugins }),
      t(lang, 'Plugins laufen mit den Rechten, die du ihnen gegeben hast. Schalte nur ein, was du kennst.'),
      '/admin/plugins'
    );
  }

  const token = config.metricsToken || settings.get('metrics.token');
  if (token && token.length < 24) {
    add(
      'metrics',
      'warn',
      t(lang, 'Das Token für die Metriken ist kurz'),
      t(lang, 'Nimm mindestens 24 zufällige Zeichen, sonst lässt es sich erraten.'),
      '/admin/system'
    );
  }

  if (!settings.get('security.contact').trim()) {
    add(
      'contact',
      'hint',
      t(lang, 'Für Sicherheitsmeldungen gibt es keine Adresse'),
      t(lang, 'Trag unten eine Adresse ein. Wer eine Lücke findet, weiß dann, wem er schreiben soll.')
    );
  }

  const integrity = settings.get('integrity.last');
  if (!integrity) {
    add(
      'integrity',
      'hint',
      t(lang, 'Die gespeicherten Dateien wurden noch nie geprüft'),
      t(
        lang,
        'Die Prüfung unten liest jede Datei und vergleicht sie mit ihrer Prüfsumme. So fällt ein defekter Datenträger auf, bevor du die Datei brauchst.'
      )
    );
  } else if (integrity.missing + integrity.damaged > 0) {
    add(
      'integrity',
      'warn',
      t(lang, 'Bei der letzten Prüfung waren Dateien nicht in Ordnung'),
      t(
        lang,
        'Fehlende Dateien: {missing}, beschädigte Dateien: {damaged}. Welche das sind, steht unten. Hol sie aus einer Sicherung zurück.',
        {
          missing: integrity.missing,
          damaged: integrity.damaged,
        }
      )
    );
  } else if (settings.get('integrity.schedule') === 'off' && now - integrity.at > 90 * DAY) {
    add(
      'integrity',
      'hint',
      t(lang, 'Die letzte Prüfung der Dateien ist lange her'),
      t(lang, 'Sie lief vor mehr als 90 Tagen. Starte sie unten neu oder lass sie regelmäßig laufen.')
    );
  } else {
    add(
      'integrity',
      'ok',
      t(lang, 'Die gespeicherten Dateien sind unversehrt'),
      t(lang, 'Die letzte Prüfung hat jede Datei gelesen und nichts gefunden.')
    );
  }

  const networks = adminNetworks().entries;
  if (networks.length && config.trustProxy === true) {
    add(
      'networks',
      'warn',
      t(lang, 'Die Beschränkung der Verwaltung lässt sich umgehen'),
      t(
        lang,
        'Mit TRUST_PROXY=true kann jeder seine Adresse fälschen und sich so in ein erlaubtes Netz stellen. Trag stattdessen die Adresse deines Proxys ein.'
      )
    );
  } else if (networks.length) {
    add(
      'networks',
      'ok',
      t(lang, 'Die Verwaltung ist auf bestimmte Netze beschränkt'),
      t(lang, 'Erreichbar ist sie nur aus: {list}.', { list: listed(networks) })
    );
  }

  const order: Record<CheckLevel, number> = { warn: 0, hint: 1, ok: 2 };
  return checks.sort((a, b) => order[a.level] - order[b.level]);
}

export function securityReport(request: FastifyRequest) {
  const items = securityChecks(request);
  const now = Date.now();
  return {
    checkedAt: now,
    items,
    counts: {
      ok: items.filter((item) => item.level === 'ok').length,
      hint: items.filter((item) => item.level === 'hint').length,
      warn: items.filter((item) => item.level === 'warn').length,
    },
    lockouts: lockouts(),
    contact: settings.get('security.contact'),
    networks: adminNetworks().entries.join('\n'),
    address: plainAddress(request.ip),
    stats: {
      sessions: value<number>('SELECT COUNT(*) FROM sessions WHERE expires_at > ?', now) ?? 0,
      appPasswords: value<number>('SELECT COUNT(*) FROM app_passwords WHERE expires_at IS NULL OR expires_at > ?', now) ?? 0,
      failedLogins: value<number>("SELECT COUNT(*) FROM audit WHERE action = 'login_failed' AND created_at > ?", now - DAY) ?? 0,
    },
  };
}

export function securityTxt(request: FastifyRequest) {
  const contact = settings.get('security.contact').trim();
  if (!contact) return null;
  const base = baseUrl(request);
  return [
    `Contact: ${contact.includes('@') && !contact.startsWith('https://') ? `mailto:${contact}` : contact}`,
    `Expires: ${new Date(Date.now() + 180 * DAY).toISOString().replace(/\.\d+Z$/, 'Z')}`,
    'Preferred-Languages: de, en',
    `Canonical: ${base}/.well-known/security.txt`,
    '',
  ].join('\n');
}
