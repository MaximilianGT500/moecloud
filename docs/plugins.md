# Plugins für MoeCloud

Ein Plugin ist ein Ordner mit einer `plugin.json` und meist etwas JavaScript. MoeCloud lädt es beim Start und gibt ihm ein Objekt `moe` in die Hand. Damit kann ein Plugin

- auf Ereignisse reagieren, etwa wenn jemand etwas hochlädt, teilt oder löscht,
- Uploads prüfen und ablehnen,
- Aktionen ins Dateimenü hängen,
- eigene Seiten in die Navigation setzen,
- eigene Adressen unter `/api/ext/<id>/` und `/ext/<id>/` beantworten,
- regelmäßig Aufgaben erledigen,
- Benachrichtigungen schicken,
- Themes mitbringen.

Sechs fertige Beispiele liegen unter [`examples/plugins`](../examples/plugins). In der Verwaltung unter Plugins fügst du sie mit einem Klick hinzu.

## Inhalt

- [Vertrauen und Sicherheit](#vertrauen-und-sicherheit)
- [Das erste Plugin](#das-erste-plugin)
- [plugin.json](#pluginjson)
- [Das Objekt moe](#das-objekt-moe)
- [Seiten](#seiten)
- [Themes](#themes)
- [Entwickeln](#entwickeln)
- [Weitergeben und einspielen](#weitergeben-und-einspielen)
- [Umgebung und Kommandozeile](#umgebung-und-kommandozeile)
- [Grenzen](#grenzen)

## Vertrauen und Sicherheit

Ein Plugin läuft im selben Prozess wie MoeCloud und darf alles, was der Server darf. Es gibt keine Sandbox für den Code auf dem Server. Schalte deshalb nur ein, was du gelesen hast oder wessen Quelle du vertraust.

Dafür gibt es drei Sicherungen:

- **Freigabe.** MoeCloud lädt ein Plugin erst, nachdem ein Admin es unter Verwaltung, Plugins oder mit `moecloud plugins enable <id>` freigegeben hat.
- **Prüfsumme.** Bei der Freigabe merkt sich MoeCloud eine SHA-256-Prüfsumme über alle Dateien des Ordners. Ändert sich eine Datei, hält MoeCloud das Plugin innerhalb einer Minute an, bis ein Admin es neu freigibt. Alle Admins bekommen dann eine Nachricht, ebenso wenn der Ordner fehlt oder der Start misslingt.
- **Abgeschottete Seiten.** Seiten eines Plugins laufen im Browser in einem `iframe` ohne eigene Herkunft. Sie kommen weder an Cookies noch an die Oberfläche von MoeCloud und erreichen nur die Routen ihres eigenen Plugins.

Die Angaben unter `permissions` sind eine Auskunft für den Admin, keine Sperre. MoeCloud verlangt sie für die passenden Teile von `moe`, kann aber nicht verhindern, dass ein Plugin Node.js direkt benutzt.

Im Browser lassen sich Plugins nur hochladen, wenn der Server mit `PLUGIN_UPLOAD=on` läuft. Ohne diese Einstellung braucht es Zugriff auf den Server, um Code einzuspielen.

## Das erste Plugin

Plugins liegen im Datenordner unter `plugins/`, bei Docker also in `data/plugins/`. Der Ordner heißt wie die Kennung des Plugins.

```text
data/plugins/hallo/
  plugin.json
  index.js
```

`plugin.json`:

```json
{
  "id": "hallo",
  "name": "Hallo",
  "version": "1.0.0",
  "api": 1
}
```

`index.js`:

```js
export default (moe) => {
  moe.route('GET', '/', (request) => ({ hallo: request.user.name }));
  moe.on('file.upload', (event) => moe.log.info('Neue Datei', { name: event.name }));
};
```

Danach in der Verwaltung unter Plugins auf „Neu einlesen“ und „Einschalten“. Für Emi antwortet `/api/ext/hallo/` jetzt mit `{"hallo":"Emi"}`.

`index.js` ist ein ES-Modul. Der Standardexport bekommt `moe` und darf eine Funktion zurückgeben, die MoeCloud beim Abschalten aufruft. Der Start darf höchstens zehn Sekunden dauern.

```js
export default async (moe) => {
  const timer = setInterval(() => moe.log.info('läuft'), 60_000);
  return () => clearInterval(timer);
};
```

## plugin.json

| Feld          | Pflicht | Bedeutung                                                                                      |
| ------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `id`          | ja      | Kennung aus Kleinbuchstaben, Ziffern und Bindestrichen, 3 bis 40 Zeichen. Der Ordner heißt so. |
| `name`        | ja      | Anzeigename, als Text oder als `{ "de": "…", "en": "…" }`                                      |
| `version`     | ja      | Version wie `1.2.0`                                                                            |
| `api`         | ja      | Version der Plugin-Schnittstelle, zurzeit `1`                                                  |
| `description` | nein    | Ein Satz für die Liste in der Verwaltung, als Text oder je Sprache                             |
| `author`      | nein    | Wer das Plugin geschrieben hat                                                                 |
| `homepage`    | nein    | Adresse mit `https://`                                                                         |
| `moecloud`    | nein    | Älteste passende Version von MoeCloud, etwa `>=1.5.0`                                          |
| `main`        | nein    | Einstieg, sonst `index.js`. Ohne Code reicht die `plugin.json`, etwa für Themes.               |
| `permissions` | nein    | Was das Plugin von `moe` braucht: `network`, `files`, `users`, `notify`                        |
| `settings`    | nein    | Einstellungen, die der Admin in der Verwaltung ausfüllt                                        |
| `actions`     | nein    | Einträge im Dateimenü                                                                          |
| `pages`       | nein    | Eigene Seiten in der Navigation                                                                |
| `themes`      | nein    | Themes als Vorlage für die Verwaltung                                                          |

Alle Texte, die Menschen lesen, dürfen ein einfacher Text sein oder ein Objekt mit `de` und `en`.

### settings

```json
{
  "settings": [
    { "key": "url", "label": "Adresse", "type": "secret", "required": true },
    { "key": "grenze", "label": { "de": "Grenze in MB", "en": "Limit in MB" }, "type": "number", "min": 0, "max": 1000, "default": 50 },
    {
      "key": "modus",
      "label": "Modus",
      "type": "select",
      "default": "leise",
      "options": [
        { "value": "leise", "label": "Leise" },
        { "value": "laut", "label": "Laut" }
      ]
    }
  ]
}
```

| Feld       | Bedeutung                                                       |
| ---------- | --------------------------------------------------------------- |
| `key`      | Name, unter dem das Plugin den Wert liest                       |
| `label`    | Beschriftung                                                    |
| `hint`     | Hilfetext unter dem Feld                                        |
| `type`     | `text`, `textarea`, `secret`, `number`, `boolean` oder `select` |
| `required` | Ohne Wert lässt sich das Plugin nicht einschalten               |
| `default`  | Wert, solange niemand etwas eingetragen hat                     |
| `options`  | Auswahl bei `select`                                            |
| `min`      | Kleinster Wert bei `number`                                     |
| `max`      | Größter Wert bei `number`                                       |

Werte vom Typ `secret` zeigt die Verwaltung nie wieder an.

### actions

```json
{
  "actions": [
    {
      "id": "stempeln",
      "label": { "de": "Stempeln", "en": "Stamp" },
      "icon": "bolt",
      "kinds": ["file"],
      "extensions": ["txt", "md"],
      "multiple": true,
      "confirm": "Wirklich stempeln?"
    }
  ]
}
```

| Feld         | Bedeutung                                                       |
| ------------ | --------------------------------------------------------------- |
| `id`         | Name, unter dem das Plugin die Aktion mit `moe.action` anmeldet |
| `label`      | Text im Menü                                                    |
| `icon`       | Eines der Symbole unten, sonst `extension`                      |
| `kinds`      | `file`, `folder` oder beides, sonst nur Dateien                 |
| `extensions` | Nur für Dateien mit diesen Endungen                             |
| `multiple`   | Auch für mehrere ausgewählte Elemente                           |
| `confirm`    | Rückfrage vor dem Ausführen                                     |
| `admin`      | Nur für Admins                                                  |

Symbole: `extension`, `bolt`, `chart`, `send`, `label`, `print`, `cloud`, `star`, `build`, `image`, `document`, `lock`, `download`, `share`, `schedule`, `code`.

### pages

```json
{
  "pages": [{ "id": "uebersicht", "label": "Statistik", "icon": "chart", "path": "web/index.html" }]
}
```

`path` zeigt auf eine HTML-Datei im Ordner `web/` des Plugins. Mit `"admin": true` sehen nur Admins die Seite. Mehr dazu unter [Seiten](#seiten).

## Das Objekt moe

### Überblick

| Teil                                                    | Zweck                                                      | Braucht   |
| ------------------------------------------------------- | ---------------------------------------------------------- | --------- |
| `moe.id`, `moe.version`                                 | Kennung und Version des Plugins                            |           |
| `moe.moecloud`, `moe.api`, `moe.dev`                    | Version von MoeCloud, der Schnittstelle, Entwicklermodus   |           |
| `moe.log.info / warn / error`                           | Ins Log von MoeCloud schreiben                             |           |
| `moe.settings.get / all / onChange`                     | Einstellungen lesen                                        |           |
| `moe.store.get / set / delete / keys`                   | Eigene Daten in der Datenbank ablegen                      |           |
| `moe.on(ereignis, funktion)`                            | Auf Ereignisse reagieren                                   |           |
| `moe.filter('upload', funktion)`                        | Uploads prüfen                                             |           |
| `moe.reject(text)`                                      | Mit einer Meldung für den Menschen ablehnen                |           |
| `moe.route` und `moe.publicRoute`                       | Eigene Adressen beantworten                                |           |
| `moe.action(id, funktion)`                              | Aktion aus dem Dateimenü ausführen                         |           |
| `moe.job(name, abstand, funktion)`                      | Regelmäßige Aufgabe                                        |           |
| `moe.notify(kontoId, nachricht)`                        | Benachrichtigung in die Glocke, auf Wunsch auch per E-Mail | `notify`  |
| `moe.users.get / list`                                  | Konten nachschlagen                                        | `users`   |
| `moe.files.get / list / folder / read / stream / write` | Dateien lesen und schreiben                                | `files`   |
| `moe.fetch(adresse, optionen)`                          | Eine Adresse im Netz abrufen                               | `network` |

Fehlt die Angabe in `permissions`, wirft der Aufruf einen Fehler.

### Einstellungen

```js
const grenze = moe.settings.get('grenze');
moe.settings.onChange((werte) => moe.log.info('Neue Grenze', { grenze: werte.grenze }));
```

`get` liefert den eingetragenen Wert oder den aus `default`. Lies Einstellungen dort, wo du sie brauchst, dann wirken Änderungen sofort.

### Speicher

```js
moe.store.set('zaehler', (moe.store.get('zaehler') ?? 0) + 1);
for (const key of moe.store.keys('tag:')) moe.store.delete(key);
```

Werte sind alles, was sich als JSON schreiben lässt, höchstens 1 MB je Schlüssel. Der Speicher gehört dem Plugin allein und überlebt Neustarts, Sicherungen und einen Umzug der Datenbank. Entfernt jemand das Plugin, löscht MoeCloud auch seine Daten.

### Ereignisse

```js
moe.on('file.upload', (event) => {});
moe.on('file.*', (event, name) => {});
moe.on('audit.login_failed', (event) => {});
moe.on('*', (event, name) => {});
```

Ereignisse kommen nach der eigentlichen Aktion an und halten sie nicht auf. Ein Fehler im Plugin landet in der Verwaltung unter Plugins und im Log, mehr passiert nicht.

`file.<aktion>` meldet, was mit Dateien geschieht:

| Feld       | Inhalt                                               |
| ---------- | ---------------------------------------------------- |
| `action`   | Die Aktion, siehe unten                              |
| `ownerId`  | Konto, dem die Datei gehört                          |
| `actorId`  | Konto, das gehandelt hat, oder `null` bei einem Link |
| `viaLink`  | `true`, wenn es über einen öffentlichen Link geschah |
| `nodeId`   | Kennung der Datei oder des Ordners                   |
| `parentId` | Kennung des Ordners darüber                          |
| `name`     | Name der Datei oder des Ordners                      |
| `details`  | Weitere Angaben je nach Aktion                       |
| `at`       | Zeitpunkt in Millisekunden                           |

Aktionen: `upload`, `link_upload`, `folder`, `text`, `edit`, `rename`, `move`, `copy`, `trash`, `restore`, `delete`, `version_restore`, `share_user`, `unshare_user`, `share_group`, `unshare_group`, `share_link`, `extract`, `rotate`, `comment`, `color`.

`audit.<aktion>` meldet, was im Protokoll der Verwaltung landet, etwa `audit.login_failed`, `audit.user_created` oder `audit.settings_changed`. Die Felder sind `action`, `actorId`, `subjectId`, `details` und `at`.

### Uploads prüfen

```js
moe.filter('upload', (upload) => {
  if (upload.name.endsWith('.exe')) throw moe.reject('Programme nimmt diese Cloud nicht an');
});
```

Der Filter läuft vor dem Virenscan und bevor die Datei sichtbar wird. Er bekommt `name`, `size`, `sha256`, `via`, `userId` und `path`, den Ort der hochgeladenen Datei auf der Platte. `via` ist `upload`, `link`, `dav`, `editor`, `api` oder `archive`.

Nur `throw moe.reject(text)` lehnt ab. Der Mensch sieht dann genau diesen Text. Jeder andere Fehler gilt als Panne im Plugin: MoeCloud merkt ihn sich und nimmt die Datei trotzdem an, damit ein kaputtes Plugin keine Uploads blockiert. Ein Filter hat zehn Sekunden Zeit.

### Eigene Adressen

```js
moe.route('GET', '/notizen/:id', (request, reply) => {
  const notiz = moe.store.get(`notiz:${request.user.id}:${request.params.id}`);
  if (!notiz) {
    reply.status(404);
    return { fehler: 'Gibt es nicht' };
  }
  return notiz;
});

moe.route('POST', '/aufraeumen', () => ({ ok: true }), { admin: true });

moe.publicRoute('POST', '/webhook', (request) => {
  moe.store.set('zuletzt', request.body);
});
```

- `moe.route` antwortet unter `/api/ext/<id>/…` und nur für angemeldete Konten. Schreibende Anfragen brauchen wie überall in MoeCloud das CSRF-Token der Sitzung. Mit `{ admin: true }` nur für Admins.
- `moe.publicRoute` antwortet unter `/ext/<id>/…` ohne Anmeldung, gedacht für Webhooks anderer Dienste. Prüfe dort selbst, wer anfragt. MoeCloud lässt 120 Anfragen pro Minute und IP-Adresse zu.

Pfade dürfen Platzhalter wie `:id` und am Ende `/*` enthalten.

`request` enthält `method`, `path`, `params`, `query`, `body`, `rawBody`, `headers`, `ip`, `lang` und `user`. Cookies und das Passwort der Anmeldung reicht MoeCloud nicht weiter. `body` ist bei JSON das gelesene Objekt, bei Formularen ein Objekt, bei Text der Text und sonst ein `Buffer`. Anfragen dürfen höchstens 5 MB groß sein.

Der Rückgabewert wird zur Antwort: ein Objekt als JSON, ein Text als Text, ein `Buffer` oder ein lesbarer Strom als Datei, nichts als `204`. Mit `reply.status(code)`, `reply.header(name, wert)` und `reply.type(mime)` änderst du Status, Kopfzeilen und Typ. Ein Aufruf hat 60 Sekunden Zeit.

### Aktionen im Dateimenü

```js
moe.action('stempeln', async ({ user, nodes, lang }) => {
  for (const node of nodes) {
    const text = (await moe.files.read(user.id, node.id)).toString('utf8');
    await moe.files.write(user.id, node.parentId, node.name, `${text}\nGesehen von ${user.name}`, { conflict: 'replace' });
  }
  return { message: 'Gestempelt', refresh: true };
});
```

Die Aktion muss in `plugin.json` unter `actions` stehen. MoeCloud prüft vorher, dass das Konto die ausgewählten Elemente sehen darf und dass Art und Endung passen.

Die Rückgabe ist freiwillig:

| Feld      | Wirkung                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `message` | Kurze Meldung unten im Fenster                                                     |
| `refresh` | `true` lädt die Dateiliste neu                                                     |
| `open`    | Pfad in MoeCloud wie `/files/folder/…` oder eine Adresse mit `https://` zum Öffnen |

Mit `throw moe.reject(text)` bricht die Aktion ab und der Mensch liest den Text.

### Aufgaben

```js
moe.job('aufraeumen', '1d', () => {});
moe.job('abgleich', '15m', async () => {});
```

Der Abstand ist eine Zahl in Millisekunden oder ein Text wie `30s`, `15m`, `1h`, `1d`, mindestens zehn Sekunden. Läuft eine Aufgabe noch, lässt MoeCloud den nächsten Lauf aus. Aufgaben starten erst nach dem ersten Abstand.

### Benachrichtigen

```js
moe.notify(user.id, { title: 'Export fertig', text: '12 Dateien liegen im Ordner Export', url: '/files' });
```

Die Nachricht erscheint in der Glocke und geht je nach Einstellungen des Kontos per E-Mail und Push hinaus. `url` ist ein Pfad innerhalb von MoeCloud. Mit `email: false` bleibt es bei der Glocke.

### Konten und Dateien

```js
const mia = moe.users.list().find((user) => user.username === 'mia');
const dateien = moe.files.list(mia.id);
const inhalt = await moe.files.read(mia.id, dateien[0].id);
await moe.files.write(mia.id, null, 'Kopie.txt', inhalt);
```

Konten haben `id`, `username`, `name`, `email`, `role` und `language`. Dateien haben `id`, `name`, `type`, `size`, `mime`, `sha256`, `parentId`, `ownerId` und `modifiedAt`.

Alle Aufrufe von `moe.files` nennen zuerst das Konto, in dessen Namen sie laufen. Es gelten dessen Rechte, Kontingent und Freigaben, und was das Plugin schreibt, geht durch dieselben Prüfungen wie ein Upload.

| Aufruf                                                | Ergebnis                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `get(kontoId, id)`                                    | Die Datei oder `null`                                                                |
| `list(kontoId, ordnerId?)`                            | Inhalt eines Ordners, ohne Angabe der eigene Hauptordner                             |
| `folder(kontoId, ordnerId, name)`                     | Der Ordner mit diesem Namen, bei Bedarf neu angelegt. Ohne `ordnerId` im Hauptordner |
| `read(kontoId, id, { maxBytes })`                     | Inhalt als `Buffer`, ohne Angabe höchstens 50 MB                                     |
| `stream(kontoId, id)`                                 | Inhalt als Strom                                                                     |
| `write(kontoId, ordnerId, name, daten, { conflict })` | Legt eine Datei an. `conflict` ist `rename` oder `replace`                           |

### Ins Netz

```js
const antwort = await moe.fetch('https://example.com/api', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ hallo: 'Lea' }),
  timeout: 10_000,
});
if (antwort.ok) moe.log.info('Angekommen', { daten: antwort.json() });
```

`moe.fetch` erlaubt `http` und `https` und weigert sich bei Adressen im eigenen Netz, damit niemand über ein Plugin interne Dienste erreicht. Mit `private: true` hebst du das für eine Anfrage auf, etwa wenn der Admin die Adresse selbst eingetragen hat. Die Antwort hat `status`, `ok`, `headers`, `body`, `text()` und `json()` und darf höchstens 5 MB groß sein, mit `maxBytes` auch mehr.

## Seiten

Eine Seite ist eine HTML-Datei im Ordner `web/` des Plugins. MoeCloud zeigt sie in der Navigation und rahmt sie mit der gewohnten Oberfläche.

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/plugin-pages/sdk.css" />
  </head>
  <body>
    <div class="moe-card">
      <h2>Hallo <span id="name"></span></h2>
      <button id="los">Los</button>
    </div>
    <script src="/plugin-pages/sdk.js"></script>
    <script>
      moecloud.ready.then((info) => {
        document.getElementById('name').textContent = info.user.name;
      });
      document.getElementById('los').addEventListener('click', async () => {
        const daten = await moecloud.api('GET', '/notizen/1');
        moecloud.toast(`Geladen: ${daten.titel}`);
      });
    </script>
  </body>
</html>
```

Weitere Dateien in `web/` erreichst du mit relativen Pfaden, etwa `app.js` oder `bilder/logo.svg`. Alles in `web/` ist ohne Anmeldung abrufbar, leg dort nichts Vertrauliches ab.

### Das Objekt moecloud im Browser

| Aufruf                              | Wirkung                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `moecloud.ready`                    | Verspricht `{ user, lang, site, plugin, page, theme }`, sobald die Verbindung steht |
| `moecloud.api(methode, pfad, body)` | Ruft `/api/ext/<id><pfad>` im Namen der angemeldeten Person auf                     |
| `moecloud.toast(text)`              | Zeigt eine kurze Meldung in MoeCloud                                                |
| `moecloud.open(pfad)`               | Öffnet einen Pfad in MoeCloud, etwa `/files/folder/…`                               |
| `moecloud.resize(hoehe)`            | Macht den Rahmen so hoch wie angegeben, dann scrollt MoeCloud statt der Seite       |
| `moecloud.onTheme(funktion)`        | Ruft die Funktion mit dem Theme auf, jetzt und bei jedem Wechsel                    |

`moecloud.api` wirft bei einer Fehlerantwort einen Fehler mit `message`, `status` und `code`.

### Was eine Seite darf

Die Seite läuft abgeschottet. Sie hat keine Herkunft, also weder Cookies noch `localStorage`, und sie kann selbst keine Verbindungen ins Netz öffnen. Alles läuft über `moecloud.api` und damit über die Routen ihres Plugins. Skripte, Styles, Bilder und Schriften lädt sie nur von MoeCloud selbst, also aus dem eigenen Ordner `web/`, oder als `data:`.

Was sie sich merken soll, legt sie über eine Route im Speicher des Plugins ab.

### Aussehen

`sdk.css` setzt Schrift, Farben und einfache Bausteine so, dass die Seite zum gewählten Theme passt, auch im hellen Design. Die Farben stehen als Variablen bereit, zum Beispiel `--moe-primary`, `--moe-on-primary`, `--moe-surface`, `--moe-surface-container`, `--moe-on-surface`, `--moe-on-surface-variant`, `--moe-outline-variant`, `--moe-error`. Dazu kommen `--moe-background` für den Hintergrund hinter der Seite, `--moe-font`, `--moe-mono` und `--moe-corners` für die Rundung zwischen 0,1 und 1.

Bausteine: `.moe-card`, `.moe-row`, `.moe-grid`, `.moe-stat`, `.moe-muted`, dazu `button`, `button.tonal`, `button.text`, Eingabefelder und Tabellen.

## Themes

Ein Plugin kann Themes mitbringen, ganz ohne Code:

```json
{
  "id": "farbpaket",
  "name": "Farbpaket",
  "version": "1.0.0",
  "api": 1,
  "themes": [
    { "name": "Lavendel", "seed": "#9D8DF1", "style": "tonal", "font": "rounded", "corners": 1 },
    { "name": "Neon", "seed": "#00E5A0", "style": "vibrant", "secondary": "#FF3D9A", "font": "system", "corners": 0.1 }
  ]
}
```

| Feld        | Werte                                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| `name`      | Name des Themes                                                                |
| `seed`      | Grundfarbe als `#rrggbb`                                                       |
| `style`     | `content`, `tonal`, `vibrant`, `expressive`, `fidelity`, `neutral` oder `mono` |
| `secondary` | Zweite Farbe, freiwillig                                                       |
| `tertiary`  | Dritte Farbe, freiwillig                                                       |
| `font`      | `rounded`, `system`, `serif` oder `mono`                                       |
| `corners`   | `1` für rund, `0.5` für sanft, `0.1` für kantig                                |

Die Themes eingeschalteter Plugins erscheinen in der Verwaltung unter Einstellungen, Aussehen als „Themes aus Plugins“. Ein Klick öffnet sie im Editor, mit Speichern kommen sie in die Liste für alle.

## Entwickeln

Starte MoeCloud mit `PLUGINS_DEV=on`. Dann

- prüft MoeCloud keine Prüfsummen,
- lädt es ein freigegebenes Plugin von selbst neu, sobald du eine Datei speicherst,
- dürfen Aufgaben schon im Abstand von einer Sekunde laufen.

Der Entwicklermodus gehört nicht auf einen Server, den andere benutzen.

Fehler aus Ereignissen, Filtern, Aufgaben und Aktionen zeigt die Verwaltung unter Plugins am jeweiligen Plugin, mit Zeitpunkt und Stelle. Alles, was du mit `moe.log` schreibst, steht mit der Kennung des Plugins im Log des Servers.

Lässt sich ein Plugin nicht laden, nennt die Liste den Grund, etwa einen Tippfehler in der `plugin.json` oder einen Ordner, der anders heißt als die Kennung.

## Weitergeben und einspielen

Pack den Ordner als ZIP. Die `plugin.json` liegt im Archiv ganz oben oder in genau einem Ordner darunter.

```sh
sudo moecloud plugins install statistik-1.0.0.zip
sudo moecloud plugins enable statistik
```

Ohne das Installationsskript heißt der Befehl `docker compose exec moecloud moecloud plugins …` oder `node cli.ts plugins …`. Das Archiv muss dann im Container lesbar sein, am einfachsten im Ordner `data/`.

Wer lieber kopiert, legt den Ordner nach `data/plugins/` und liest in der Verwaltung neu ein. Ein neues Archiv mit derselben Kennung ersetzt das alte, die Einstellungen und gespeicherten Daten bleiben, freigeben musst du die neue Fassung erneut.

## Umgebung und Kommandozeile

| Variable        | Wirkung                                                              |
| --------------- | -------------------------------------------------------------------- |
| `PLUGINS`       | `off` schaltet Plugins ganz ab                                       |
| `PLUGINS_DIR`   | Anderer Ordner für Plugins, sonst `plugins/` im Datenordner          |
| `PLUGIN_UPLOAD` | `on` erlaubt Admins, Plugins im Browser hochzuladen und zu entfernen |
| `PLUGINS_DEV`   | `on` schaltet den Entwicklermodus ein                                |

| Befehl                   | Zweck                                                         |
| ------------------------ | ------------------------------------------------------------- |
| `plugins`                | Plugins im Ordner anzeigen                                    |
| `plugins enable <id>`    | Plugin freigeben, so wie es gerade auf der Platte liegt       |
| `plugins disable <id>`   | Plugin abschalten                                             |
| `plugins install <zip>`  | Plugin aus einem ZIP-Archiv einspielen                        |
| `plugins example [name]` | Mitgelieferte Beispiele zeigen oder eines in den Ordner legen |
| `plugins remove <id>`    | Plugin samt Einstellungen und gespeicherten Daten entfernen   |

Ein laufendes MoeCloud übernimmt Änderungen von der Kommandozeile innerhalb einer Minute.

## Grenzen

- Ein Plugin darf höchstens 5000 Dateien und 128 MB groß sein. Verknüpfungen im Ordner sind nicht erlaubt.
- Höchstens 200 Routen, 20 Aufgaben, 20 Aktionen, 10 Seiten, 20 Themes und 40 Einstellungen je Plugin.
- Die Schnittstelle trägt die Version `1`. Ändert sie sich so, dass alte Plugins nicht mehr passen, steigt die Zahl, und MoeCloud lädt Plugins mit einer anderen Zahl nicht.
- Plugins laufen im Prozess von MoeCloud. Eine Endlosschleife oder ein Absturz im Plugin trifft den ganzen Server. Lange Arbeit gehört in kleine Schritte oder in einen eigenen Dienst, den das Plugin über `moe.fetch` anspricht.
