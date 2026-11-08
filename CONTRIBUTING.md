# Mitwirken an MoeCloud

Danke, dass du MoeCloud besser machen willst. Fehler, Ideen und Pull Requests sind willkommen. Für alle, die mitmachen, gilt der [Verhaltenskodex](CODE_OF_CONDUCT.md).

## Fehler melden

Schau zuerst in die [Issues](https://github.com/MaximilianGT500/moecloud/issues), ob es den Fehler schon gibt. Wenn nicht, eröffne ein neues Issue mit der Vorlage „Fehler melden“ und gib an:

- Version von MoeCloud und Art der Installation (Installationsskript, Docker oder Node.js)
- Browser und Betriebssystem, bei WebDAV auch das Programm
- Was du gemacht hast, was passiert ist und was du erwartet hättest
- Passende Zeilen aus dem Log, ohne Passwörter, Tokens oder Links

Sicherheitslücken meldest du bitte nicht öffentlich, sondern vertraulich wie in der [SECURITY.md](SECURITY.md) beschrieben.

## Ideen vorschlagen

Für neue Funktionen gibt es die Vorlage „Idee vorschlagen“. Beschreib dort vor allem, was du erreichen möchtest. Wie es am Ende aussieht, finden wir dann gemeinsam heraus.

## Code beitragen

```bash
git clone https://github.com/MaximilianGT500/moecloud.git
cd moecloud
npm install
npm run dev:web
npm run dev
```

Vor einem Pull Request sollten diese Befehle ohne Fehler durchlaufen:

```bash
npm run format
npm run typecheck
npm test
npm run build
node tools/i18n.ts --strict
```

Hast du etwas an der Oberfläche geändert, prüf den Ablauf zusätzlich mit `npm run test:browser`. Der Test braucht Chrome, mit `CHROME_PATH` gibst du den Pfad an. Er erzeugt dabei auch die Screenshots in `docs/screenshots` neu.

Änderst du das Installationsskript, prüf es mit `shellcheck install.sh`.

## Neue Version

Für eine neue Version gehören die Versionsnummer in `package.json` und ein Eintrag im `CHANGELOG.md` zusammen. Die Projektseite moecloud.moestudio.net mit `version.json` und Changelog liegt nicht in diesem Repository.

## Regeln für den Code

- Keine Kommentare im Code. Namen von Funktionen und Variablen erklären, was passiert.
- Formatiert wird mit Prettier, die Einstellungen stehen in `.prettierrc.json`.
- Abhängigkeiten immer in der neuesten stabilen Version.
- Beispielnamen in Code, Tests und Beispieldaten sind Emi, Mia und Lea, Beispieladressen nutzen `example.com`.
- Neue Texte schreibst du auf Deutsch direkt in den Code und trägst die englische Fassung in `src/i18n/en.json` ein. `node tools/i18n.ts` zeigt, was fehlt.
- Texte sprechen mit „du“, ohne Ausrufezeichen und ohne Übertreibungen.
- Für neue API-Funktionen gehört ein Test nach `test/api.test.ts`, für Virenscan, E-Mail, Benachrichtigungen, Vorschauen und Verwaltung nach `test/features.test.ts`.

## Lizenz

Mit deinem Beitrag bestätigst du, dass du ihn selbst erstellt hast und er unter der [MIT-Lizenz](LICENSE) des Projekts stehen darf.
