<div align="center">
  <a href="https://moecloud.moestudio.net"><img height="128" alt="MoeCloud" src="docs/logo.png"></a>
  <h1>MoeCloud</h1>
  <p>Deine Dateien und Termine, dein Server: hochladen, ansehen, teilen, planen und als Laufwerk einbinden.</p>

![GitHub Lizenz]
![GitHub Letzte Änderung]
[![Docker-Image]](https://github.com/MaximilianGT500/moecloud/pkgs/container/moecloud)
![GitHub Issues]
![GitHub Sterne]

</div>

[GitHub Lizenz]: https://img.shields.io/github/license/MaximilianGT500/moecloud?color=059669&style=for-the-badge
[GitHub Letzte Änderung]: https://img.shields.io/github/last-commit/MaximilianGT500/moecloud?color=059669&label=Letzte%20%C3%84nderung&style=for-the-badge
[Docker-Image]: https://img.shields.io/badge/Docker-ghcr.io-059669?style=for-the-badge&logo=docker&logoColor=white
[GitHub Issues]: https://img.shields.io/github/issues/MaximilianGT500/moecloud?color=059669&label=Issues&style=for-the-badge
[GitHub Sterne]: https://img.shields.io/github/stars/MaximilianGT500/moecloud?color=059669&label=Sterne&style=for-the-badge

MoeCloud ist eine Cloud für deine Dateien, die du selbst betreibst, als schlanke Alternative zu Nextcloud und Google Drive. Du lädst Dateien und ganze Ordner im Browser hoch, siehst dir Bilder, Videos, PDFs, Markdown, Code, Tabellen und Office-Dokumente direkt an und teilst Ordner mit anderen Konten oder über einen Link, auf Wunsch mit Passwort und Ablaufdatum. Fotos sortiert MoeCloud nach Aufnahmedatum und in Alben, Bilder und PDFs bearbeitest du direkt in der Cloud, und Musik läuft in einem eigenen Player. Dazu kommen ein Kalender mit Aufgaben, Einladungen, Buchungsseiten und Terminumfragen und Adressbücher für deine Kontakte, die sich per CalDAV und CardDAV mit Handy und Rechner abgleichen. Mit [ClamAV](https://www.clamav.net) prüft MoeCloud jeden Upload auf Schadsoftware, und per WebDAV bindest du alles als Laufwerk ein. MoeCloud läuft in einem Container mit SQLite, deine Dateien liegen in einem Ordner auf deinem Server. Eingerichtet wird im Browser: Beim ersten Start führt dich ein Assistent durch Name, Adresse, Farben und Admin-Konto, eine `.env` brauchst du nicht.

Mehr zum Projekt und eine Kurzanleitung gibt es auf [moecloud.moestudio.net](https://moecloud.moestudio.net). Was sich in jeder Version geändert hat, steht im [Changelog](CHANGELOG.md).

<p align="center">
  <img src="docs/screenshots/files.png" alt="Dateien in der Listenansicht mit farbigen Ordnern und Detailbereich" width="100%">
</p>
<p align="center">
  <img src="docs/screenshots/photos.png" alt="Fotos nach Monaten sortiert" width="49%">
  <img src="docs/screenshots/markdown.png" alt="Markdown-Datei mit Aufgabenliste und Tabelle in der Vorschau" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/share.png" alt="Teilen mit Personen und über einen Link" width="49%">
  <img src="docs/screenshots/comments.png" alt="Kommentare im Detailbereich" width="49%">
</p>

## Inhalt

- [Funktionen](#funktionen)
- [Installation](#installation)
- [Erster Start und Einrichtung](#erster-start-und-einrichtung)
- [Dateien](#dateien)
- [Vorschau](#vorschau)
- [Bearbeiten](#bearbeiten)
- [Office im Browser](#office-im-browser)
- [Abläufe und Umwandeln](#abläufe-und-umwandeln)
- [Notizen](#notizen)
- [Musik und Video](#musik-und-video)
- [Fotos und Alben](#fotos-und-alben)
- [Teilen](#teilen)
- [Teamordner und Gastkonten](#teamordner-und-gastkonten)
- [Formulare](#formulare)
- [Kalender und Aufgaben](#kalender-und-aufgaben)
- [Kontakte](#kontakte)
- [Kommentare, Aktivität und Benachrichtigungen](#kommentare-aktivität-und-benachrichtigungen)
- [Als App auf dem Handy](#als-app-auf-dem-handy)
- [Als Laufwerk einbinden](#als-laufwerk-einbinden)
- [Konto und Sicherheit](#konto-und-sicherheit)
- [Anmeldung über SSO](#anmeldung-über-sso)
- [Verwaltung](#verwaltung)
- [Virenscan mit ClamAV](#virenscan-mit-clamav)
- [E-Mail](#e-mail)
- [Webhooks](#webhooks)
- [Themes](#themes)
- [Plugins](#plugins)
- [Einstellungen und Umgebungsvariablen](#einstellungen-und-umgebungsvariablen)
- [Metriken für Prometheus](#metriken-für-prometheus)
- [Versionsprüfung](#versionsprüfung)
- [Updates](#updates)
- [Datenbank](#datenbank)
- [Datensicherung](#datensicherung)
- [Kommandozeile](#kommandozeile)
- [API](#api)
- [Entwicklung](#entwicklung)
- [Support, Mitwirken und Lizenz](#support-mitwirken-und-lizenz)

## Funktionen

- **Hochladen** per Drag & Drop, über „Neu“ oder mit Strg+V aus der Zwischenablage, einzelne Dateien und ganze Ordner samt Unterordnern
- **Große Dateien** gehen in Teilen von 16 MB hoch. Bricht die Verbindung ab, setzt der Upload an derselben Stelle wieder an
- **Vorschau** für Bilder, Videos, Audio, PDFs, Markdown, Code mit Hervorhebung, CSV, JSON, Word, Excel, ZIP-, TAR- und GZ-Archive, E-Books, E-Mails, Termine, Kontakte und Schriften, mit LibreOffice auch für PowerPoint, OpenDocument und ältere Office-Dateien. Dazu gehören Kamera-Rohformate wie DNG vom iPhone, HEIC, TIFF und Photoshop-Dateien. Textdateien bearbeitest du direkt im Browser, Bilder drehst du mit einem Klick
- **Bearbeiten** direkt in der Cloud: Bilder zuschneiden, drehen, spiegeln und als JPEG, PNG, WebP oder AVIF speichern, PDF-Seiten ordnen, drehen und PDFs zusammenfügen, aus Bildern eine PDF machen, Textversionen Zeile für Zeile vergleichen
- **Office im Browser**: Word, Excel, PowerPoint und OpenDocument bearbeitest du mit Collabora Online direkt in der Cloud, auch zu mehreren gleichzeitig, und neue Dokumente, Tabellen und Präsentationen legst du über „Neu“ an
- **Notizen**: ein eigener Bereich für schnelle Notizen mit Markdown, Aufgaben zum Abhaken, einer Übersicht aller Aufgaben und Kategorien. Jede Notiz ist eine Textdatei in deinen Dateien, mit Versionen, Suche und Teilen wie bei allem anderen
- **Musik** im Player am unteren Rand mit Warteschlange und Medientasten, dazu ein eigener Bereich mit allen Titeln nach Album und Interpret und mit Wiedergabelisten, die du als M3U mitnimmst, Tempo, Schlummern und einer Liste dessen, was du zuletzt und oft gehört hast. **Videos** mit Untertiteln aus SRT und VTT, die an der letzten Stelle weiterlaufen
- **Archive** entpacken direkt in der Cloud, als ZIP, TAR, TAR.GZ und GZ, mit Virenscan für jede Datei darin. ZIP-Archive packst du dort auch
- **Aufnehmen**: Sprachnotizen, Fotos, Videos und den Bildschirm nimmst du direkt im Browser auf und speicherst sie im offenen Ordner
- **Dokumente scannen** mit der Kamera oder aus Fotos: mehrere Seiten, gedreht und sortiert, als eine PDF im offenen Ordner
- **Ablaufdatum** für Dateien und Ordner: Zum gewählten Zeitpunkt wandern sie von selbst in den Papierkorb
- **Formulare** für Umfragen, Anmeldungen und Rückmeldungen über einen Link, ohne Konto zum Antworten, mit neun Arten von Fragen samt Datei-Upload, Frist, Grenze für Antworten, Auswertung mit Balken und Export als CSV
- **Kalender** mit Tag, drei Tagen, Arbeitswoche, Woche, Monat, Jahr und Terminliste, Schnelleingabe wie „Kaffee mit Mia morgen 15 Uhr“, Wiederholungen, Zeitzonen, Feiertagen, Geburtstagen und Erinnerungen per Push und E-Mail. Kalender teilst du mit anderen Konten, lädst Leute ohne Konto per E-Mail ein und abonnierst Kalender aus dem Netz
- **Aufgaben** mit Fälligkeit, Priorität, Fortschritt und Schlagwörtern, als Liste oder Board mit Offen, In Arbeit und Erledigt, auf Wunsch zwischen den Terminen im Kalender. In geteilten Kalendern weist du Aufgaben anderen zu
- **Kalender aus anderen Diensten übernehmen**: ICS-Dateien, ZIP aus Google Takeout, CSV aus Google und Outlook, iCal-Adressen und ganze CalDAV-Konten etwa von Nextcloud oder iCloud, mit Vorschau vor dem Import
- **Buchungsseiten und Terminumfragen**: Andere buchen freie Zeiten bei dir oder stimmen über Terminvorschläge ab, ganz ohne Konto
- **CalDAV**: Kalender und Aufgaben gleichen sich mit iPhone, Mac, Android, Thunderbird und anderen Apps ab
- **Kontakte** mit mehreren Adressbüchern, Fotos, Labels, Favoriten und Geburtstagen, die im Kalender auftauchen. Adressbücher teilst du mit anderen Konten, holst Kontakte als vCard oder CSV von Telefon, Google und Outlook und führst doppelte zusammen
- **CardDAV**: Adressbücher gleichen sich mit iPhone, Mac, Android und Thunderbird ab
- **Schlagwörter** in zehn Farben für Dateien und Ordner, auch für Geteiltes, und eine eigene Ansicht dafür
- **Viele Dateien auf einmal umbenennen**: Text ersetzen oder ergänzen, durchnummerieren oder das Aufnahmedatum voranstellen, mit Vorschau
- **Vorschaubilder** für Fotos, Rohdateien, Videos, PDFs, Musik mit Cover und Dokumente, die ein Vorschaubild mitbringen, etwa aus LibreOffice, Keynote oder als E-Book
- **Fotos** zeigt alle Bilder und Videos nach Aufnahmedatum, die Bildansicht Kamera, Objektiv und Belichtung, dazu eine Diashow. **An diesem Tag** holt Fotos vom selben Tag aus früheren Jahren nach oben. **Alben** sammeln Fotos aus beliebigen Ordnern, ohne sie zu verschieben
- **Volltextsuche** in Texten, PDFs und Office-Dokumenten, mit Filtern für die Art, das Änderungsdatum, die Größe und Schlagwörter. Häufige Suchen speicherst du und rufst sie aus der leeren Suchleiste wieder auf
- **Aus dem Internet laden**: MoeCloud holt eine Datei von einer Adresse selbst in einen Ordner und meldet sich, wenn sie da ist
- **Weblinks**: Eine Adresse aus dem Netz liegt als kleine Datei zwischen deinen anderen, lässt sich teilen und öffnet sich mit einem Klick, auch Verknüpfungen von Windows und macOS
- **Umziehen per WebDAV**: MoeCloud holt alle Dateien von Nextcloud, ownCloud oder einem anderen Speicher mit WebDAV in einen Ordner, im Hintergrund und mit allen Unterordnern
- **Auf früheren Stand zurücksetzen**: Ein Ordner geht mit allem darin auf den Stand eines Zeitpunkts zurück, mit Vorschau, was sich ändert. Inhalte, Namen und Gelöschtes kommen zurück, was danach dazukam, wandert in den Papierkorb, und nichts geht dabei verloren
- **Schutz vor Erpressungstrojanern**: Dateien mit typischen Endungen und Erpresserbriefe nimmt MoeCloud nicht an, und ändert ein Gerät über WebDAV auffällig viele Dateien, hält es das Gerät an und gibt Bescheid
- **Ordnerfarben und Ordnersymbole**, Favoriten, Zuletzt und ein Papierkorb, aus dem Gelöschtes 30 Tage lang zurückkommt. Eine README.md im Ordner erscheint als Beschreibung über der Liste
- **Beschreibungen, Erinnerungen und Vorlagen**: Dateien und Ordner bekommen eine Beschreibung, die auch die Suche findet, **Erinnern** meldet sich zur gewählten Zeit, und aus einem Vorlagenordner legst du neue Dateien mit einem Klick an
- **Versionen**: Ersetzt du eine Datei oder speicherst einen Text, bleibt die alte Fassung erhalten und lässt sich zurückholen. Wie viele es pro Datei gibt und nach wie vielen Tagen sie gehen, legt die Verwaltung fest. Wichtige Fassungen bekommen einen Namen und bleiben dann, bis du sie selbst löschst
- **Speicher** zeigt, was wie viel Platz belegt, die größten und die doppelten Dateien, räumt Kopien mit einem Klick auf und fragt auf Wunsch die Verwaltung nach mehr Platz
- **Dateien sperren**, damit niemand anderes sie ändert, umbenennt oder löscht, während du daran arbeitest, auch nicht über WebDAV
- **Aufräumregeln** legen Dateien, die eine Weile unverändert in einem Ordner liegen, von selbst in den Papierkorb, etwa in Downloads oder Scans
- **Abläufe** kümmern sich um neue Dateien in einem Ordner: Schlagwort vergeben, nach Muster umbenennen, in Ordner pro Jahr oder Monat einsortieren, als PDF oder in einem anderen Bildformat speichern, eine Kopie in einen zweiten Ordner legen, in ein Album legen, als Favorit markieren und Bescheid geben
- **Umwandeln** im Dateimenü: Bilder nach JPEG, PNG, WebP oder AVIF, Office-Dokumente nach PDF, auch viele Dateien auf einmal, das Original bleibt
- **Grenzen** für den Speicher pro Person und die Größe einzelner Dateien, mit Hinweis, wenn der Speicher fast voll ist, dazu eine Liste gesperrter Dateiendungen
- **Teilen mit Personen und Gruppen**: Ordner und Dateien für andere Konten oder eine ganze Gruppe freigeben, zum Ansehen oder zum Bearbeiten, auf Wunsch mit Ablaufdatum und einer Notiz für die Empfänger
- **Teamordner** gehören keiner einzelnen Person, haben eigenen Speicher und einen eigenen Papierkorb. Mitglieder lesen, bearbeiten oder leiten, einzeln oder über Gruppen, und finden den Ordner auch in der Suche und, wenn das App-Passwort es vorsieht, im WebDAV-Laufwerk. Wird der Speicher knapp, bekommt die Leitung Bescheid
- **Gastkonten** für Leute von außen: ohne eigenen Speicher, mit Zugriff nur auf Geteiltes und auf die Teamordner, in die du sie aufnimmst
- **Öffentliche Links** mit Bezeichnung, eigener Adresse wie `/s/urlaub-2026`, Passwort, Beginn und Ablaufdatum samt Erinnerung davor, Nachricht für Besucher, eigenem Theme, Grenze für Downloads, QR-Code und Zählern für Aufrufe und Downloads, auf Wunsch mit Nachricht bei jedem Download, jederzeit pausierbar und direkt per E-Mail verschickt. Ein Verlauf zeigt, wann ein Link geöffnet und was geladen wurde, und Besucher können Inhalte melden. Ordner gibt es als ZIP, Fotos kommen ohne GPS-Daten
- **Dateien anfragen**: Ein Link nur zum Hochladen sammelt Dateien von anderen ein, auf Wunsch mit Benachrichtigung
- **Kommentare und Aktivität** an jeder Datei und jedem Ordner, mit Erwähnungen per `@` und Reaktionen. Dazu Benachrichtigungen in der App, per E-Mail, als Push direkt im Browser und aufs Handy über ntfy oder Gotify, auch für Änderungen in Ordnern, die du beobachtest. Ruhezeiten halten sie zurück, E-Mails kommen auf Wunsch gesammelt einmal am Tag oder in der Woche
- **Virenscan** mit ClamAV für alle Uploads, mit gesperrten Dateien und erneuter Prüfung
- **WebDAV** zum Einbinden als Laufwerk, mit eigenen App-Passwörtern pro Gerät, auf Wunsch nur zum Lesen, mit Ablaufdatum oder mit Teamordnern und Geteiltem als Ordner im Laufwerk
- **Live**: Änderungen erscheinen sofort auf allen Geräten, auf denen MoeCloud offen ist
- **Sparsamer Speicher**: Gleiche Dateien liegen nur einmal auf der Platte, auch wenn sie mehrfach hochgeladen werden
- **Registrierung** nach Wunsch: geschlossen, mit Einladung, mit Freigabe oder offen, auf Wunsch mit bestätigter E-Mail-Adresse und nur für bestimmte Domains
- **Anmeldung** mit Passwort, Authenticator-App samt Wiederherstellungscodes oder Passkey, „Passwort vergessen“ per E-Mail und ein Protokoll aller Anmeldungen. Meldet sich jemand von einem neuen Gerät an, gibt MoeCloud Bescheid. Admins können die Zwei-Faktor-Anmeldung für alle vorschreiben, eine Mindestlänge für Passwörter festlegen, Passwörter aus bekannten Datenlecks ablehnen, bei der nächsten Anmeldung ein eigenes Passwort verlangen und bestimmen, wie lange eine Anmeldung hält. Wer sich selbst registriert, wartet auf Wunsch auf die Freigabe durch die Verwaltung, und unbenutzte Konten sperrt MoeCloud nach einer Frist von selbst
- **Datenexport**: Alle eigenen Dateien und eine Übersicht über das Konto als ein ZIP. Erlaubt es die Verwaltung, löscht jede Person ihr Konto auch selbst
- **Sicherheitsprüfung** für Admins: eine Seite, die zeigt, was an der eigenen Einrichtung unsicher ist, gesperrte Anmeldungen freigibt und eine Adresse für Sicherheitsmeldungen hinterlegt. Dazu **Konto absichern** für jede Person und Hinweise bei jeder Änderung an der Anmeldung
- **Dateien prüfen**: MoeCloud liest auf Knopfdruck oder regelmäßig jede gespeicherte Datei, vergleicht sie mit ihrer Prüfsumme und meldet, was fehlt oder beschädigt ist
- **Verwaltung nur aus bestimmten Netzen**: Auf Wunsch ist die Verwaltung nur aus dem Heimnetz, dem Büro oder dem VPN erreichbar, alles andere bleibt von überall offen
- **Profilbilder**: Jedes Konto bekommt auf Wunsch ein Bild, das überall erscheint, wo sonst die Initialen stehen
- **Single Sign-on** über OpenID Connect mit Authentik, Keycloak, Authelia, Zitadel, Google oder Microsoft, auf Wunsch mit automatisch angelegten Konten und Admin-Rechten aus einer Gruppe
- **Verwaltung** im Browser: Übersicht mit Zustand und Speicherverlauf, Personen samt Import aus CSV und Ablaufdatum für Konten, Teamordner, Einladungen per E-Mail, alle Links samt Meldungen von Besuchern, Protokoll mit Export als CSV, Virenscan, E-Mail, Webhooks, Sicherungen, Wartungsmodus, Hinweise für alle, Nutzungsbedingungen mit Zustimmung, Startdateien für neue Konten, das Serverprotokoll und auf Wunsch ein Wochenbericht per E-Mail
- **SQLite oder PostgreSQL** als Datenbank, mit einem Befehl in beide Richtungen umgezogen
- **Für den Dauerbetrieb**: Installationsskript mit Prüfung des Servers und automatischen Updates, nächtliche Sicherungen der Datenbank mit Kopie in einen zweiten Ordner, Versionsprüfung, Metriken für Prometheus, Health-Check und Logs als Text oder JSON
- **Hilfe von MoeStudio**: Unter **Admin › Hilfe** schreibst du MoeStudio direkt aus der Verwaltung, liest die Antworten dort und siehst Hinweise und Updates für deine Version. Nutzungsstatistik und Fehlerberichte schickt MoeCloud nur, wenn du sie einschaltest
- **Themes**: zwanzig fertige Themes und beliebig viele eigene aus Grundfarbe, Stil, zweiter und dritter Farbe, sieben Schriften, Ecken und eigenem CSS, für alle oder pro Person, als Datei zum Weitergeben. Dazu dunkel als Standard, ein helles Design, mehr Kontrast und echtes Schwarz
- **Darstellung nach Maß**: Schriftgröße, kompakte Zeilen, Größe der Kacheln, Farbschimmer im Hintergrund und weniger Bewegung pro Gerät, dazu die Navigation und die Startseite in deiner Reihenfolge
- **Eigenes Logo und Anmeldeseite**: Logo, Hintergrundbild, Überschrift, Begrüßung und Platz der Anmeldung legt die Verwaltung fest
- **Plugins** erweitern MoeCloud um Aktionen im Dateimenü, eigene Seiten, Regeln für Uploads, Aufgaben, eigene Adressen und Themes. Sechs Beispiele sind dabei
- **Start** zeigt auf einen Blick, woran du zuletzt gearbeitet hast, dazu Favoriten, Geteiltes, Teamordner, anstehende Erinnerungen, die nächsten Termine, offene Aufgaben, Fotos vom selben Tag aus früheren Jahren und deinen Speicher
- **Funktionen auswählen**: Wer nur Dateien oder nur den Kalender braucht, blendet Fotos, Musik, Notizen, Formulare, Schlagwörter, Kalender, Aufgaben, Buchungsseiten, Umfragen und Kontakte für sich aus. Was neue Konten sehen, legt die Verwaltung fest
- **Schnellzugriff** mit Strg+K oder ⌘K: springt in jeden Bereich, findet Dateien und Ordner und wechselt das Theme, ganz ohne Maus
- **Auf dem Handy** mit eigener Navigation am unteren Rand, die du selbst belegst. Als App installiert, nimmt MoeCloud Dateien, Texte und Links aus dem Teilen-Menü anderer Apps an
- **Deutsch und Englisch**, jede Person wählt ihre Sprache selbst

## Installation

Am schnellsten geht es mit dem [Installationsskript](#mit-dem-installationsskript). Von Hand brauchst du Docker oder **Node.js 24 oder neuer**.

### Mit dem Installationsskript

Auf einem Linux-Server richtet ein Skript alles ein: Docker (falls es fehlt, über das offizielle Skript von get.docker.com), die Dateien von MoeCloud in `/opt/moecloud`, auf Wunsch Caddy für HTTPS, ClamAV als Virenscan, Collabora Online zum Bearbeiten von Office-Dokumenten, die Office-Vorschau und PostgreSQL als Datenbank.

```bash
curl -fsSL https://moecloud.moestudio.net/install.sh | sudo bash
```

Vorher prüft das Skript den Server: Architektur, Arbeitsspeicher, freien Platz, ob die nötigen Ports frei sind, ob die Domain auf den Server zeigt und ob die Registry erreichbar ist. Dann fragt es nach Domain, ClamAV, Collabora Online, Office-Vorschau, Datenbank und automatischen Updates, startet MoeCloud, wartet, bis es antwortet, und zeigt den Link zum Einrichtungsassistenten. Ohne Rückfragen geht es mit Optionen:

```bash
curl -fsSL https://moecloud.moestudio.net/install.sh | sudo bash -s -- --domain cloud.example.com --clamav --auto-update --yes
```

| Option             | Bedeutung                                                               |
| ------------------ | ----------------------------------------------------------------------- |
| `--domain NAME`    | Domain für HTTPS über Caddy                                             |
| `--port ZAHL`      | Port auf dem Server ohne Domain, Standard `3000`                        |
| `--clamav`         | ClamAV als Virenscan mitstarten                                         |
| `--no-clamav`      | ClamAV nicht einrichten                                                 |
| `--collabora`      | Collabora Online mitstarten, zum Bearbeiten von Office-Dokumenten       |
| `--no-collabora`   | Collabora Online nicht einrichten                                       |
| `--office`         | Office-Vorschau mitstarten, siehe [Vorschau](#vorschau)                 |
| `--no-office`      | Die Office-Vorschau nicht einrichten                                    |
| `--all`            | ClamAV, Collabora Online und die Office-Vorschau mitstarten             |
| `--postgres`       | PostgreSQL als eigenen Dienst mitstarten, siehe [Datenbank](#datenbank) |
| `--sqlite`         | SQLite als Datenbank nehmen, das ist der Standard                       |
| `--auto-update`    | Updates jede Nacht zwischen 4 und 5 Uhr einspielen                      |
| `--no-auto-update` | Automatische Updates ausschalten                                        |
| `--dir PFAD`       | Installationsordner, Standard `/opt/moecloud`                           |
| `--update`         | Eine bestehende Installation aktualisieren                              |
| `--check`          | Nur prüfen, ob der Server passt, ohne etwas zu verändern                |
| `--yes`            | Keine Rückfragen, Standardwerte nehmen                                  |

Mit Domain bindet das Skript MoeCloud nur an `127.0.0.1`, erreichbar ist es dann ausschließlich über Caddy. Ist Port 3000 dafür schon belegt, nimmt es den nächsten freien. Alles, was das Skript tut, steht in `/var/log/moecloud-install.log`, bei einem Fehler zeigt es die letzten Zeilen daraus. Außerdem legt es den Befehl `moecloud` an:

| Befehl                                        | Zweck                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `sudo moecloud status`                        | Zustand, Version, Adresse, freier Platz, Virenscan und Updates auf einen Blick                                          |
| `sudo moecloud doctor`                        | Typische Probleme finden: Container, Ports, Zertifikat, Platz, Sicherungen und ClamAV                                   |
| `sudo moecloud update`                        | Datenbank sichern und auf die neueste Version aktualisieren                                                             |
| `sudo moecloud auto-update [on \| off]`       | Automatische Updates jede Nacht ein- oder ausschalten, ohne Angabe den Stand zeigen                                     |
| `sudo moecloud logs [dienst]`                 | Logs ansehen, ohne Angabe von MoeCloud, sonst etwa von `caddy` oder `clamav`                                            |
| `sudo moecloud restart [dienst]`              | MoeCloud oder einen anderen Dienst neu starten                                                                          |
| `sudo moecloud database [postgres \| sqlite]` | Datenbank zeigen oder mit allen Daten zwischen SQLite und PostgreSQL umziehen                                           |
| `sudo moecloud office [on \| off]`            | Vorschau für PowerPoint, OpenDocument und ältere Office-Dateien einrichten oder abschalten, siehe [Vorschau](#vorschau) |
| `sudo moecloud collabora [on \| off]`         | Collabora Online einrichten oder abschalten, siehe [Office-Bearbeitung dazunehmen](#office-bearbeitung-dazunehmen)      |
| `sudo moecloud stop`                          | MoeCloud und alle Dienste daneben beenden, `start` startet sie wieder                                                   |
| `sudo moecloud uninstall`                     | Container, Images, Befehl und Zeitplan entfernen, deine Daten in `/opt/moecloud` bleiben                                |
| `sudo moecloud …`                             | Alle anderen Befehle der [Kommandozeile](#kommandozeile), etwa `backup` oder `users`                                    |

Das Skript und `update` laden das Image `latest`, also den neuesten Stand, einzelne Versionen stehen nicht zur Auswahl. Zurück auf einen älteren Stand geht es nicht, weil sich die Datenbank verändert haben kann, dafür spielst du eine [Sicherung](#datensicherung) ein. Wer bei einem bestimmten Image bleiben möchte, trägt dessen Tag als `MOECLOUD_TAG` in die `.env` ein, siehe [Mit Docker](#mit-docker).

Das Skript liegt auch im Repository als [`install.sh`](install.sh). Wer es vorher lesen möchte, lädt es erst herunter und startet es dann mit `sudo bash install.sh`. Mit `--check` siehst du gefahrlos, ob dein Server passt.

### Mit Docker

Das Image liegt in der GitHub Container Registry unter `ghcr.io/maximiliangt500/moecloud` und läuft auf `amd64` und `arm64`, also auch auf dem Raspberry Pi. Zwei Compose-Dateien stehen bereit:

| Datei                                      | Was sie startet                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [`compose.yaml`](compose.yaml)             | Alles in einem: MoeCloud, Collabora Online zum Bearbeiten von Office-Dokumenten, die Office-Vorschau und ClamAV als Virenscan |
| [`docker-compose.yml`](docker-compose.yml) | Nur MoeCloud. Was du sonst brauchst, nimmst du mit den Ergänzungen weiter unten dazu                                          |

**Alles in einem.** Lad die `compose.yaml` herunter und starte sie:

```bash
mkdir moecloud && cd moecloud
curl -O https://raw.githubusercontent.com/MaximilianGT500/moecloud/main/compose.yaml
docker compose up -d
docker compose logs -f moecloud
```

In den Logs erscheint der Link zur Einrichtung. Danach ist alles verbunden, ohne dass du etwas einträgst: Office-Dokumente öffnest du per Doppelklick im Editor, PowerPoint und OpenDocument haben eine Vorschau, und was du hochlädst, läuft durch den Virenscan. Beim ersten Start lädt Docker vier Images und ClamAV seine Signaturen, das dauert einige Minuten. ClamAV allein braucht etwa 3 GB Arbeitsspeicher, Collabora und die Office-Vorschau kommen dazu. Für einen kleinen Server nimmst du deshalb die schlanke Datei und nur die Ergänzungen, die du brauchst.

Mit eigener Domain trägst du `DOMAIN`, `PUBLIC_URL` und `COMPOSE_PROFILES=caddy` in die `.env` ein, wie unter [Mit eigener Domain und HTTPS](#mit-eigener-domain-und-https) beschrieben. Collabora erfährt dann von selbst, dass die Cloud über HTTPS läuft. Steht ein eigener Reverse-Proxy davor, sagst du es ihm mit `OFFICE_HTTPS=true`. Mehr dazu unter [Office-Bearbeitung dazunehmen](#office-bearbeitung-dazunehmen).

**Nur MoeCloud.** Für den Start reicht die `docker-compose.yml`:

```bash
mkdir moecloud && cd moecloud
curl -O https://raw.githubusercontent.com/MaximilianGT500/moecloud/main/docker-compose.yml
docker compose up -d
docker compose logs -f moecloud
```

Liegen beide Dateien im selben Ordner, etwa im geklonten Repository, nimmt Docker die `compose.yaml` und weist darauf hin. Die schlanke Fassung startest du dort mit `docker compose -f docker-compose.yml up -d`. Das [Installationsskript](#mit-dem-installationsskript) arbeitet immer mit der schlanken Datei und den Ergänzungen. Deshalb bleibt sie die Grundlage, und die Komplettfassung trägt den anderen Namen.

Alle Daten landen im Ordner `data/` neben der Compose-Datei. Eine Vorlage für die `.env` liegt als [`.env.example`](.env.example) im Repository. Sie erklärt jede Variable mit Standard, möglichen Werten und Beispiel. Compose nimmt das Image `latest`. Mit `MOECLOUD_TAG` in der `.env` bleibst du bei einem bestimmten Image, etwa mit `MOECLOUD_TAG=sha-1a2b3c4`.

Was der Stack mitbringt:

- **Eigener Benutzer**: MoeCloud läuft im Container nicht als root. Beim Start bekommt `data/` den Besitzer aus `PUID` und `PGID` (Standard `1000`). Soll der Ordner auf dem Host einem anderen Benutzer gehören, trägst du beide in die `.env` ein.
- **Vorschauen**: ffmpeg als statisches Programm und Poppler für Vorschaubilder von Videos, PDFs und Bildformaten wie PSD und JPEG XL sind im Image schon dabei. Rohformate und HEIC brauchen keine Zusatzprogramme.
- **Schlank**: Abhängigkeiten nur für die Zielplattform, ohne Typen, Source-Maps und Dokumentation.
- **Abgesichert**: schreibgeschütztes Dateisystem bis auf `data/` und `/tmp`, keine zusätzlichen Rechte (`no-new-privileges`, nur die nötigen Capabilities).
- **Health-Check** über `/healthz`, nach dem Start alle 2 Sekunden, danach alle 30 Sekunden. Docker zeigt den Zustand mit `docker compose ps`.
- **Logs** mit Rotation (3 × 10 MB) und Zeitzone aus `TZ`.
- **Sauberes Beenden**: laufende Anfragen dürfen bis zu 20 Sekunden fertig werden.

GitHub baut das Image bei jeder Änderung am Hauptzweig und veröffentlicht es als `latest`, dazu unter einem Tag mit dem Commit wie `sha-1a2b3c4`, jeweils mit SBOM und Herkunftsnachweis. Welche Tags es gibt, zeigt die [Seite des Images](https://github.com/MaximilianGT500/moecloud/pkgs/container/moecloud). Selbst bauen geht mit `docker build -t ghcr.io/maximiliangt500/moecloud:latest .` im geklonten Repository, `docker compose up -d` nimmt dann dieses Image.

### ClamAV dazunehmen

Die Ergänzung [`docker/clamav.yml`](docker/clamav.yml) startet ClamAV als eigenen Container und verbindet MoeCloud damit:

```bash
mkdir -p docker
curl -o docker/clamav.yml https://raw.githubusercontent.com/MaximilianGT500/moecloud/main/docker/clamav.yml
echo "COMPOSE_FILE=docker-compose.yml:docker/clamav.yml" >> .env
docker compose up -d
```

Beim ersten Start lädt ClamAV seine Signaturen, das dauert ein paar Minuten. Der Container braucht etwa 3 GB Arbeitsspeicher. In der Komplettfassung `compose.yaml` ist ClamAV schon dabei. Mehr dazu unter [Virenscan mit ClamAV](#virenscan-mit-clamav).

### PostgreSQL dazunehmen

Die Ergänzung [`docker/postgres.yml`](docker/postgres.yml) startet PostgreSQL 18 als eigenen Container. Seine Daten liegen im Ordner `postgres/` neben der `docker-compose.yml`, das Passwort kommt aus der `.env`:

```bash
mkdir -p docker
curl -o docker/postgres.yml https://raw.githubusercontent.com/MaximilianGT500/moecloud/main/docker/postgres.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "COMPOSE_FILE=docker-compose.yml:docker/postgres.yml" >> .env
docker compose up -d
```

Mit ClamAV zusammen heißt die Zeile `COMPOSE_FILE=docker-compose.yml:docker/clamav.yml:docker/postgres.yml`. Läuft MoeCloud schon mit SQLite, ziehst du die Daten vor dem ersten Start um, wie unter [Datenbank](#datenbank) beschrieben.

### Office-Vorschau dazunehmen

Die Ergänzung [`docker/office.yml`](docker/office.yml) startet LibreOffice in einem eigenen Container, über [Gotenberg](https://gotenberg.dev). MoeCloud lässt dort PowerPoint, OpenDocument und ältere Office-Dateien in PDFs umwandeln und zeigt sie in der [Vorschau](#vorschau):

```bash
mkdir -p docker
curl -o docker/office.yml https://raw.githubusercontent.com/MaximilianGT500/moecloud/main/docker/office.yml
echo "COMPOSE_FILE=docker-compose.yml:docker/office.yml" >> .env
docker compose up -d
```

Steht in der `.env` schon eine Zeile mit `COMPOSE_FILE`, hängst du `:docker/office.yml` an sie an. In der Komplettfassung `compose.yaml` ist die Vorschau schon dabei. Der Container hängt in einem eigenen Netz ohne Zugang zum Internet und zu deinem lokalen Netz und braucht keinen eigenen Ordner, das Image ist rund 420 MB groß. Läuft bei dir schon ein Dienst mit Gotenberg, genügt stattdessen `OFFICE_URL` mit seiner Adresse in der `.env`.

### Office-Bearbeitung dazunehmen

Zum Bearbeiten von Word, Excel, PowerPoint und OpenDocument braucht MoeCloud einen Server mit [Collabora Online](https://www.collaboraonline.com/code/). In der Komplettfassung [`compose.yaml`](compose.yaml) ist er schon dabei. Zur schlanken Datei kommt er mit der Ergänzung [`docker/collabora.yml`](docker/collabora.yml):

```bash
mkdir -p docker
curl -o docker/collabora.yml https://raw.githubusercontent.com/MaximilianGT500/moecloud/main/docker/collabora.yml
echo "COMPOSE_FILE=docker-compose.yml:docker/collabora.yml" >> .env
docker compose up -d
```

Steht in der `.env` schon eine Zeile mit `COMPOSE_FILE`, hängst du `:docker/collabora.yml` an sie an. Mit dem Installationsskript genügt `sudo moecloud collabora on`. Es gibt zwei Wege, wie der Editor in den Browser kommt:

**Eingebaut unter der Adresse der Cloud.** So richten es die Komplettfassung, die Ergänzung und das Skript ein. Collabora hängt in einem eigenen Netz ohne Zugang zum Internet und hat keinen Port nach außen. MoeCloud reicht den Editor unter seiner eigenen Adresse durch, unter `/browser/` und `/cool/`, und nur an Angemeldete. Die Verwaltungsseiten von Collabora bleiben dabei gesperrt. Du brauchst keine zweite Domain und kein zweites Zertifikat. Zwei Dinge sind zu beachten:

- **HTTPS**: Läuft die Cloud über HTTPS, muss Collabora das wissen, sonst verbindet sich der Editor nicht. Mit `DOMAIN` in der `.env` passiert das von selbst, hinter einem eigenen Reverse-Proxy trägst du `OFFICE_HTTPS=true` ein. Passt es nicht zusammen, sagt dir das **Admin › Einstellungen › Office**.
- **WebSockets**: Der Editor hält eine Verbindung über WebSockets. Caddy lässt sie von sich aus durch, bei anderen Reverse-Proxys schaltest du das für die Cloud ein.

Der Preis für die Bequemlichkeit: Die Seiten des Editors teilen sich die Herkunft mit deiner Cloud. MoeCloud gibt weder deine Anmeldung noch deine Cookies an Collabora weiter. Ein Fehler in Collabora, der fremdes Skript in den Editor bringt, träfe aber auch die Cloud. Wer das trennen möchte, gibt Collabora eine eigene Adresse.

**Mit eigener Adresse.** Collabora läuft als eigener Dienst unter einer eigenen Adresse mit HTTPS, etwa `https://office.example.com`, und ist von den Browsern deiner Leute aus erreichbar. Wie du ihn aufsetzt, beschreibt Collabora in der [Anleitung zum Docker-Image](https://sdk.collaboraonline.com/docs/installation/CODE_Docker_image.html). Zwei Dinge verbinden ihn mit MoeCloud:

1. **Collabora muss deine Cloud kennen.** Trag ihre Adresse dort als erlaubten Host ein, beim Docker-Image mit der Umgebungsvariable `aliasgroup1`, etwa `aliasgroup1=https://cloud.example.com:443`. Fehlt der Eintrag, meldet Collabora beim Öffnen „Unauthorized WOPI host“.
2. **MoeCloud muss Collabora kennen.** Unter **Admin › Einstellungen › Office** trägst du die **Eigene Adresse von Collabora** ein, oder du setzt `COLLABORA_URL` in der `.env`. MoeCloud fragt sie ab und zeigt, ob Collabora antwortet und welche Formate es bearbeitet.

Collabora holt und speichert die Dateien selbst bei MoeCloud. Dafür bekommt es die Adresse deiner Cloud, wie sie unter **Allgemein** eingetragen ist, sonst die, unter der du gerade angemeldet bist. Erreicht Collabora die Cloud nur unter einer anderen Adresse, etwa im selben Docker-Netz, trägst du sie als **Adresse von MoeCloud für Collabora** ein. Mit der [Office-Vorschau](#office-vorschau-dazunehmen) hat das nichts zu tun, beide laufen unabhängig voneinander. Wie das Bearbeiten aussieht, steht unter [Office im Browser](#office-im-browser).

MoeCloud spricht mit Collabora über die Schnittstelle, die Collabora für eigene Einbindungen beschreibt. Geprüft sind beide Wege mit Tests gegen diese Beschreibung und mit einem nachgebauten Collabora. Mit einem echten Collabora-Server und einem echten Start in Docker sind sie noch nicht geprüft. Klemmt etwas, helfen das Serverprotokoll unter **Admin › System** und das Protokoll von Collabora (`docker compose logs collabora`), und ein [Issue](https://github.com/MaximilianGT500/moecloud/issues) mit beidem hilft weiter.

### Mit eigener Domain und HTTPS

Für den Betrieb im Internet gehört MoeCloud hinter einen Reverse-Proxy mit HTTPS. Passkeys funktionieren nur über HTTPS oder `localhost`, und Windows bindet WebDAV nur über HTTPS ohne Umwege ein.

Beide Compose-Dateien bringen dafür Caddy mit, das Zertifikate selbst holt. Caddy braucht die [`Caddyfile`](docker/Caddyfile) im Ordner `docker/`:

```bash
mkdir -p docker
curl -o docker/Caddyfile https://raw.githubusercontent.com/MaximilianGT500/moecloud/main/docker/Caddyfile
echo "DOMAIN=cloud.example.com" >> .env
echo "COMPOSE_PROFILES=caddy" >> .env
echo "MOECLOUD_BIND=127.0.0.1" >> .env
docker compose up -d
```

Durch `COMPOSE_PROFILES` startet `docker compose` Caddy bei jedem `up` mit, `MOECLOUD_BIND` sorgt dafür, dass Port 3000 nur noch auf dem Server selbst erreichbar ist. Die Domain muss auf deinen Server zeigen und die Ports 80 und 443 müssen frei sein. Ist MoeCloud noch nicht eingerichtet, öffnest du den Link aus dem Log gleich unter deiner Domain, also `https://cloud.example.com/setup?code=…`.

Lief Caddy schon einmal ohne die Caddyfile, hat Docker an ihrer Stelle einen leeren Ordner `docker/Caddyfile` angelegt, und Caddy startet nicht. Entferne ihn vor dem Download mit `sudo rmdir docker/Caddyfile`.

Ohne Docker reicht in Caddy:

```
cloud.example.com {
	reverse_proxy localhost:3000 {
		flush_interval -1
	}
}
```

Mit nginx brauchst du zusätzlich unbegrenzte Anfragegrößen für Uploads und WebDAV und eine ungepufferte Verbindung, damit Änderungen live ankommen:

```nginx
server {
  server_name cloud.example.com;
  client_max_body_size 0;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_request_buffering off;
  }
}
```

Reicht MoeCloud den Editor von [Collabora Online](#office-bearbeitung-dazunehmen) unter seiner Adresse durch, braucht nginx für dessen Verbindung zusätzlich WebSockets:

```nginx
  location /cool/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 36000s;
  }
```

MoeCloud glaubt den Angaben in `X-Forwarded-For` und `X-Forwarded-Proto` nur von Proxys auf demselben Rechner oder im lokalen Netz. Steht dein Proxy woanders, stellst du das mit `TRUST_PROXY` ein.

### Mit Node.js

Du brauchst Node.js 24 oder neuer. Für Vorschaubilder von Videos und PDFs und die Suche in PDFs installierst du zusätzlich ffmpeg und Poppler, unter Debian und Ubuntu etwa mit `apt install ffmpeg poppler-utils`. ffmpeg liest außerdem Bildformate wie PSD, JPEG XL und BMP. Ohne sie läuft MoeCloud trotzdem, nur mit weniger Vorschauen. Rohformate und HEIC gehen auch ohne. Welche Programme gefunden wurden, zeigt **Admin › System**.

```bash
git clone https://github.com/MaximilianGT500/moecloud.git
cd moecloud
npm ci
npm run build
npm start
```

Die Daten liegen dann im Ordner `data/` im Projekt, mit `DATA_DIR` legst du sie woanders hin. Für den Dauerbetrieb eignet sich ein systemd-Dienst oder [PM2](https://pm2.keymetrics.io/) mit `pm2 start npm --name moecloud -- start`. MoeCloud läuft als ein einzelner Prozess, einen Cluster-Modus gibt es nicht.

## Erster Start und Einrichtung

Solange es noch kein Konto gibt, schreibt MoeCloud bei jedem Start einen Link mit Einrichtungscode ins Log:

```
MoeCloud ist noch nicht eingerichtet. Öffne http://localhost:3000/setup?code=… im Browser.
```

Läuft MoeCloud auf einem anderen Rechner oder hinter einer Domain, ersetzt du `http://localhost:3000` durch die passende Adresse oder setzt vorher `PUBLIC_URL`. Nur wer den Code kennt, kann die Einrichtung abschließen. Der Code bleibt auch nach einem Neustart gleich, einen neuen erzeugst du mit `setup-link --new`, siehe [Kommandozeile](#kommandozeile).

<p align="center">
  <img src="docs/screenshots/setup.png" alt="Einrichtung im Browser, Schritt Aussehen" width="80%">
</p>

Der Assistent führt in 5 Schritten durch:

1. **Einrichtungscode** und Sprache
2. **Deine Cloud**: Name und Adresse, unter der andere sie erreichen
3. **Aussehen**: eine von 8 Grundfarben oder eine eigene, mit Vorschau
4. **Dein Konto**: Name, Benutzername, E-Mail und Passwort für das erste Admin-Konto
5. **Regeln**: wer sich registrieren darf und wie viel Speicher jede Person bekommt

Danach bist du angemeldet und landest in deinen Dateien. Alles lässt sich später unter **Admin › Einstellungen** ändern. Als Nächstes lohnt sich der [E-Mail-Versand](#e-mail), damit „Passwort vergessen“ funktioniert, und bei geteilten Ordnern der [Virenscan](#virenscan-mit-clamav).

## Dateien

Unter **Dateien** liegen deine Ordner und Dateien, als Liste oder als Kacheln mit Vorschaubildern. Daneben zeigt der Detailbereich in drei Reitern **Info** mit Größe, Ort, Änderungsdatum, Bildinfos, der Prüfsumme als SHA-256 zum Kopieren, Ergebnis des Virenscans, Freigaben und Versionen, die **Aktivität** und die **Kommentare**. Bei Ordnern steht dort die Größe samt allem, was darin liegt, mit der Zahl der Dateien und Unterordner.

- **Start**: Die Übersicht unter **Start** zeigt, was du zuletzt bearbeitet hast, deine Favoriten, was andere mit dir geteilt haben, deine Teamordner, anstehende Erinnerungen, Fotos vom selben Tag aus früheren Jahren und deinen Speicher. Über das Symbol oben rechts bringst du die Bereiche in deine Reihenfolge und blendest aus, was du nicht brauchst. Soll sie nach der Anmeldung als Erstes erscheinen, stellst du unter **Konto › Profil** bei **Nach der Anmeldung zeigen** auf **Start mit der Übersicht**.
- **Hochladen**: Zieh Dateien oder Ordner ins Fenster oder direkt auf einen Ordner, oder nimm **Neu › Dateien hochladen** und **Neu › Ordner hochladen**. Gibt es eine Datei schon, wählst du zwischen „Beide behalten“ und „Ersetzen“. Beim Ersetzen bleibt die alte Fassung als Version erhalten.
- **Einfügen**: Strg+V oder ⌘V lädt Dateien und Bilder aus der Zwischenablage in den offenen Ordner. Ein Screenshot heißt dann „Eingefügtes Bild“ mit Datum und Uhrzeit.
- **Neue Textdatei** und **Neuer Ordner** findest du ebenfalls unter **Neu**.
- **Aufnehmen**: Unter **Neu** nimmst du eine **Sprachnotiz**, ein **Foto oder Video** und den **Bildschirm** auf. Der Browser fragt beim ersten Mal, ob MoeCloud Mikrofon, Kamera oder Bildschirm nutzen darf. Während der Aufnahme siehst du Zeit und Größe, pausierst und machst weiter. Danach hörst oder siehst du dir das Ergebnis an, gibst ihm einen Namen und speicherst es im offenen Ordner, oder du nimmst neu auf. Gibt es mehrere Kameras, wechselst du zwischen ihnen, und beim Bildschirm wählst du, ob das Mikrofon mitläuft. Aufgenommen wird je nach Browser als M4A, WebM oder Ogg, Videos als MP4 oder WebM, Fotos als JPEG. Aufnehmen geht nur über HTTPS oder auf dem eigenen Rechner unter `localhost`.
- **Dokument scannen**: **Neu › Dokument scannen** öffnet die Kamera. Du hältst jede Seite in den Rahmen und nimmst sie auf oder wählst stattdessen Fotos deiner Seiten aus. Die Seiten drehst, sortierst und entfernst du, wählst als Darstellung **Dokument** mit weißem Hintergrund und kräftiger Schrift, **Graustufen** oder **Farbe** und speicherst alles als eine PDF in A4 im offenen Ordner. Die Fotos bleiben im Browser, hochgeladen wird nur die fertige PDF.
- **Aus dem Internet laden**: Unter **Neu** trägst du die Adresse einer Datei ein. MoeCloud lädt sie im Hintergrund in den offenen Ordner, mit Virenscan und deinen Speichergrenzen, und meldet sich in den Benachrichtigungen, wenn sie da ist oder etwas schiefging. Den Namen nimmt es aus der Antwort des Servers oder aus der Adresse. Adressen im lokalen Netz wie der Router oder andere Dienste auf dem Server bleiben gesperrt, auch nach Weiterleitungen, außer die Verwaltung erlaubt sie unter **Admin › Einstellungen › Speicher**.
- **Per WebDAV importieren**: Unter **Neu** ziehst du mit deinen Dateien von Nextcloud, ownCloud oder einem anderen Speicher um. Du trägst die WebDAV-Adresse ein, bei Nextcloud steht sie unter **Dateien › Einstellungen › WebDAV**, dazu Benutzername und Passwort oder App-Passwort. MoeCloud legt im offenen Ordner einen neuen Ordner an, etwa „Import von cloud.example.com“, und holt alles hinein, mit allen Unterordnern und dem Änderungsdatum jeder Datei. Der Import läuft im Hintergrund weiter, auch wenn du das Fenster schließt, zeigt den Fortschritt und lässt sich abbrechen. Am Ende sagt eine Benachrichtigung, wie viele Dateien da sind und wie viele sich nicht holen ließen. Jede Datei geht durch den Virenscan und zählt gegen deinen Speicher, ist er voll, hört der Import auf. Die Zugangsdaten nutzt MoeCloud nur für diesen Import und speichert sie nicht. Pro Person läuft ein Import gleichzeitig. Es gelten die Schalter von **Aus dem Internet laden**: Adressen im lokalen Netz sind gesperrt, bis die Verwaltung sie erlaubt.
- **Neu aus Vorlage**: Im Menü eines Ordners macht **Als Vorlagenordner verwenden** ihn zur Quelle für Vorlagen, etwa für einen Briefkopf, ein Protokoll oder eine Tabelle. Unter **Neu › Neu aus Vorlage** wählst du eine Datei daraus und einen Namen, MoeCloud legt eine Kopie im offenen Ordner an. Die Endung bleibt, wie sie ist.
- **Ordnen**: Zieh Elemente auf einen Ordner oder in die Pfadleiste, oder verschieben und kopieren über das Menü. Mehrere wählst du mit Strg, ⌘ oder Umschalt aus. Eigene Dateien und Ordner verschiebst du so auch in geteilte Ordner und [Teamordner](#teamordner-und-gastkonten), sie zählen danach zum Speicher des Ziels. Ist darin noch etwas geteilt oder verlinkt, beendest du das vorher oder kopierst. Aus geteilten Ordnern und Teamordnern heraus kopierst du, damit dort nichts verschwindet, ohne im Papierkorb zu landen.
- **Versionen**: In den Details stehen die älteren Fassungen einer Datei zum Herunterladen, Vergleichen, Wiederherstellen und Löschen. Mit dem Lesezeichen gibst du einer Fassung einen Namen, etwa „Unterschrieben“. Benannte Fassungen räumt MoeCloud nicht von selbst weg, weder über die Zahl pro Datei noch über die Frist in Tagen. Pro Datei gehen bis zu 20.
- **Ordnerfarben**: Im Menü eines Ordners gibt **Farbe** ihm eine von zehn Farben, auch für mehrere Ordner auf einmal.
- **Ordnersymbole**: **Symbol** im selben Menü setzt eines von 28 Symbolen in den Ordner, etwa für Arbeit, Fotos, Reisen oder Finanzen. Farbe und Symbol gehen zusammen, und beides sehen alle, die den Ordner sehen.
- **Weblinks**: **Neu › Neuer Weblink** fragt nach einer Adresse und legt eine kleine Datei mit der Endung `.url` an. Ein Doppelklick zeigt, wohin sie führt, und öffnet die Adresse in einem neuen Tab. MoeCloud liest auch Verknüpfungen von Windows (`.url`) und macOS (`.webloc`) und öffnet nur gewöhnliche Webadressen von selbst.
- **Schlagwörter**: Im Menü oder in den Details vergibst du Schlagwörter in zehn Farben, auch für mehrere Elemente auf einmal und für Dinge, die andere mit dir teilen. Sie erscheinen als Punkte hinter dem Namen und nur bei dir. Unter **Schlagwörter** in der Navigation siehst du alle mit Anzahl, benennst sie um, färbst sie neu und öffnest, was dazugehört.
- **Mehrere umbenennen**: Wählst du mehrere Elemente und drückst F2 oder **Umbenennen**, ersetzt du Text, ergänzt Text vor oder nach dem Namen, nummerierst durch (wie in der Liste oder nach Aufnahmedatum) oder stellst das Aufnahmedatum voran. Eine Vorschau zeigt jeden neuen Namen, Endungen bleiben, wie sie sind. Gibt es einen Namen schon, sagt MoeCloud das, bevor sich etwas ändert.
- **Als ZIP packen**: Eine Auswahl aus Dateien und Ordnern wird ein ZIP-Archiv im selben Ordner, ohne Download und Upload. Darfst du dort nichts anlegen, landet es in deinen eigenen Dateien.
- **Ordnerbeschreibung**: Liegt in einem Ordner eine `README.md` oder `LIESMICH.md`, zeigt MoeCloud sie formatiert über der Liste, zuerst eingeklappt. Auf öffentlichen Ordner-Links gilt das ebenso.
- **Beschreibung**: In den Details gibst du Dateien und Ordnern eine Beschreibung mit bis zu 2000 Zeichen. Alle mit Zugriff sehen sie, wer bearbeiten darf, ändert sie, und die Suche findet den Text.
- **Erinnern**: **Erinnern** im Menü meldet sich zu einer Zeit deiner Wahl: in einer Stunde, heute um 18 Uhr, morgen um 8 Uhr, nächsten Montag um 8 Uhr oder zu einem eigenen Zeitpunkt, auf Wunsch mit einer Notiz. Dann bekommst du eine Benachrichtigung, auch per E-Mail und Push, wenn du das unter **Konto** eingeschaltet hast. Ein Symbol hinter dem Namen zeigt die Erinnerung, die Glocke listet alle anstehenden. Erinnerungen siehst nur du, pro Element gibt es eine.
- **Ablaufdatum**: **Ablaufdatum** im Menü einer Datei oder eines Ordners legt fest, wann sie von selbst in den Papierkorb wandern: morgen, in einer Woche, einem Monat, drei Monaten, einem Jahr oder zu einem eigenen Zeitpunkt, höchstens zehn Jahre im Voraus. Eine Sanduhr hinter dem Namen und die Details zeigen das Datum. Ist es so weit, bekommt die Person, der die Datei gehört, eine Benachrichtigung, bei Teamordnern die Person, die das Datum gesetzt hat. Aus dem Papierkorb kommt alles wie gewohnt zurück. Setzen darf das Datum, wer das Element bearbeiten darf, und Kopien übernehmen es nicht.
- **Herunterladen**: Dateien einzeln, Ordner und mehrere Elemente als ZIP. Unter **Konto** lädt **Daten exportieren** alle eigenen Dateien und eine Übersicht über dein Konto als ein ZIP herunter, siehe [Konto und Sicherheit](#konto-und-sicherheit).
- **Aufräumregel**: Im Menü eines eigenen Ordners legt **Aufräumregel** fest, dass Dateien nach 7, 14, 30, 90 oder 365 Tagen ohne Änderung von selbst in den Papierkorb wandern. Das gilt auch für Unterordner und für alles, was andere dort ablegen. Ein Symbol oben im Ordner zeigt die Regel, wer den Ordner sehen darf, erfährt so davon. MoeCloud prüft die Regeln jede Stunde und meldet in der Glocke, was es aufgeräumt hat. Stellst du etwas aus dem Papierkorb wieder her, beginnt die Frist für diese Dateien neu.
- **Sperren**: Im Menü einer Datei sperrt **Sperren** sie für eine Stunde, acht Stunden, einen Tag, eine Woche oder bis du sie entsperrst. Andere mit Zugriff können sie weiter ansehen und herunterladen, aber nicht ändern, ersetzen, umbenennen, verschieben oder löschen. Das gilt auch für den Ordner drumherum und über WebDAV. Ein Schloss hinter dem Namen zeigt, wer gesperrt hat und bis wann. Entsperren kann, wer gesperrt hat, wem die Datei gehört und jeder Admin. Löst jemand anderes deine Sperre, bekommst du eine Benachrichtigung. Aufräumregeln lassen gesperrte Dateien liegen.
- **Entpacken**: Im Menü eines Archivs packt **Entpacken** den Inhalt in einen neuen Ordner daneben, samt Unterordnern und Änderungsdatum. Das geht mit ZIP, TAR, TAR.GZ und TGZ. Eine einzelne GZ-Datei wie `Bericht.csv.gz` wird zu `Bericht.csv` im selben Ordner. Jede Datei geht durch den Virenscan. Schadsoftware, verschlüsselte Einträge, Pfade, die aus dem Ordner herausführen, symbolische Links, Geräte und Dateien über der Größengrenze überspringt MoeCloud und sagt, wie viele es waren. Harte Links in TAR-Archiven werden zu einer Kopie, die keinen zusätzlichen Platz auf der Platte braucht. Vorher prüft es, ob dein Speicher und der Platz auf dem Server reichen. Die Vorschau zeigt den Inhalt aller dieser Archive und lädt einzelne Dateien daraus.
- **Auf früheren Stand zurücksetzen**: Hat etwas viele Dateien verändert, umbenannt oder gelöscht, etwa ein Programm mit einem Fehler oder ein Erpressungstrojaner auf einem Gerät mit WebDAV, holst du einen eigenen Ordner mit dem Uhrsymbol in seiner Kopfzeile oder über sein Menü auf einen früheren Stand zurück. Du wählst den Zeitpunkt, vor einer Stunde, heute früh, gestern um diese Zeit, vor einer Woche oder genau auf die Minute, bis zu 365 Tage zurück. Die Vorschau zeigt, was zurückkommt, bevor sich etwas ändert: Dateien bekommen ihren Inhalt von damals als neue Version, alte Namen kommen zurück, Gelöschtes kommt aus dem Papierkorb, und was danach dazukam, wandert in den Papierkorb. Nichts geht dabei verloren, der heutige Stand bleibt als Version oder im Papierkorb. Was endgültig gelöscht wurde oder keine Version von damals mehr hat, nennt die Vorschau, zurückholen lässt es sich nicht. In Teamordnern und geteilten Ordnern anderer geht das nicht.
- **Zuletzt** zeigt, was du zuletzt hochgeladen oder geändert hast, daneben die **Aktivität** in all deinen Ordnern. **Favoriten** sammelt alles mit Stern.
- **Suche**: Die Suchleiste findet Dateien und Ordner nach Namen und Wörter im Inhalt von Texten, PDFs und Office-Dokumenten. Filter grenzen auf Ordner, Bilder, Videos, Audio, PDFs oder Dokumente ein, dazu auf das Änderungsdatum, die Größe und ein Schlagwort. Die Filter gehen auch ohne Suchbegriff, der Knopf rechts in der Suchleiste öffnet sie. Treffer im Inhalt erscheinen mit der passenden Stelle. **Suche speichern** merkt sich Begriff und Filter unter einem Namen. Gespeicherte Suchen stehen als Chips über den Treffern und erscheinen, sobald du in die leere Suchleiste klickst.
- **Speicher** zeigt, was wie viel Platz belegt, die größten Dateien und Dateien mit genau gleichem Inhalt. **Nur eine behalten** legt die Kopien einer Datei in den Papierkorb, die älteste bleibt, **Alle aufräumen** macht das für alle Gruppen. Du erreichst die Seite über dein Bild unten links und unter **Konto**. Ist dein Speicher zu 90 % voll, bekommst du eine Benachrichtigung. Hast du eine Grenze, schickt **Mehr Speicher anfragen** der Verwaltung eine Nachricht mit deinem belegten Platz und auf Wunsch ein paar Worten dazu, höchstens einmal am Tag.
- **Papierkorb**: Gelöschtes bleibt dort 30 Tage, danach räumt MoeCloud es weg. Ordner kommen samt Inhalt zurück. Die Frist stellst du unter **Admin › Einstellungen › Speicher** ein.

<p align="center">
  <img src="docs/screenshots/start.png" alt="Die Startseite mit zuletzt bearbeiteten Dateien, Favoriten, Teamordnern und Speicher" width="80%">
</p>
<p align="center">
  <img src="docs/screenshots/grid.png" alt="Ein Ordner mit Fotos als Kacheln" width="49%">
  <img src="docs/screenshots/storage.png" alt="Speicher mit Aufteilung nach Art, den größten und den doppelten Dateien" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/rename.png" alt="Sieben Fotos werden nach Aufnahmedatum durchnummeriert, mit Vorschau der neuen Namen" width="80%">
</p>
<p align="center">
  <img src="docs/screenshots/lock.png" alt="Eine Textdatei wird für einen Tag gesperrt" width="80%">
</p>
<p align="center">
  <img src="docs/screenshots/rewind.png" alt="Ein Ordner wird auf den Stand vor einer Umbenennung zurückgesetzt, mit Vorschau der Änderungen" width="49%">
  <img src="docs/screenshots/recorder.png" alt="Eine Sprachnotiz wird aufgenommen" width="49%">
</p>

Mit der Tastatur:

| Taste                   | Wirkung                          |
| ----------------------- | -------------------------------- |
| `/`                     | Suche öffnen                     |
| Pfeiltasten, Pos1, Ende | Zwischen den Elementen wechseln  |
| Enter                   | Öffnen                           |
| Leertaste               | Auswählen                        |
| Strg+A                  | Alles auswählen                  |
| Strg+V                  | Aus der Zwischenablage hochladen |
| Entf                    | In den Papierkorb                |
| F2                      | Umbenennen, auch mehrere         |
| Esc                     | Auswahl aufheben                 |
| Umschalt+F10            | Menü des Elements                |
| Strg+K                  | Schnellzugriff öffnen            |
| `?`                     | Alle Tastenkürzel zeigen         |

**Schnellzugriff**: Strg+K oder ⌘K öffnet ein Feld, in dem du einfach lostippst. Es springt in jeden Bereich, auch in die Verwaltung und auf Seiten von [Plugins](#plugins), findet Dateien und Ordner, wechselt das [Theme](#themes) und zwischen hell und dunkel. Du findest ihn auch im Menü hinter deinem Bild.

<p align="center">
  <img src="docs/screenshots/palette.png" alt="Schnellzugriff mit Strg+K" width="80%">
</p>

Auf dem Handy wechselst du am unteren Rand zwischen Start, Dateien, Fotos, Geteilt und deinem Konto. Zuletzt, Teamordner, Favoriten, Aktivität, Speicher und Papierkorb liegen oben in deinen Dateien. Ein Tipp öffnet, langes Drücken wählt aus.

<p align="center">
  <img src="docs/screenshots/mobile.png" alt="Dateien auf dem Handy im hellen Design" width="32%">
  <img src="docs/screenshots/login.png" alt="Anmeldung auf dem Handy" width="32%">
</p>

## Vorschau

Ein Doppelklick öffnet eine Datei in der Vollbildansicht, mit den Pfeiltasten oder einem Wischen geht es zur nächsten. Die Taste `i` blendet die Informationen zur Datei ein.

| Art                                                | Vorschau                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bilder                                             | Zoomen, Kamera, Objektiv, Belichtung und Aufnahmedatum, Diashow, nach links und rechts drehen                                                    |
| Rohformate, HEIC und TIFF                          | Ein großes Vorschaubild vom Server, weil Browser diese Formate nicht selbst zeigen                                                               |
| Videos und Audio                                   | Player mit Untertiteln, Musik im Player am unteren Rand mit Cover, Titel, Interpret und Album                                                    |
| PDFs                                               | Im Browser mit allen Seiten                                                                                                                      |
| Markdown                                           | Gesetzt mit Überschriften, Tabellen und Aufgabenlisten, auf Wunsch als Quelltext                                                                 |
| Code und Texte                                     | Hervorhebung für mehr als 30 Sprachen und Zeilennummern, bis 2 MB bearbeiten und mit Strg+S speichern                                            |
| CSV, JSON                                          | CSV als Tabelle, JSON eingerückt und hervorgehoben                                                                                               |
| Word und Excel                                     | Word-Dokumente mit Seiten, Excel-Tabellen mit allen Blättern                                                                                     |
| PowerPoint, OpenDocument und ältere Office-Dateien | Als PDF mit allen Seiten, wenn LibreOffice eingerichtet ist: `.pptx`, `.ppt`, `.pps`, `.ppsx`, `.odt`, `.ods`, `.odp`, `.doc`, `.xls` und `.rtf` |
| E-Books (`.epub`)                                  | Inhaltsverzeichnis und Blättern von Abschnitt zu Abschnitt, die letzte Stelle bleibt gemerkt                                                     |
| Dokumente mit Vorschaubild                         | Das Vorschaubild aus der Datei und der Knopf zum Herunterladen                                                                                   |
| ZIP-Archive                                        | Inhalt mit Größen und Datum, durchsuchbar, einzelne Dateien daraus herunterladen                                                                 |
| E-Mails (`.eml`)                                   | Betreff, Absender, Empfänger, Datum und Anhänge, der Inhalt abgeschottet ohne Bilder aus dem Internet                                            |
| Termine (`.ics`)                                   | Alle Termine mit Zeit, Ort und Beschreibung, sortiert nach Datum                                                                                 |
| Kontakte (`.vcf`)                                  | Karten mit Telefon, E-Mail, Adresse, Geburtstag und Webseite                                                                                     |
| Schriften                                          | TTF, OTF, WOFF und WOFF2 mit eigenem Beispieltext                                                                                                |

Vorschaubilder erzeugt MoeCloud im Hintergrund, für Videos mit ffmpeg, für PDFs mit Poppler und für Musik aus dem eingebetteten Cover. Dabei liest es auch Bildinfos, Musik-Tags und den Text für die Suche aus. Für Dateien, die schon vor dem Update da waren, holt MoeCloud das nach dem Start selbst nach. Dateien, in denen der Virenscan etwas gefunden hat, öffnet die Vorschau nicht. Kann dein Browser ein Video oder eine Audiodatei nicht abspielen, zeigt MoeCloud einen Hinweis und den Knopf zum Herunterladen.

**E-Books**: EPUB-Dateien öffnet die Vorschau als Buch. Oben wählst du einen Abschnitt aus dem Inhaltsverzeichnis, mit den Knöpfen daneben blätterst du weiter. Pro Buch merkt sich der Browser, wo du warst. Den Inhalt liefert der Server in einem abgeschotteten Bereich aus, ohne Skripte und ohne Bilder oder Schriften aus dem Internet. Das klappt auch über öffentliche Links.

<p align="center">
  <img src="docs/screenshots/epub.png" alt="Ein E-Book in der Vorschau mit Inhaltsverzeichnis und Abschnitten" width="80%">
</p>

**Office-Vorschau über LibreOffice**: PowerPoint-, OpenDocument- und ältere Office-Dateien wandelt MoeCloud beim ersten Öffnen mit [LibreOffice](https://www.libreoffice.org) in eine PDF um und bewahrt sie auf, bis sich die Datei ändert. Das dauert bei großen Dokumenten ein paar Sekunden und geht bis 100 MB. Mit dem Installationsskript richtet `sudo moecloud office on` das ein, mit Docker die Ergänzung unter [Office-Vorschau dazunehmen](#office-vorschau-dazunehmen). In beiden Fällen läuft LibreOffice in einem eigenen Container ohne Zugang zum Internet. Mit Node.js genügt ein installiertes LibreOffice: MoeCloud findet `soffice` im `PATH` oder über `SOFFICE_PATH`, startet es für jede Datei mit einem frischen Profil, lässt keine Makros laufen und lädt keine verknüpften Inhalte nach. Ob die Vorschau bereit ist, zeigt **Admin › System**.

E-Mails zeigt MoeCloud wie ein Mailprogramm, den Inhalt aber in einem abgeschotteten Bereich ohne Skripte. Bilder, die in der E-Mail stecken, erscheinen, Bilder aus dem Internet lädt MoeCloud nicht, so bekommt der Absender keine Lesebestätigung über ein Zählpixel. Links öffnen sich in einem neuen Tab, Anhänge lädst du einzeln herunter.

<p align="center">
  <img src="docs/screenshots/email.png" alt="Eine E-Mail mit Absender, Empfängern und Anhang in der Vorschau" width="80%">
</p>

### Bildformate

| Format                                                                                                                           | Was du siehst                                                                       | Braucht |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| JPEG, PNG, GIF, WebP, AVIF, SVG                                                                                                  | Das Original                                                                        | Nichts  |
| TIFF                                                                                                                             | Ein großes Vorschaubild                                                             | Nichts  |
| HEIC, HEIF und HIF                                                                                                               | Das dekodierte Foto, richtig gedreht und mit umgerechneten Farben                   | Nichts  |
| DNG, CR2, CR3, CRW, NEF, NRW, ARW, SRF, SR2, RAF, ORF, RW2, RWL, PEF, SRW, 3FR, FFF, ERF, KDC, DCR, MOS, MEF, MRW, X3F, IIQ, GPR | Das Vorschaubild, das die Kamera in die Datei gelegt hat                            | Nichts  |
| BMP, ICO und CUR                                                                                                                 | Das Original, Vorschaubilder mit ffmpeg                                             | ffmpeg  |
| PSD, PSB, JPEG XL, JPEG 2000, TGA, DDS, QOI, PCX, PPM, PGM, PBM und SGI                                                          | Ein großes Vorschaubild                                                             | ffmpeg  |
| ODT, ODS, ODP, ODG, PPTX, Pages, Numbers, Keynote, EPUB, CBZ, Krita, OpenRaster, XMind, Sketch, Procreate, 3MF und GeoGebra      | Das Vorschaubild aus der Datei, wenn sie eins mitbringt, bei Comics die erste Seite | Nichts  |

Bei Rohformaten wie DNG vom iPhone nimmt MoeCloud das Vorschaubild, das die Kamera eingebettet hat, und entwickelt die Rohdaten nicht selbst. Je nach Kamera ist es so groß wie das Foto oder kleiner. Abmessungen, Aufnahmedatum, Kamera und Belichtung kommen aus der Rohdatei. Das Original bleibt unangetastet, Drehen gibt es für diese Formate deshalb nicht. Rohdateien erscheinen wie andere Bilder unter **Fotos**.

Große Vorschaubilder haben bis zu 2560 Pixel Kantenlänge. MoeCloud erzeugt sie beim ersten Öffnen und legt sie in `data/previews/` ab, danach kommen sie sofort. Die Bildansicht zeigt dann den Hinweis „Vorschaubild“, Herunterladen liefert immer das Original.

HEIC dekodiert MoeCloud in einem eigenen Prozess. Ein Foto mit 12 Megapixeln braucht dabei kurz etwa 300 MB Arbeitsspeicher, Fotos mit mehr als 64 Megapixeln bleiben ohne Vorschau.

Sagt die Endung nichts über den Inhalt, schaut MoeCloud in den Anfang der Datei. So öffnet sich `LIESMICH` als Text, ein Foto ohne Endung als Bild und eine Illustrator-Datei mit PDF-Inhalt als PDF. Dateien mit `.ts` oder `.mts` gelten als TypeScript, außer der Inhalt ist ein Video.

<p align="center">
  <img src="docs/screenshots/viewer.png" alt="Bildansicht im Vollbild mit Knöpfen für Diashow, Informationen, Herunterladen und Teilen" width="80%">
</p>

## Bearbeiten

- **Bilder**: **Bild bearbeiten** im Menü öffnet den Editor. Du schneidest frei oder in einem festen Seitenverhältnis zu, drehst, spiegelst und verkleinerst auf eine längste Seite. Gespeichert wird als JPEG, PNG, WebP oder AVIF, als Kopie neben dem Original oder als neue Version, dann bleibt die alte unter **Versionen**. Das klappt auch mit HEIC und dem Bild in Rohdateien, Aufnahmedatum und Kamera bleiben erhalten. Bilder bis 100 Megapixel und 300 MB.
- **PDFs**: **Seiten bearbeiten** zeigt alle Seiten als Kacheln. Du sortierst sie per Ziehen oder mit den Pfeilen um, drehst und entfernst Seiten und speicherst ausgewählte Seiten als eigene PDF. Wählst du mehrere PDFs aus, fügt **PDFs zusammenfügen** sie in der Reihenfolge deiner Wahl zu einer zusammen. Lesezeichen und ausfüllbare Felder übernimmt MoeCloud dabei nicht. PDFs bis 200 MB und 2000 Seiten, verschlüsselte PDFs bleiben unverändert.
- **Bilder als PDF**: Wählst du Bilder aus, macht **Als PDF speichern** daraus eine PDF im selben Ordner. Jedes Bild wird eine Seite, in der Reihenfolge deiner Wahl, als A4-Seite oder so groß wie das Bild. Das passt für fotografierte Belege und Scans, bis zu 200 Bilder gehen auf einmal. Die Bilder selbst bleiben, wie sie sind.
- **Versionen vergleichen**: Bei Text, Markdown, Code, CSV und JSON zeigt **Version vergleichen** unter **Versionen**, welche Zeilen dazugekommen und welche weggefallen sind, auf Wunsch mit dem ganzen Text.
- **Texte** bearbeitest du in der Vorschau und speicherst mit Strg+S, **Bilder drehen** geht mit einem Klick in der Bildansicht.

<p align="center">
  <img src="docs/screenshots/editor.png" alt="Bildeditor mit Zuschnitt im Format 16:9" width="49%">
  <img src="docs/screenshots/pdf.png" alt="Seiten einer PDF als Kacheln mit umsortierter und gedrehter Seite" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/diff.png" alt="Vergleich zweier Versionen einer Markdown-Datei mit hinzugefügten und entfernten Zeilen" width="80%">
</p>

## Office im Browser

Mit [Collabora Online](https://www.collaboraonline.com/code/) bearbeitest du Textdokumente, Tabellen und Präsentationen direkt in MoeCloud, ohne sie herunterzuladen. Wie du Collabora verbindest, steht unter [Office-Bearbeitung dazunehmen](#office-bearbeitung-dazunehmen).

- **Öffnen**: Ein Doppelklick auf eine Word-, Excel-, PowerPoint- oder OpenDocument-Datei öffnet sie im Editor, im Menü heißt der Punkt **In Office bearbeiten**. Die gewohnte **Vorschau** bleibt daneben im Menü. Welche Formate gehen, meldet Collabora selbst, MoeCloud zeigt sie unter **Admin › Einstellungen › Office**.
- **Neu anlegen**: **Neu › Neues Dokument**, **Neue Tabelle** und **Neue Präsentation** legen eine leere Datei im aktuellen Ordner an und öffnen sie.
- **Zusammen arbeiten**: Öffnen mehrere Personen dieselbe Datei, schreiben sie gleichzeitig darin und sehen die Änderungen der anderen. Das gilt für alle, die die Datei bearbeiten dürfen, auch in geteilten Ordnern und Teamordnern.
- **Nur lesen**: Wer eine Datei nur ansehen darf, öffnet sie mit **In Office öffnen** ohne Schreibrecht. Dasselbe gilt, solange jemand anderes die Datei gesperrt hat.
- **Speichern**: Collabora speichert von selbst in die Datei zurück. MoeCloud prüft dabei den Speicher und legt eine Version an, wenn du mit dem Bearbeiten beginnst, und danach höchstens alle zehn Minuten. So füllen die automatischen Speicherungen die Liste der Versionen nicht.
- **Rechte**: Für jede geöffnete Datei bekommt Collabora einen eigenen Schlüssel, der nur für diese Datei und diese Person gilt und nach zehn Stunden abläuft. MoeCloud prüft dein Recht bei jedem Zugriff neu. Nimmt dir jemand die Freigabe, endet auch die Bearbeitung.

Über öffentliche Links gibt es das Bearbeiten nicht, Besucher ohne Konto sehen dort weiter die Vorschau.

## Abläufe und Umwandeln

**Abläufe** nehmen dir Handgriffe ab, die bei jeder neuen Datei gleich sind. Im Menü eines Ordners öffnet **Abläufe** die Liste für diesen Ordner. Ein Ablauf hat einen Namen, Bedingungen und mindestens eine Aktion:

- **Wenn eine neue Datei ankommt**: Der Ablauf gilt für alle neuen Dateien oder nur für bestimmte Arten (Bilder, Videos, Musik, PDFs, Dokumente, Archive, Sonstiges), bestimmte Endungen oder Namen, die einen Text enthalten. Mit **Auch in Unterordnern** greift er im ganzen Ordner.
- **Schlagwort vergeben**: eins deiner Schlagwörter.
- **Umbenennen nach Muster**: etwa `{datum} {name}`. Es gibt `{name}`, `{datum}`, `{jahr}`, `{monat}`, `{tag}`, `{zeit}` und `{nummer}`, die Endung bleibt. Gibt es den Namen schon, hängt MoeCloud eine Zahl an.
- **Zusätzlich speichern als**: PDF für Office-Dokumente, JPEG, PNG, WebP oder AVIF für Bilder. Das Original bleibt, und passt das Format nicht zur Datei, passiert nichts.
- **Kopie ablegen in**: eine Kopie in einem zweiten Ordner, etwa für die Buchhaltung. Sie entsteht, bevor die Datei verschoben wird.
- **Verschieben nach**: in einen Unterordner oder einen Ordner daneben, auf Wunsch in Ordner pro Jahr oder pro Jahr und Monat, etwa `2026/2026-11`. Es zählt das Änderungsdatum der Datei.
- **In ein Album legen**: Bilder und Videos landen in einem deiner [Alben](#fotos-und-alben), anderes lässt die Aktion aus.
- **Als Favorit markieren** und **Mir Bescheid geben**: Die Nachricht kommt in der Glocke an.

Die Aktionen laufen in dieser Reihenfolge. Ein Ablauf greift bei allem, was hochgeladen wird, über einen Link zum Hochladen kommt oder über WebDAV. So wird aus einem Ordner „Eingang“ ein Posteingang: Rechnungen als PDF bekommen ein Schlagwort, das Datum im Namen und einen Platz im Ordner des Jahres. **Jetzt anwenden** schickt einmal alles durch den Ablauf, was schon im Ordner liegt, bis zu 500 Dateien auf einmal.

Abläufe gehören dir und arbeiten mit deinen Rechten, auch in geteilten Ordnern und Teamordnern, in denen du bearbeiten darfst. Klappt etwas nicht, etwa weil der Zielordner fehlt, steht der Grund am Ablauf. Pro Person gehen bis zu 50 Abläufe. Dateien, die MoeCloud aus dem Internet lädt oder per WebDAV importiert, lösen keinen Ablauf aus.

<p align="center">
  <img src="docs/screenshots/automations.png" alt="Ein Ablauf, der Rechnungen umbenennt, mit einem Schlagwort versieht und nach Jahr einsortiert" width="80%">
</p>

**Umwandeln** im Menü einer Datei legt eine Kopie in einem anderen Format daneben: Bilder als JPEG, PNG, WebP oder AVIF, Word, Excel, PowerPoint und OpenDocument als PDF. Für PDFs braucht MoeCloud LibreOffice, siehe [Office-Vorschau dazunehmen](#office-vorschau-dazunehmen). Wählst du mehrere Dateien aus, wandelt **Umwandeln** bis zu 50 auf einmal um. Dateien, zu denen das Format nicht passt, bleiben aus.

## Notizen

**Notizen** in der Navigation ist der Platz für alles, was schnell aufgeschrieben sein will: Einkaufslisten, Ideen, Protokolle. Links steht die Liste, rechts die Notiz.

- **Schreiben**: **Neue Notiz** legt eine an, du tippst den Titel und schreibst los. MoeCloud speichert von selbst, sobald du kurz innehältst, und mit Strg+S sofort. Oben steht, ob alles gespeichert ist.
- **Markdown**: Überschriften, Listen, Links und Code schreibst du in Markdown, die Knöpfe für Überschrift, Liste und Aufgabe setzen die Zeichen für dich. **Lesen** zeigt die Notiz gestaltet, **Beides** stellt auf breiten Bildschirmen Text und Vorschau nebeneinander. Aufgaben mit `- [ ]` hakst du dort mit einem Klick ab.
- **Finden**: Das Feld über der Liste filtert nach Titel und Anfang des Texts, Favoriten stehen oben. Die Suche von MoeCloud findet Notizen auch über ihren Inhalt.
- **Kategorien**: Unterordner im Notizordner erscheinen als Kategorien über der Liste, bis zu drei Ebenen tief.
- **Aufgaben**: Der Eintrag **Aufgaben** über der Liste sammelt alle Zeilen zum Abhaken aus deinen Notizen, nach Notiz geordnet. Ein Haken dort ändert die Notiz selbst, erledigte Aufgaben blendest du bei Bedarf ein.
- **Dateien bleiben Dateien**: Jede Notiz ist eine Textdatei mit der Endung `.md` im Ordner **Notizen** in deinen Dateien, der Titel ist ihr Name. Auch `.txt` zeigt die Liste. Du kannst Notizen deshalb teilen, mit einem Schlagwort versehen, über [WebDAV](#als-laufwerk-einbinden) mit jedem Editor bearbeiten und aus dem Papierkorb zurückholen. Den Ordner darfst du umbenennen und verschieben, MoeCloud merkt sich, welcher es ist.
- **Versionen**: Während du schreibst, legt MoeCloud nicht bei jedem Speichern eine Version an, sondern höchstens alle zehn Minuten. So bleiben ältere Fassungen in der Liste.
- **Zwei Geräte**: Ändert sich eine Notiz an anderer Stelle, während du sie offen hast, sagt MoeCloud beim nächsten Speichern Bescheid. Du lädst sie neu oder speicherst deine Fassung darüber.

Eine Notiz darf bis zu 1 MB groß sein, die Liste zeigt die 2000 neuesten. Gastkonten haben keine eigenen Notizen.

<p align="center">
  <img src="docs/screenshots/notizen.png" alt="Notizen mit der Liste links und einer geöffneten Notiz rechts" width="80%">
</p>

<p align="center">
  <img src="docs/screenshots/aufgaben.png" alt="Die Übersicht der Aufgaben aus allen Notizen, mit erledigten und offenen Zeilen" width="80%">
</p>

## Musik und Video

- **Musik**: Ein Doppelklick auf eine Audiodatei spielt sie im Player am unteren Rand ab, danach folgen die anderen Titel der Ansicht. **Alle abspielen** in der Kopfzeile, **Abspielen** und **Zur Warteschlange hinzufügen** im Menü stellen zusammen, was läuft. Der Player zeigt Cover, Titel, Interpret und Album aus den Tags, spielt auf Wunsch zufällig oder wiederholt, und lässt sich über Medientasten und den Sperrbildschirm steuern. Er läuft beim Wechseln der Ansichten weiter und merkt sich die Warteschlange, bis du ihn schließt.
- **Bereich Musik**: **Musik** in der Navigation zeigt alle Audiodateien aus deinen Ordnern, als Liste aller Titel, nach **Alben** und nach **Interpreten**. Titel, Interpret, Album, Jahr und Nummer kommen aus den Tags der Dateien. Fehlen sie, nimmt MoeCloud den Dateinamen, eine Zahl am Anfang gilt als Nummer. Das Suchfeld filtert alle drei Ansichten. Der Bereich zeigt die 10.000 neuesten Titel.
- **Wiedergabelisten**: Über **Zur Wiedergabeliste hinzufügen** im Menü eines Titels, eines Albums oder eines Ordners sammelst du Musik in Listen, die Dateien bleiben, wo sie sind. In der Liste änderst du die Reihenfolge und nimmst Titel wieder heraus. Auch Musik aus Freigaben und Teamordnern passt hinein, solange du darauf zugreifen darfst. Eine Liste fasst bis zu 5000 Titel.
- **M3U**: Jede Liste lädst du als `.m3u8` herunter, die Pfade darin gelten ab deinem Hauptordner und passen damit zu einem [eingebundenen Laufwerk](#als-laufwerk-einbinden). Umgekehrt macht **Als Wiedergabeliste übernehmen** im Menü einer `.m3u`- oder `.m3u8`-Datei daraus eine Liste. MoeCloud sucht die Titel neben der Datei und ab deinem Hauptordner und sagt, wie viele Einträge es nicht gefunden hat. Adressen aus dem Internet überspringt es.
- **Tempo und Schlummern**: In der Warteschlange stellst du das Tempo zwischen 0,75× und 2× ein. **Schlummern** hält die Wiedergabe nach 15 bis 90 Minuten oder am Ende des Titels an und blendet dabei leise aus.
- **Zuletzt und oft gehört**: MoeCloud zählt mit, was du hörst, sobald ein Titel 30 Sekunden oder zur Hälfte gelaufen ist. Über **Titel sortieren** stehen die zuletzt und die am häufigsten gehörten Titel oben, ebenso die neu dazugekommenen. Die Zählung gehört zu deinem Konto und steht im [Datenexport](#konto-und-sicherheit).
- **Untertitel**: Liegt neben einem Video eine Datei mit demselben Namen und der Endung `.srt` oder `.vtt`, etwa `Film.srt`, `Film.de.srt` oder `Film.en.vtt`, bietet die Wiedergabe sie als Spur an. Passt eine zur Sprache der Oberfläche, ist sie eingeschaltet. SRT wandelt der Server in WebVTT um, auch Dateien mit Umlauten aus älteren Programmen.
- **Weiterschauen**: Videos ab einer Minute und Audio ab zehn Minuten merken sich, wo du aufgehört hast, pro Person und über Geräte hinweg. Beim nächsten Öffnen geht es dort weiter, **Von vorn** startet neu. In den Kacheln zeigt ein Balken, wie weit du gekommen bist.

<p align="center">
  <img src="docs/screenshots/musik.png" alt="Musik nach Alben mit Covern" width="80%">
</p>

## Fotos und Alben

**Fotos** zeigt alle Bilder und Videos aus deinen Ordnern, nach Monaten gruppiert und sortiert nach dem Aufnahmedatum aus den EXIF-Daten. Fehlt es, zählt das Änderungsdatum. Ein Klick öffnet die Bildansicht, ▶ startet dort eine Diashow mit allen Bildern. Auch bei zehntausenden Fotos lädt jede Seite der Zeitleiste in wenigen Millisekunden.

**An diesem Tag** steht über der Zeitleiste, wenn es Fotos vom heutigen Tag aus früheren Jahren gibt, etwa „Vor 3 Jahren“. Ein Klick öffnet sie in der Bildansicht, das Kreuz blendet die Erinnerungen für heute aus.

**Alben** findest du unter **Fotos › Alben**. Mit dem Kästchen auf einem Foto oder langem Drücken wählst du aus und legst die Auswahl in ein Album, in Dateien heißt der Menüpunkt **Zum Album hinzufügen**. Die Fotos bleiben dabei, wo sie sind. Jedes Album hat ein Titelbild, eine Diashow und einen Download als ZIP, Alben gehören nur dir.

## Teilen

Über **Teilen** im Menü eines Elements gibst du Ordner und Dateien frei. Unter **Geteilt** siehst du, was andere mit dir teilen und was du selbst teilst.

**Mit Personen**: Du suchst ein Konto nach Name oder Benutzername und wählst „Kann ansehen“ oder „Kann bearbeiten“. Bei der anderen Person erscheint die Freigabe unter **Geteilt**, dazu eine Benachrichtigung. Mit Bearbeiten darf sie hochladen, umbenennen, verschieben und löschen, der Speicher zählt bei dir. Sie kann die Freigabe jederzeit verlassen.

**Ablaufdatum**: Über die Uhr neben einer Person oder Gruppe legst du fest, wie lange eine Freigabe gilt, für einen Tag, eine Woche, einen Monat oder bis zu einem Datum. Danach endet der Zugriff, und die Aktivität vermerkt das. Unter **Geteilt** steht, bis wann eine Freigabe gilt.

**Notiz**: Beim Teilen mit einer Person oder Gruppe schreibst du auf Wunsch ein paar Worte dazu, etwa „Bitte bis Freitag ansehen“. Die Empfänger sehen die Notiz in der Benachrichtigung, unter **Geteilt** und in den Details der Freigabe. Sie darf bis zu 300 Zeichen lang sein.

**Mit Gruppen**: Admins legen unter **Admin › Gruppen** Gruppen wie „Familie“ oder „Team“ an. Im Dialog zum Teilen findest du sie neben den Personen und teilst mit allen Mitgliedern auf einmal. Wer neu in die Gruppe kommt, sieht sofort alles, was mit ihr geteilt ist, wer sie verlässt, verliert den Zugriff. Unter **Geteilt** steht bei jeder Freigabe, über welche Gruppe sie kommt. Teilen kannst du nur mit Gruppen, in denen du selbst bist, Admins mit allen.

**Öffentliche Links**: Wer den Link kennt, kommt ohne Konto an den Inhalt. Der Würfel im Passwortfeld erzeugt ein zufälliges Passwort und kopiert es, und die Passwortseite eines Links verrät den Namen der Datei nicht, sondern nur die Bezeichnung, die du dem Link gibst. Pro Element sind mehrere Links möglich, jeder mit eigener Bezeichnung, Passwort und Ablaufdatum. Du legst fest, ob Besucher herunterladen und hochladen dürfen, und siehst, wie oft der Link aufgerufen wurde. Mit einer Grenze für Downloads funktioniert der Link nach 1 bis 100 Downloads nicht mehr, Ansehen zählt dabei nicht mit, und Besucher sehen, wie viele noch übrig sind. **Pausieren** schaltet einen Link vorübergehend ab, ohne dass sich die Adresse ändert. Mit **Benachrichtigen, wenn jemand herunterlädt** meldet MoeCloud Downloads über den Link, höchstens einmal pro Stunde. Besucher sehen Ordner mit Vorschaubildern, öffnen Dateien in der Vorschau und laden alles als ZIP herunter. In Messengern zeigt der Link Titel, Absender und bei Bildern ohne Passwort eine Vorschau.

**Link per E-Mail**: Ist der [E-Mail-Versand](#e-mail) eingerichtet, schickst du einen Link über das Brief-Symbol direkt an eine E-Mail-Adresse. Die E-Mail nennt deinen Namen, das geteilte Element und das Ablaufdatum. Das Passwort eines Links steht nie darin, das gibst du auf einem anderen Weg weiter.

**Dateien anfragen**: Mit „Nur hochladen“ sehen Besucher nur ein Feld zum Hochladen. Die Dateien landen in deinem Ordner, gleichnamige Dateien überschreiben dabei nichts. Mit „Benachrichtigen, wenn etwas ankommt“ meldet MoeCloud neue Uploads gesammelt in der Glocke und auf Wunsch per E-Mail.

**Eigene Adresse**: Im Teilen-Fenster gibst du einem Link statt der zufälligen Adresse eine eigene, etwa `/s/urlaub-2026`, mit 3 bis 64 Kleinbuchstaben, Ziffern und Bindestrichen. Solche Adressen lassen sich leichter erraten, nimm bei Vertraulichem ein Passwort dazu. Abschalten lässt sich das unter **Admin › Einstellungen › Teilen**.

**Beginn, Nachricht und Aussehen**: In den Einstellungen eines Links legst du mit **Gilt ab** fest, ab welchem Tag er funktioniert. Vorher sehen Besucher nur, ab wann er gilt. Eine **Nachricht für Besucher** steht auf der Seite des Links über dem Inhalt, und unter **Aussehen der Seite** wählst du ein [Theme](#themes), in dem Besucher die Seite sehen, unabhängig vom Theme deiner Cloud.

**Verlauf**: **Verlauf** neben einem Link zeigt, wann er geöffnet wurde, was heruntergeladen oder hochgeladen wurde und ob jemand ein falsches Passwort eingegeben hat, jeweils mit Browser und System. IP-Adressen speichert MoeCloud dafür nicht. Der Verlauf bleibt so lange wie die Aktivität, pro Link die letzten 1000 Einträge.

<p align="center">
  <img src="docs/screenshots/link-history.png" alt="Ein Link mit eigener Adresse und seinem Verlauf im Teilen-Fenster" width="80%">
</p>

**Erinnerung vor dem Ablauf**: Zwei Tage bevor ein Link abläuft, bekommst du eine Benachrichtigung und kannst im Teilen-Fenster ein neues Datum einstellen. Bei Links, die von vornherein nur ein paar Tage gelten, entfällt sie.

**Inhalt melden**: Unten auf jeder geteilten Seite steht **Inhalt melden**. Besucher wählen einen Grund, etwa Schadsoftware, Urheberrecht oder persönliche Daten, und schreiben auf Wunsch ein paar Worte und eine E-Mail-Adresse für Rückfragen dazu. Die Meldung geht an alle Admins und steht unter **Admin › Links › Meldungen**. Dort erledigst du sie oder pausierst den Link gleich mit. Von einer Adresse aus gehen höchstens fünf Meldungen in der Stunde, abschalten lässt sich das Melden unter **Admin › Einstellungen › Teilen**.

**Standort in Fotos**: Öffnet oder lädt jemand Fotos über einen Link, entfernt MoeCloud die GPS-Daten, auch in ZIP-Downloads. Das klappt bei JPEG, HEIC und WebP ohne erneutes Speichern des Bildes, Kamera, Aufnahmedatum und Ausrichtung bleiben. Die Originale in deinen Dateien und für Personen, mit denen du teilst, bleiben unverändert.

Unter **Admin › Einstellungen › Teilen** lassen sich Links und Freigaben abschalten, ein Passwort für alle Links verlangen, eine längste Gültigkeit festlegen und das Entfernen der GPS-Daten abschalten. Ein Link ohne Passwort schützt nur durch seine Länge: Gib ihn nur Personen, die den Inhalt sehen sollen, und setz bei Bedarf ein Ablaufdatum.

<p align="center">
  <img src="docs/screenshots/public.png" alt="Ein geteilter Ordner, wie ihn Besucher sehen" width="80%">
</p>

<p align="center">
  <img src="docs/screenshots/link-nachricht.png" alt="Die Seite eines Links im Theme Ozean mit einer Nachricht für Besucher über dem Inhalt" width="80%">
</p>

## Teamordner und Gastkonten

Ein **Teamordner** gehört keiner einzelnen Person. Er hat eigenen Speicher, und was darin liegt, bleibt, auch wenn jemand das Team verlässt oder ein Konto gelöscht wird. Das passt für die Familie, den Verein, eine Abteilung oder ein Projekt mit Leuten von außen.

- **Anlegen**: Admins legen Teamordner unter **Admin › Teamordner** an, mit Name, Speicher, Beschreibung und Farbe. Mit **Unbegrenzt** gibt es keine Grenze. Der Speicher zählt für sich, nicht zum Speicher der Mitglieder.
- **Mitglieder**: Du nimmst Personen und Gruppen auf, jeweils mit einem Recht. **Lesen** heißt ansehen und herunterladen. **Bearbeiten** heißt auch hochladen, ändern, löschen und per Link teilen. Die **Leitung** nimmt zusätzlich Personen auf und holt Gelöschtes aus dem Papierkorb zurück. Gruppen bekommen Lesen oder Bearbeiten, die Leitung geht nur an einzelne Personen. Name und Speicher legen nur Admins fest.
- **Finden**: Mitglieder sehen ihre Teamordner unter **Teamordner** in der Navigation und auf der Startseite. Die Suche findet auch, was in Teamordnern liegt. Im [WebDAV-Laufwerk](#als-laufwerk-einbinden) erscheinen sie als Ordner neben den eigenen, wenn das App-Passwort das vorsieht.
- **Speicher**: Ist ein Teamordner zu 90 % voll, bekommt die Leitung eine Benachrichtigung. Hat er keine Leitung, geht sie an die Admins.
- **Papierkorb**: Jeder Teamordner hat einen eigenen Papierkorb. Was Mitglieder löschen, landet dort, die Leitung und Admins holen es zurück oder löschen es endgültig. Es gilt dieselbe Frist wie für alle Papierkörbe.
- **Links**: Wer bearbeiten darf, legt öffentliche Links an. Sie gehören zum Teamordner und bleiben, wenn die Person das Team verlässt.
- **Verlassen**: Unter **Teamordner** verlässt du einen Teamordner selbst. Wer über eine Gruppe dabei ist, den nimmt die Verwaltung heraus.
- **Löschen**: Admins löschen einen Teamordner samt allen Dateien, Versionen und Links. Zur Bestätigung gibst du seinen Namen ein.

<p align="center">
  <img src="docs/screenshots/teamordner.png" alt="Ein Teamordner mit dem Hinweis auf das eigene Recht" width="49%">
  <img src="docs/screenshots/teamordner-mitglieder.png" alt="Mitglieder eines Teamordners mit ihren Rechten" width="49%">
</p>

Ein **Gastkonto** ist ein Konto ohne eigenen Speicher. Gäste melden sich wie alle anderen an, sehen aber nur, was mit ihnen geteilt ist, und die Teamordner, in denen sie Mitglied sind. Dort arbeiten sie mit dem Recht, das du ihnen gibst. Eigene Dateien, öffentliche Links und die Leitung eines Teamordners gibt es für Gäste nicht.

- **Anlegen**: Unter **Admin › Personen** wählst du beim Anlegen die Rolle **Gast**. Unter **Admin › Einladungen** stellst du für einen Link ein, ob ein volles Konto oder ein Gastkonto entsteht, und nimmst die Person auf Wunsch gleich in einen Teamordner auf.
- **Von außen einladen**: Admins schicken in den Mitgliedern eines Teamordners mit **Jemanden von außen einladen** eine Einladung an eine E-Mail-Adresse, als Gastkonto oder volles Konto. Die Person legt sich über den Link ein Konto an und landet direkt in diesem Teamordner. Dafür muss der [E-Mail-Versand](#e-mail) eingerichtet sein.
- **Umstellen**: Aus einem vollen Konto wird ein Gastkonto, sobald dort keine eigenen Dateien mehr liegen. Der Weg zurück geht jederzeit.
- **Auf Zeit**: Zusammen mit dem Ablaufdatum für Konten unter [Verwaltung](#verwaltung) endet der Zugang von selbst.

## Formulare

Unter **Formulare** in der Navigation legst du Umfragen, Anmeldungen oder Rückmeldungen an, die jeder mit dem Link ausfüllt, auch ohne Konto.

- **Fragen**: kurze und lange Antworten, E-Mail-Adresse, Zahl, Datum, eine Auswahl, mehrere Auswahlen, eine Skala von 0 oder 1 bis höchstens 10 mit Text an beiden Enden und ein Datei-Upload. Jede Frage bekommt auf Wunsch einen Hinweis darunter, wird zur Pflichtfrage, lässt sich kopieren und verschieben. Bei Zahlen legst du den kleinsten und größten Wert fest. Alles speichert sich beim Tippen.
- **Dateien einsammeln**: Eine Frage vom Typ **Datei-Upload** nimmt pro Antwort eine Datei an, bis 10 MB oder bis zu einer Grenze zwischen 1 und 100 MB, auf Wunsch nur bestimmte Typen wie `pdf, jpg, png`. Die Grenze für einzelne Dateien unter **Admin › Einstellungen › Speicher** gilt auch hier. Die Dateien landen in deinen Dateien unter **Formular-Uploads** in einem Ordner mit dem Namen des Formulars, zählen zu deinem Speicher, gehen durch den Virenscan und stehen in der Aktivität. In den einzelnen Antworten führt ein Link direkt zur Datei. Ist dein Speicher voll, nimmt das Formular keine Dateien mehr an. Ein Formular hat höchstens 20 solcher Fragen.
- **Ausfüllen**: Der Link führt auf eine eigene Seite im Aussehen deiner Cloud, mit Titel, Beschreibung und den Fragen. MoeCloud prüft jede Antwort, nennt, was fehlt, und zeigt danach einen Dank, auf Wunsch mit eigenem Text. Ein QR-Code führt zum Formular, und **Neuen Link erzeugen** macht den alten ungültig.
- **Grenzen**: Ein Formular nimmt Antworten an, bis du es schließt, bis zu einem Zeitpunkt oder bis zu einer Zahl von Antworten. **Nur eine Antwort pro Person** gilt pro Browser, bei **Nur für angemeldete Personen** pro Konto. Nur dann lassen sich auch die Namen der Antwortenden speichern, sonst bleiben alle anonym.
- **Auswertung**: Unter **Antworten** steht für jede Frage eine Zusammenfassung, mit Balken bei Auswahlen, dem Durchschnitt bei Skalen und Zahlen und den neuesten Texten. Darunter stehen die einzelnen Antworten zum Durchsehen und Löschen. **Als CSV laden** gibt alle Antworten für Excel und LibreOffice aus.
- **Benachrichtigungen**: Neue Antworten melden sich in der Glocke und je nach deinen Schaltern per E-Mail und Push. Mehrere Antworten kurz hintereinander kommen als eine Nachricht.

Gastkonten legen keine Formulare an, und unter **Admin › Einstellungen › Teilen** schaltest du sie für alle ab. Dann sind auch bestehende Links geschlossen. Der Export unter **Konto** enthält deine Formulare samt Antworten.

<p align="center">
  <img src="docs/screenshots/forms-editor.png" alt="Ein Formular mit drei Fragen im Editor" width="80%">
</p>
<p align="center">
  <img src="docs/screenshots/form-public.png" alt="Das ausgefüllte Formular, wie Besucher es sehen" width="49%">
  <img src="docs/screenshots/forms-results.png" alt="Die Auswertung mit Balken und Durchschnitt" width="49%">
</p>

## Kalender und Aufgaben

Unter **Kalender** und **Aufgaben** in der Navigation planst du Termine und To-dos. Gastkonten und Teamordner haben keinen Kalender.

- **Ansichten**: Tag, drei Tage, Arbeitswoche, Woche, Monat, Jahr und eine fortlaufende Terminliste, dazu Kalenderwochen, Mondphasen, Arbeitszeiten, Dichte und Zeilenhöhe nach Wunsch. Termine ziehst du mit Maus oder Finger auf, verschiebst sie und änderst ihre Länge, mit Rückgängig.
- **Schnelleingabe**: „Kaffee mit Mia morgen 15 Uhr im Café #privat“ oder „Yoga jeden Dienstag 18:30“ wird ein fertiger Termin, auf Deutsch und Englisch.
- **Termine**: Wiederholungen nach RFC 5545 mit Ausnahmen und „dieser und alle folgenden“, ganztägig und über mehrere Tage, Geburtstage mit Alter, Fokuszeiten und Abwesenheiten, Zeitzonen pro Termin, Orte und Videokonferenzen mit einem Klick über Jitsi oder mit eigenen Links zu Zoom, Teams, Meet oder BigBlueButton. Überschneidungen zeigt der Editor sofort.
- **Mehrere Kalender** mit eigenen Farben, Zeitzonen und Standard-Erinnerungen, dazu Feiertage für Deutschland mit allen Bundesländern, Österreich, die Schweiz, das Vereinigte Königreich und die USA.
- **Aufgaben** mit Fälligkeit, Uhrzeit, Priorität, Fortschritt und Schlagwörtern, mit Filter und Sortierung und auf Wunsch zwischen den Terminen. Die Schnelleingabe versteht Datum, Uhrzeit, `#Schlagwort` und `!!!` für hohe Priorität. Als **Board** stehen Aufgaben in den Spalten Offen, In Arbeit und Erledigt, und du ziehst sie mit der Maus von einer in die nächste oder nimmst das Menü an jeder Karte.
- **Aufgaben zuweisen**: In einem Kalender, den du mit anderen teilst, legst du fest, wer sich kümmert. Zur Wahl stehen alle, die den Kalender bearbeiten dürfen. Die Person bekommt eine Benachrichtigung, und der Filter **Mir zugewiesen** zeigt, was bei dir liegt.
- **Erinnerungen** kommen in die Glocke, als Push und per E-Mail, auch für ganztägige Termine. Auf Wunsch schickt MoeCloud täglich oder am ersten Tag der Woche für die ganze Woche eine Übersicht per E-Mail, zu einer Uhrzeit deiner Wahl.
- **Gemeinsam planen**: Kalender teilst du mit anderen Konten, nur mit frei und beschäftigt, mit allen Details oder zum Bearbeiten. Einladungen bekommen Zusagen, Absagen und Vielleicht, Gäste ohne Konto eine E-Mail mit Kalenderdatei und einem Link zum Antworten. **Gemeinsame Zeit finden** zeigt, wann alle frei sind, und schlägt Zeiten vor.
- **Buchungsseiten** wie bei Calendly unter `https://cloud.example.com/b/dein-name`: Verfügbarkeit pro Wochentag, mehrere Dauern, Puffer, Vorlauf, Zeitraum, Höchstzahl pro Tag und eigene Fragen. Angeboten werden nur Zeiten, die in deinen Kalendern frei sind, gebuchte Termine stehen sofort im Kalender, und wer gebucht hat, kann selbst absagen.
- **Terminumfragen** wie bei Doodle unter `…/u/…` mit Ja, Vielleicht und Nein, auch ohne Konto. Den besten Termin trägst du mit einem Klick ein und lädst alle ein.
- **Öffentliche Kalender** als Seite mit allen Details oder nur frei und beschäftigt, zum Einbetten und mit QR-Code, dazu ICS-Feeds zum Abonnieren. Kalender aus dem Netz abonnierst du per iCal- oder webcal-Adresse, und MoeCloud hält sie aktuell.
- **Import und Export**: Termine aus anderen Diensten übernimmst du mit dem Import, siehe [Kalender aus anderen Diensten übernehmen](#kalender-aus-anderen-diensten-übernehmen). Jeder Kalender geht als ICS hinaus, alle zusammen als ZIP und ein Jahr als CSV.
- **Geburtstage** aus deinen [Kontakten](#kontakte) erscheinen von selbst im Kalender, mit Alter. Unter **Weitere** blendest du sie aus. Beim Einladen schlägt MoeCloud neben Konten auch Kontakte mit E-Mail-Adresse vor.
- **Außerdem**: Suche über Titel, Orte, Beschreibungen und Schlagwörter, ein Papierkorb für Termine und ganze Kalender, eine Statistik, wofür deine Zeit draufgeht, und Drucken.

Die Startseite zeigt die nächsten Termine, offene Einladungen und offene Aufgaben. Unter **Konto › E-Mail-Benachrichtigungen** schaltest du Erinnerungen an Termine, Einladungen und Buchungen einzeln. Was im Kalender erlaubt ist, legt die Verwaltung unter **Admin › Kalender** fest, siehe [Verwaltung](#verwaltung). Der Export unter **Konto** enthält deine Kalender als ICS-Dateien.

<p align="center">
  <img src="docs/screenshots/calendar-week.png" alt="Eine Woche im Kalender mit Terminen aus mehreren Kalendern, Fokuszeit und ganztägigen Aufgaben" width="80%">
</p>
<p align="center">
  <img src="docs/screenshots/calendar-board.png" alt="Aufgaben als Board mit den Spalten Offen, In Arbeit und Erledigt und einer zugewiesenen Aufgabe" width="80%">
</p>
<p align="center">
  <img src="docs/screenshots/calendar-booking-page.png" alt="Eine öffentliche Buchungsseite mit freien Zeiten" width="49%">
  <img src="docs/screenshots/calendar-poll.png" alt="Eine Terminumfrage mit drei Vorschlägen, wie Gäste sie sehen" width="49%">
</p>

### Mit Apps abgleichen (CalDAV)

MoeCloud spricht CalDAV unter `https://cloud.example.com/caldav/`. Du meldest dich mit deinem Benutzernamen und einem App-Passwort aus **Konto › WebDAV und App-Passwörter** an, dein normales Passwort gilt dort nicht. Die Adresse steht auch dort und im Kalender unter **Einstellungen › Mit Apps synchronisieren**.

| Gerät oder App  | So geht's                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone und iPad | Einstellungen › Kalender › Accounts › Account hinzufügen › Andere › CalDAV-Account. Als Server reicht `cloud.example.com`                |
| Mac             | Kalender › Einstellungen › Accounts › + › Anderer CalDAV-Account, Typ „Manuell“                                                          |
| Android         | [DAVx⁵](https://www.davx5.com) mit „Anmeldung mit URL und Benutzername“ und der Adresse oben, für Aufgaben dazu jtx Board oder Tasks.org |
| Thunderbird     | Neuer Kalender › Im Netzwerk mit der Adresse oben. Thunderbird findet alle Kalender selbst                                               |
| Outlook         | Mit dem kostenlosen Add-in CalDav Synchronizer                                                                                           |

Geteilte Kalender erscheinen in den Apps mit, abonnierte nur zum Lesen. Ein App-Passwort mit **Nur lesen** zeigt Kalender und Aufgaben, ändert aber nichts. Feiertage gibt es als eigenen Feed zum Abonnieren, etwa `https://cloud.example.com/holidays/de-by.ics` für Bayern.

### Kalender aus anderen Diensten übernehmen

Im Kalender öffnest du den Import über das Plus neben **Meine Kalender** und **Importieren**. Woher die Termine kommen dürfen:

- **Dateien**: ICS aus Google, Apple, Outlook und Thunderbird, auch mehrere auf einmal, ZIP-Archive aus Google Takeout oder dem Export von Apple und CSV aus Google oder Outlook. Eine ICS-Datei, die schon in deinen Dateien liegt, übernimmst du über **In Kalender importieren** in ihrem Menü oder in der Vorschau.
- **Adresse**: die geheime iCal-Adresse aus Google Kalender oder ein veröffentlichter Kalender aus Outlook. MoeCloud kopiert die Termine einmal. Soll der Kalender aktuell bleiben, abonnierst du ihn stattdessen, und aus einem Abo wird mit **In eigenen Kalender umwandeln** jederzeit ein normaler Kalender.
- **CalDAV-Konto**: Nextcloud, iCloud, Fastmail, mailbox.org, Posteo, Radicale und jeder andere Server mit CalDAV. MoeCloud findet alle Kalender des Kontos selbst. Für iCloud brauchst du ein app-spezifisches Passwort von Apple. Die Zugangsdaten nutzt MoeCloud nur für diesen einen Import und speichert sie nicht.

Bevor etwas gespeichert wird, zeigt eine Vorschau jeden gefundenen Kalender mit der Zahl der Termine und Aufgaben und dem Zeitraum. Du wählst, welche du übernimmst, ob sie in einen neuen oder einen vorhandenen Kalender kommen, wie sie heißen und welche Farbe sie bekommen, und was mit Terminen passiert, die es schon gibt: aktualisieren, überspringen oder doppelt anlegen. Ein zweiter Import derselben Datei legt also nichts doppelt an. Große Importe laufen im Hintergrund weiter, auch wenn du die Seite verlässt, und melden sich in der Glocke.

Adressen im eigenen Netz wie `192.168.…` oder `localhost` sind für Importe gesperrt, genau wie für Abos. Die Verwaltung erlaubt sie unter **Admin › Kalender** mit **Auch Adressen im lokalen Netz erlauben** und schaltet dort Importe aus anderen Diensten auch ganz ab.

<p align="center">
  <img src="docs/screenshots/calendar-import.png" alt="Die Vorschau des Imports mit zwei gefundenen Kalendern, Ziel, Name und Farbe" width="80%">
</p>

## Kontakte

Unter **Kontakte** in der Navigation liegen deine Adressbücher. Gastkonten und Teamordner haben keine.

- **Kontakte** mit Vor- und Nachnamen, Anrede, Spitznamen, Firma, Abteilung und Position, beliebig vielen Telefonnummern, E-Mail-Adressen, Anschriften und Webseiten, Geburtstag und Jahrestag, auch ohne Jahr, Notizen und einem Foto, das MoeCloud auf 512 Pixel verkleinert. Firmen und Einrichtungen bekommen einen eigenen Schalter.
- **Ordnen**: mehrere Adressbücher, **Labels** wie Familie oder Verein, **Favoriten** ganz oben, Sortierung nach Vor- oder Nachnamen und eine Suche über Namen, Firmen, Nummern, E-Mail-Adressen und Orte. Mehrere Kontakte markierst du, um ihnen ein Label zu geben, sie zu verschieben, zu exportieren oder zu löschen. Gruppen aus Apple Kontakte erscheinen mit ihren Mitgliedern.
- **Teilen**: Ein Adressbuch teilst du mit anderen Konten zum Ansehen oder Bearbeiten, etwa für die Familie oder das Team. Sie bekommen eine Benachrichtigung und sehen es im Browser und auf ihren Geräten.
- **Geburtstage** zeigt, wer in den nächsten zwölf Monaten Geburtstag hat und wie alt wird. Dieselben Geburtstage stehen im Kalender.
- **Doppelte zusammenführen** findet Kontakte mit gleicher E-Mail-Adresse, Telefonnummer oder gleichem Namen im selben Adressbuch und führt sie zu einem zusammen, ohne etwas zu verlieren. Die übrigen landen im Papierkorb.
- **Import und Export**: vCard-Dateien von iPhone, Android, Outlook und Thunderbird in den Versionen 2.1, 3.0 und 4.0, CSV aus Google Kontakte und Outlook, auf Deutsch und Englisch, und ZIP-Archive aus Google Takeout, mit Vorschau und der Wahl, was mit schon vorhandenen Kontakten passiert. Eine vCard aus deinen Dateien übernimmst du mit **In Kontakte importieren**. Jedes Adressbuch geht als vCard oder als CSV im Format von Google hinaus.
- **Papierkorb**: Gelöschte Kontakte bleiben so lange wie Termine im Papierkorb, die Dauer legt die Verwaltung unter **Admin › Kalender** fest.

Der Export unter **Konto** enthält deine Adressbücher als vCard-Dateien im Ordner `kontakte/`. Die Verwaltung schaltet Kontakte unter **Admin › Kalender** ab, die Daten bleiben dabei erhalten.

<p align="center">
  <img src="docs/screenshots/contacts.png" alt="Die Kontakte mit Adressbüchern, Labels, der Liste und einem geöffneten Kontakt" width="80%">
</p>

### Mit Apps abgleichen (CardDAV)

MoeCloud spricht CardDAV unter `https://cloud.example.com/carddav/`. Wie bei CalDAV meldest du dich mit deinem Benutzernamen und einem App-Passwort an. Die Adresse steht in den Kontakten unter **Auf Geräten nutzen**.

| Gerät oder App  | So geht's                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| iPhone und iPad | Einstellungen › Apps › Kontakte › Accounts › Account hinzufügen › Andere › CardDAV-Account. Als Server reicht `cloud.example.com` |
| Mac             | Kontakte › Einstellungen › Accounts › + › Anderer Kontakte-Account, Typ CardDAV                                                   |
| Android         | [DAVx⁵](https://www.davx5.com) mit der Adresse von MoeCloud. Kalender und Kontakte kommen über ein Konto                          |
| Thunderbird     | Adressbuch › Neues Adressbuch › CardDAV-Adressbuch hinzufügen mit der Adresse oben                                                |

Apps finden die Adresse auch über `/.well-known/carddav` selbst. Änderungen gehen in beide Richtungen, geteilte Adressbücher erscheinen mit, nur zum Lesen geteilte bleiben in den Apps schreibgeschützt. Unbekannte Felder aus den Apps wie soziale Profile oder eigene Beschriftungen bleiben erhalten, auch wenn du den Kontakt im Browser bearbeitest.

## Kommentare, Aktivität und Benachrichtigungen

- **Kommentare**: Im Detailbereich unter **Kommentare** schreiben alle, die Zugriff haben, an Dateien und Ordner. Alle anderen mit Zugriff und alle, die dort schon kommentiert haben, bekommen eine Benachrichtigung. Mit `@benutzername` erwähnst du jemanden, der dort Zugriff hat, beim Tippen von `@` schlägt MoeCloud passende Personen vor. Wer erwähnt wird, bekommt dafür eine eigene Benachrichtigung.
- **Reaktionen**: Unter jedem Kommentar reagierst du mit einem von acht Zeichen, etwa 👍, ❤️ oder ✅, ohne gleich zu antworten. Die Zahl dahinter zeigt, wie viele so reagiert haben, und mit der Maus siehst du, wer. Ein zweiter Klick nimmt deine Reaktion zurück. Reaktionen lösen keine Benachrichtigung aus.
- **Aktivität**: Der Reiter **Aktivität** zeigt für jede Datei und jeden Ordner, wer etwas hochgeladen, bearbeitet, umbenannt, verschoben, kopiert, geteilt, kommentiert oder gelöscht hat. Unter **Zuletzt › Aktivität** steht alles aus deinen Ordnern, nach Tagen sortiert. Mit wem ein Ordner geteilt ist, steht nur in deiner eigenen Aktivität. Andere mit Zugriff sehen das dort nicht, und Links sehen nur Personen, die bearbeiten dürfen.
- **Ordner beobachten**: Über **Beobachten** im Menü eines Ordners oder die Glocke in seiner Kopfzeile bekommst du eine Nachricht, wenn andere darin etwas hochladen, ändern oder löschen, auch in Unterordnern. Mehrere Änderungen kommen nach einer Minute Ruhe gesammelt.
- **Benachrichtigungen**: Die Glocke oben rechts sammelt neue Freigaben, Kommentare, Uploads und Downloads über deine Links, gelöste Sperren, Erwähnungen, Erinnerungen, Links kurz vor dem Ablauf, fertige Importe, Änderungen in beobachteten Ordnern, Anmeldungen von neuen Geräten, Aufgeräumtes und Hinweise zu deinem Speicher, Admins sehen dort auch Meldungen zum System. Unter **Konto › E-Mail-Benachrichtigungen** wählt jede Person, was zusätzlich per E-Mail und Push kommt.
- **Ruhezeiten und Zusammenfassung**: Unter **Konto › E-Mail-Benachrichtigungen** legst du Ruhezeiten fest, etwa von 22 bis 7 Uhr. In dieser Zeit kommen weder E-Mails noch Push, danach fasst MoeCloud zusammen, was sich angesammelt hat und noch ungelesen ist. Neue Anmeldungen, Schadsoftware und Störungen des Systems kommen trotzdem sofort. Unter **E-Mails schicken** wählst du außerdem, ob jede Benachrichtigung einzeln kommt oder gesammelt jeden Morgen oder jeden Montag um 8 Uhr. Die Zeiten gelten in der Zeitzone deines Browsers.
- **Push im Browser**: Unter **Konto › Push › In diesem Browser einschalten** erlaubst du MoeCloud Benachrichtigungen in dem Browser, in dem du gerade bist. Sie erscheinen auch, wenn MoeCloud nicht offen ist, und ein Klick öffnet die passende Stelle. Das geht in Chrome, Edge, Firefox und Safari. Auf iPhone und iPad fügst du MoeCloud erst über **Teilen** zum Home-Bildschirm hinzu und öffnest es von dort. Einen fremden Dienst richtest du dafür nicht ein: MoeCloud erzeugt sein Schlüsselpaar selbst und schickt jede Nachricht verschlüsselt an den Push-Dienst deines Browsers. Die Seite muss über HTTPS laufen. Unter **Browser mit Push** siehst du alle Browser, schickst eine Testnachricht und entfernst einzelne wieder.
- **Push aufs Handy**: Unter **Konto › Push › Über ntfy oder Gotify** trägst du einen Dienst ein. Bei [ntfy](https://ntfy.sh) ist das die Adresse mit Thema, etwa `https://ntfy.sh/mia-moecloud`, auf Wunsch mit Zugangstoken, bei [Gotify](https://gotify.net) die Adresse des Servers und ein App-Token. **Testnachricht schicken** prüft die Verbindung. Push bekommt dieselben Benachrichtigungen wie E-Mail, mit denselben Schaltern, und ein Tipp auf die Nachricht öffnet die passende Stelle in MoeCloud. Der Token steht nur auf dem Server und taucht weder in der Oberfläche noch im Export auf. Adressen im lokalen Netz sind gesperrt, damit niemand über MoeCloud Dienste in deinem Netz erreicht. Läuft ntfy oder Gotify bei dir zu Hause oder im selben Docker-Netz, erlaubt ein Admin das unter **Admin › Einstellungen › Push-Benachrichtigungen**.

<p align="center">
  <img src="docs/screenshots/notifications.png" alt="Benachrichtigungen zu Kommentaren und einer neuen Freigabe" width="80%">
</p>

<p align="center">
  <img src="docs/screenshots/push.png" alt="Ruhezeiten und Push im Browser unter Konto" width="80%">
</p>

## Als App auf dem Handy

MoeCloud lässt sich im Browser als App installieren, auf dem Handy über **Zum Startbildschirm hinzufügen**, am Rechner über das Symbol in der Adresszeile. Dafür muss die Cloud über HTTPS laufen.

- **Untere Leiste**: Auf dem Handy stehen die wichtigsten Bereiche am unteren Rand. Welche das sind, wählst du unter **Konto › Darstellung › Navigation anpassen** mit dem Handy-Symbol, bis zu vier.
- **Kurzbefehle**: Ein langer Druck auf das Symbol der App führt direkt zu Notizen, Fotos, Zuletzt und Favoriten.
- **Teilen in die Cloud**: Ist MoeCloud installiert, erscheint es im Teilen-Menü anderer Apps. Geteilte Dateien landen in deinen Dateien, eine geteilte Adresse wird zum [Weblink](#dateien), geteilter Text zur [Notiz](#notizen). Das unterstützen Chrome und verwandte Browser unter Android, iOS bietet es Web-Apps nicht an.

Geprüft ist das Teilen mit einem nachgestellten Aufruf im Browser. Auf einem echten Handy mit installierter App ist es noch nicht geprüft.

## Als Laufwerk einbinden

MoeCloud spricht WebDAV unter `https://cloud.example.com/dav/`. Die Adresse steht auch unter **Konto › WebDAV und App-Passwörter**. Dort legst du für jedes Gerät ein eigenes App-Passwort an und meldest dich damit und mit deinem Benutzernamen an. Dein normales Passwort funktioniert hier nicht, so kannst du einzelne Geräte später wieder abmelden.

- **Windows**: Im Explorer unter **Dieser PC › Netzlaufwerk verbinden** die Adresse eintragen. Windows verlangt dafür HTTPS.
- **macOS**: Im Finder **Gehe zu › Mit Server verbinden** (⌘K) und die Adresse eintragen.
- **Linux**: Im Dateimanager `davs://cloud.example.com/dav/` öffnen oder mit `davfs2` einhängen.
- **rclone**:

```bash
rclone config create moecloud webdav url=https://cloud.example.com/dav/ vendor=other user=emi pass=APP-PASSWORT --obscure
rclone sync ~/Bilder moecloud:Fotos
rclone mount moecloud: ~/MoeCloud --vfs-cache-mode writes
```

Ein App-Passwort kommt an deine Dateien, aber nicht an das Konto dahinter: E-Mail-Adresse und Passwort ändern, weitere App-Passwörter anlegen, Passkeys, Authenticator-App und Sitzungen verwalten oder das Konto löschen geht nur im Browser. Ein Gerät kann nur sein eigenes App-Passwort widerrufen.

Beim Anlegen eines App-Passworts wählst du, was das Gerät darf:

- **Nur lesen**: Das Gerät sieht und lädt alles, kann aber nichts hochladen, ändern oder löschen, weder über WebDAV noch über die [API](#api). Das passt für einen Bilderrahmen oder eine Sicherung, die nur abholt.
- **Gültig**: ohne Ablauf oder für 7, 30 oder 90 Tage oder ein Jahr. Danach kommt das Gerät nicht mehr hinein. Abgelaufene Passwörter stehen noch 30 Tage in der Liste.
- **Darf die Verwaltung bedienen**: nur für Admins und nur für Skripte, die Personen, Einstellungen oder Sicherungen verwalten. Ohne den Haken beantwortet alles unter `/api/admin/` das App-Passwort mit `403`. Solche App-Passwörter tragen in der Liste den Zusatz **mit Verwaltung**.
- **Im Laufwerk auch Teamordner und Geteiltes zeigen**: Dann erscheinen [Teamordner](#teamordner-und-gastkonten) und alles, was andere mit dir teilen, als Ordner neben deinen eigenen. Heißt eine Freigabe wie einer deiner Ordner, hängt MoeCloud den Namen der Person an, etwa `Belege (Mia)`. Die geteilten Ordner selbst lassen sich über das Laufwerk nicht löschen, umbenennen oder verschieben, ihr Inhalt je nach deinem Recht schon.

Ohne den letzten Haken zeigt das Laufwerk nur deine eigenen Dateien, und das ist mit Absicht die Voreinstellung. Programme, die einen Ordner spiegeln, löschen auf der Gegenseite, was bei ihnen fehlt, und träfen sonst auch die Dateien anderer. Für Gastkonten ist der Haken gesetzt, denn sie haben nichts Eigenes.

Gelöschtes landet auch hier im Papierkorb, und ist der Virenscan an, prüft MoeCloud auch hier jede Datei. Ändert ein Gerät in kurzer Zeit auffällig viele Dateien, hält MoeCloud es an, siehe Schutz vor Erpressungstrojanern unter [Verwaltung](#verwaltung). Bis du es freigibst, kann es nur noch lesen und bekommt beim Schreiben `403`. WebDAV-Sperren bestätigt MoeCloud nur, damit Programme wie Office speichern können, vor gleichzeitigem Bearbeiten schützen sie nicht. Hat jemand eine Datei in MoeCloud gesperrt, lehnt WebDAV Änderungen, Löschen, Verschieben und neue Sperren daran mit `423 Locked` ab.

## Konto und Sicherheit

Dein Konto öffnest du über dein Bild unten links und **Konto und Sicherheit**, auf dem Handy über **Ich**.

<p align="center">
  <img src="docs/screenshots/account.png" alt="Konto im hellen Design" width="80%">
</p>

- **Profil**: Name, E-Mail und Sprache. Für eine neue E-Mail-Adresse fragt MoeCloud nach deinem Passwort, und die alte Adresse bekommt einen Hinweis, denn über die Adresse lässt sich das Passwort zurücksetzen. Den Benutzernamen ändert ein Admin. Ein **Profilbild** lädst du als JPEG, PNG oder WebP hoch, MoeCloud schneidet es quadratisch zu. Es erscheint überall, wo sonst deine Initialen stehen, etwa beim Teilen, in Kommentaren und in der Aktivität. **Nach der Anmeldung zeigen** legt fest, ob du bei deinen Dateien oder auf der Startseite landest.
- **Speicher**: belegter Platz und ein Link zur Speicheransicht.
- **Daten exportieren**: ein ZIP mit allen eigenen Dateien im Ordner `Dateien/` und der Datei `konto.json`. Darin stehen Profil, Einstellungen, Favoriten, Schlagwörter, Alben, Wiedergabelisten, Links ohne ihre Adressen, Freigaben, was andere mit dir teilen, deine Kommentare und Reaktionen, deine Formulare samt Antworten, gespeicherte Suchen und die Namen deiner Passkeys und App-Passwörter. Deine Kalender liegen als ICS-Dateien im Ordner `kalender/`, deine Adressbücher als vCard-Dateien im Ordner `kontakte/`. Der Papierkorb gehört nicht dazu. Jeder Export steht im Sicherheitsprotokoll.
- **Darstellung**: ein [Theme](#themes) aus der Liste oder eine eigene Farbe, das gilt für dein Konto auf allen Geräten. Mit **Navigation anpassen** bringst du die Einträge der Seitenleiste in deine Reihenfolge, blendest aus, was du nicht brauchst, und wählst bis zu vier Einträge für die untere Leiste auf dem Handy. Pro Browser stellst du außerdem die Schriftgröße in vier Stufen, luftige oder kompakte Zeilen, die Größe der Kacheln, einen Farbschimmer im Hintergrund und weniger Bewegung ein. Hell, Dunkel oder wie das System, 3 Stufen Kontrast, runde, weiche oder kantige Ecken und echtes Schwarz für OLED-Bildschirme gelten pro Browser.
- **Funktionen**: Hier blendest du aus, was du nicht brauchst: Fotos, Musik, Notizen, Formulare, Schlagwörter, Kalender, Aufgaben, Buchungsseiten, Umfragen und Kontakte. Sie verschwinden aus der Navigation, der Startseite und dem Schnellzugriff, deine Daten bleiben, und ein Klick holt alles zurück. Dateien, Geteiltes und Teamordner bleiben immer da.
- **E-Mail-Benachrichtigungen**: für Freigaben, Uploads über Links, Kommentare, Erinnerungen, beobachtete Ordner, Einladungen, Buchungen und Umfragen im [Kalender](#kalender-und-aufgaben), Anmeldungen von neuen Geräten und bei Admins für Meldungen zum System. Dieselben Schalter gelten für Push. Dazu Ruhezeiten und die Wahl, ob E-Mails einzeln oder gesammelt kommen.
- **Push**: Benachrichtigungen direkt im Browser oder über ntfy und Gotify, siehe [Kommentare, Aktivität und Benachrichtigungen](#kommentare-aktivität-und-benachrichtigungen).
- **Passwort**: Ändern meldet alle anderen Geräte ab. Wie lang es mindestens sein muss, legt die Verwaltung fest. Ist der E-Mail-Versand eingerichtet, gibt es auf der Anmeldeseite „Passwort vergessen“.
- **Authenticator-App**: Einrichten per QR-Code, dazu 10 Wiederherstellungscodes für den Fall, dass das Handy fehlt.
- **Passkeys**: Anmelden mit Fingerabdruck, Gesicht oder Sicherheitsschlüssel, ganz ohne Passwort. Nach der Anmeldung mit Passwort bestätigt ein Passkey auch den zweiten Schritt.
- **WebDAV und App-Passwörter**: ein Passwort pro Gerät, auf Wunsch nur zum Lesen, mit Ablaufdatum oder mit Teamordnern und Geteiltem im Laufwerk, siehe [Als Laufwerk einbinden](#als-laufwerk-einbinden). Dieselben App-Passwörter gelten für [CalDAV](#mit-apps-abgleichen-caldav), dessen Adresse hier ebenfalls steht. Hat der [Schutz vor Erpressungstrojanern](#verwaltung) ein Gerät angehalten, steht das hier mit Zeitpunkt und Zahl der Änderungen. **Dateien zurücksetzen** öffnet deine Dateien auf dem Stand kurz davor, **Freigeben** lässt das Gerät wieder schreiben.
- **Sitzungen**: alle angemeldeten Browser mit Gerät und letzter Aktivität, einzeln oder alle anderen abmelden.
- **Konto absichern**: für den Fall, dass ein Gerät weg ist oder jemand an dein Konto gekommen sein könnte. Ein Schritt meldet alle anderen Geräte ab, widerruft alle App-Passwörter und pausiert auf Wunsch deine öffentlichen Links. Dafür gibst du dein Passwort ein. Ändere danach das Passwort, falls du es noch nicht getan hast.
- **Hinweise bei Änderungen**: Ein neues Passwort, eine neue E-Mail-Adresse, ein neues App-Passwort, ein Passkey oder eine abgeschaltete Authenticator-App melden sich in der Glocke und per E-Mail, unabhängig von den Schaltern für Benachrichtigungen.
- **Neue Geräte**: Jeder Browser bekommt bei der Anmeldung ein eigenes Cookie, das sich MoeCloud als Prüfsumme merkt. Meldet sich jemand von einem Gerät an, das für dein Konto neu ist, erscheint eine Benachrichtigung mit Browser, System und gekürzter IP-Adresse, auf Wunsch auch per E-Mail. Das allererste Gerät nach dem Einrichten oder einem Update meldet MoeCloud nicht. **Alle anderen abmelden** und ein neues Passwort lassen MoeCloud alle anderen Geräte vergessen, eine erneute Anmeldung von dort meldet es dann wieder. Geräte, die 400 Tage nicht mehr da waren, vergisst MoeCloud von selbst.
- **Sicherheitsprotokoll**: Anmeldungen, fehlgeschlagene Versuche und Änderungen an deinem Zugang.
- **Konto löschen**: Hat die Verwaltung das unter **Admin › Einstellungen › Anmeldung** erlaubt, löschst du hier dein Konto mit allen Dateien, Freigaben, Links und Alben. Zur Bestätigung gibst du deinen Benutzernamen und, falls du eins hast, dein Passwort ein. Die Admins bekommen eine Nachricht, und das Protokoll vermerkt es. Der letzte Admin kann sich nicht selbst löschen.
- **Ablaufdatum**: Hat die Verwaltung deinem Konto ein Ablaufdatum gegeben, steht es oben auf der Seite. Eine Woche vorher kommt eine Benachrichtigung.

<p align="center">
  <img src="docs/screenshots/account-features.png" alt="Funktionen im Konto, Musik und Terminumfragen sind ausgeblendet" width="80%">
</p>

<p align="center">
  <img src="docs/screenshots/darstellung.png" alt="Die Darstellung im Konto mit Schriftgröße, kompakten Zeilen, kleinen Kacheln und Farbschimmer" width="80%">
</p>

<p align="center">
  <img src="docs/screenshots/navigation.png" alt="Der Dialog zum Anpassen der Navigation mit Reihenfolge, Sichtbarkeit und unterer Leiste" width="80%">
</p>

Ist dein Konto mit einem Anbieter für [Single Sign-on](#anmeldung-über-sso) verknüpft, steht das ebenfalls hier. **Trennen** löst die Verknüpfung, sobald du ein Passwort hast.

Admins können unter **Admin › Einstellungen › Anmeldung** die Zwei-Faktor-Anmeldung für Admins oder für alle vorschreiben. Wer dann noch keine Authenticator-App und keinen Passkey hat, kommt nach der Anmeldung nur in die Kontoeinstellungen und richtet dort einen zweiten Faktor ein, erst danach geht es weiter. Bis dahin funktionieren auch App-Passwörter und WebDAV nicht. Den letzten zweiten Faktor lässt MoeCloud nicht entfernen, solange die Pflicht gilt. Hat jemand nur einen Passkey, fragt die Anmeldung mit Passwort danach. Damit du dich nicht selbst aussperrst, lässt sich die Pflicht erst einschalten, wenn dein eigenes Konto einen zweiten Faktor hat.

So geht MoeCloud mit deinen Daten um:

- Passwörter speichert MoeCloud nur als Argon2id-Hash, App-Passwörter und Wiederherstellungscodes nur als HMAC, Links zum Zurücksetzen nur als SHA-256-Hash.
- Fehlversuche bei der Anmeldung sind pro Adresse und pro Konto begrenzt, bei WebDAV auf 20 in 10 Minuten. „Passwort vergessen“ verrät nicht, ob es ein Konto gibt.
- IP-Adressen speichert MoeCloud nur gekürzt, bei IPv4 ohne die letzte Stelle, bei IPv6 nur die ersten 48 Bit.
- Seiten laufen mit einer strengen Content Security Policy und Schutz gegen Anfragen von fremden Seiten. Hochgeladene Dateien liefert MoeCloud so aus, dass sie im Browser keinen Code ausführen können.
- Deine Dateien liegen unverschlüsselt im Datenordner. Wer Zugriff auf den Server oder eine Sicherung hat, kann sie lesen. Eine Ende-zu-Ende-Verschlüsselung gibt es nicht.

## Anmeldung über SSO

Mit OpenID Connect melden sich alle über das Konto eines Anbieters an, etwa Authentik, Keycloak, Authelia, Zitadel, Google oder Microsoft Entra ID. Passwörter und Passkeys funktionieren daneben weiter.

1. Leg beim Anbieter eine Anwendung als vertraulichen Client mit dem Ablauf „Authorization Code“ an und trag als Redirect URI `https://cloud.example.com/login/oidc/callback` ein. Die genaue Adresse steht unter **Admin › Single Sign-on**.
2. Trag dort die Adresse des Anbieters ein, die Issuer-URL, zum Beispiel `https://auth.example.com/application/o/moecloud/` bei Authentik oder `https://auth.example.com/realms/home` bei Keycloak, dazu Client-ID und Client-Secret.
3. Speichere, prüf mit **Verbindung testen** und schalte **Anmeldung über SSO anbieten** ein. Auf der Anmeldeseite erscheint dann ein eigener Knopf, dessen Text du festlegst.

MoeCloud fragt die Scopes `openid email profile` an, mit Gruppe für Admins zusätzlich `groups`, nutzt PKCE, prüft State und Nonce und meldet sich am Token-Endpunkt mit `client_secret_basic` an. Ohne Client-Secret gilt der Client als öffentlich und nutzt nur PKCE. Wer sich zum ersten Mal anmeldet, landet so:

- **Bekannte E-Mail-Adresse**: Bestätigt der Anbieter die Adresse (`email_verified`) und gehört sie zu einem Konto, verknüpft MoeCloud beide. Ungeprüfte Adressen verknüpft es nie.
- **Neue Person**: Mit **Konten automatisch anlegen** bekommt sie ein Konto, der Benutzername kommt aus `preferred_username` oder der E-Mail-Adresse. Ohne den Schalter kommen nur bekannte Konten herein, alle anderen lädst du vorher ein.
- **Admins**: Steht der Name aus **Gruppe für Admins** im Feld `groups`, wird das Konto Admin. Rechte entzieht MoeCloud dabei nie, das geht weiter unter **Admin › Personen**.

<p align="center">
  <img src="docs/screenshots/admin-sso.png" alt="Einstellungen für Single Sign-on in der Verwaltung" width="80%">
</p>

Eine Anmeldung über SSO gilt als vollständig, auch wenn die Verwaltung einen zweiten Faktor verlangt. Den prüft dann der Anbieter. Konten ohne eigenes Passwort, die nur über SSO hereinkommen, brauchen auch für App-Passwörter und WebDAV keinen zweiten Faktor in MoeCloud. Startwerte setzt du auch mit `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_LABEL`, `OIDC_AUTO_CREATE=true` und `OIDC_ADMIN_GROUP`, gespeicherte Werte unter **Admin › Single Sign-on** haben Vorrang.

## Verwaltung

Admins finden unter **Admin** diese Bereiche:

| Bereich            | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Übersicht**      | Personen, Dateien, belegter und freier Speicher, was das Zusammenlegen gleicher Dateien spart, Speicher nach Art, wer am meisten belegt, der **Speicherverlauf** der letzten 365 Tage als Diagramm oder Tabelle und der Zustand von E-Mail, Virenscan, Sicherungen, Verarbeitung und Anmeldungen. **Jetzt aufräumen** leert abgelaufene Papierkörbe, alte Uploads und verwaiste Dateien sofort                                                                                                              |
| **Sicherheit**     | Die Sicherheitsprüfung: HTTPS, zweiter Faktor der Admins, Registrierung, Regeln für Passwörter, App-Passwörter mit Zugriff auf die Verwaltung, Links ohne Passwort und Ablauf, Virenscan, Sicherungen und Updates, Dringendes zuerst. Dazu gesperrte Anmeldungen mit **Freigeben**, der Schutz vor Erpressungstrojanern, die Prüfung der gespeicherten Dateien, die Netze, aus denen die Verwaltung erreichbar ist, und der Kontakt für Sicherheitsmeldungen                                                |
| **Personen**       | Konten anlegen, als Admin, Mitglied oder Gast, auf Wunsch mit Link per E-Mail statt Passwort, oder viele auf einmal aus einer CSV-Datei importieren, Name, E-Mail, Rolle, Speicher und Ablaufdatum ändern, ein neues Passwort setzen oder einen Link zum Zurücksetzen schicken, ein eigenes Passwort bei der nächsten Anmeldung verlangen, sperren, Authenticator-App zurücksetzen, Passkeys entfernen, überall abmelden, löschen. Gilt die Zwei-Faktor-Pflicht, steht bei wem der zweite Faktor noch fehlt |
| **Teamordner**     | Teamordner anlegen, Speicher, Beschreibung und Farbe ändern, Mitglieder und Papierkorb verwalten, löschen, siehe [Teamordner und Gastkonten](#teamordner-und-gastkonten)                                                                                                                                                                                                                                                                                                                                    |
| **Gruppen**        | Gruppen zum Teilen anlegen, umbenennen und löschen, Mitglieder hinzufügen und entfernen. Beim Löschen verlieren die Mitglieder den Zugriff auf alles, was mit der Gruppe geteilt war, die Dateien bleiben                                                                                                                                                                                                                                                                                                   |
| **Einladungen**    | Links, mit denen sich eine Person selbst ein Konto anlegt, auf Wunsch gleich per E-Mail verschickt. Jeder Link funktioniert einmal, gilt 1 bis 90 Tage und kann einen eigenen Speicher mitbringen, auch wenn die Registrierung geschlossen ist. Auf Wunsch entsteht ein Gastkonto, und die Person kommt gleich in einen Teamordner                                                                                                                                                                          |
| **Links**          | Alle öffentlichen Links aller Personen, mit Suche und zum Entfernen, dazu die Meldungen von Besuchern zum Erledigen oder Pausieren                                                                                                                                                                                                                                                                                                                                                                          |
| **Protokoll**      | Anmeldungen, fehlgeschlagene Versuche, Änderungen der Verwaltung und Funde des Virenscans, filterbar nach Bereich und Person und als CSV-Datei zum Herunterladen                                                                                                                                                                                                                                                                                                                                            |
| **Virenscan**      | Verbindung zu ClamAV, Prüfung vorhandener Dateien und gesperrte Dateien, siehe [Virenscan mit ClamAV](#virenscan-mit-clamav)                                                                                                                                                                                                                                                                                                                                                                                |
| **E-Mail**         | SMTP-Server und Test-E-Mail, siehe [E-Mail](#e-mail)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Single Sign-on** | Anbieter für OpenID Connect, Test der Verbindung und Zahl der verknüpften Konten, siehe [Anmeldung über SSO](#anmeldung-über-sso)                                                                                                                                                                                                                                                                                                                                                                           |
| **Kalender**       | Kalender für alle ein- oder ausschalten, CalDAV, öffentliche Kalender, Abos von Kalendern aus dem Netz mit Grenze pro Person und kürzester Abfrage, Importe aus anderen Diensten, private Adressen für Abos und Importe, Buchungsseiten, Terminumfragen, Einladungen an Adressen außerhalb, Frei/beschäftigt-Suche, Papierkorb für Termine und Kontakte, Zeitzone und Feiertage für neue Konten und Kontakte samt CardDAV                                                                                   |
| **Webhooks**       | Meldungen an Discord, Slack, Matrix, Telegram, ntfy und eigene Empfänger, siehe [Webhooks](#webhooks)                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Plugins**        | Erweiterungen einschalten, einstellen und abschalten, mitgelieferte Beispiele hinzufügen, siehe [Plugins](#plugins)                                                                                                                                                                                                                                                                                                                                                                                         |
| **Sicherungen**    | Sicherungen der Datenbank anlegen, herunterladen und löschen, Zeitplan und Stand der Kopie im zweiten Ordner, siehe [Datensicherung](#datensicherung)                                                                                                                                                                                                                                                                                                                                                       |
| **Einstellungen**  | Siehe [Einstellungen und Umgebungsvariablen](#einstellungen-und-umgebungsvariablen), dazu Hinweise für alle und der Wartungsmodus                                                                                                                                                                                                                                                                                                                                                                           |
| **System**         | Version und Update-Befehl, gefundene Programme für Vorschauen, Warteschlange und Suchindex, Metriken, das Serverprotokoll und **Daten an MoeStudio**                                                                                                                                                                                                                                                                                                                                                        |
| **Hilfe**          | Support von MoeStudio mit Tickets und Antworten, Hinweise von MoeStudio zu deiner Version und die Prüfung auf Updates mit dem Changelog der neuen Version                                                                                                                                                                                                                                                                                                                                                   |

Beim Löschen einer Person überträgt MoeCloud ihre Dateien auf Wunsch an eine andere Person, sie landen dort im Ordner „Von …“, und ihre Kalender und Adressbücher gleich mit. Den letzten Admin lässt MoeCloud nicht löschen oder herabstufen.

**Hilfe und Daten an MoeStudio**: Unter **Admin › Hilfe** schreibst du MoeStudio, wenn etwas klemmt. Name und E-Mail-Adresse sind vorausgefüllt, die Antwort erscheint dort und als Zahl an **Hilfe**. Mit **Diagnose mitsenden** gehen Version, System, Speicherplatz und die letzten Fehler bereinigt mit. Darüber stehen Hinweise von MoeStudio, etwa zu einer Sicherheitslücke in deiner Version, und darunter die Prüfung auf Updates. Unter **Admin › System › Daten an MoeStudio** schaltest du **Nutzungsstatistik** und **Fehlerberichte** einzeln ein. Beides ist aus, bis du es einschaltest, und die Vorschau zeigt genau, was gesendet würde: eine zufällige Installations-ID, Version, Installationsart, Laufzeitumgebung, Betriebssystem, Kerne, Arbeitsspeicher, freier Platz, Zeitzone, Sprache, eingeschaltete Funktionen und Anzahlen wie Konten oder Dateien. Fehlerberichte enthalten die Meldung und die Stelle im Programm, Pfade, Adressen, E-Mail-Adressen und Schlüssel entfernt MoeCloud vorher. Inhalte, Namen und IP-Adressen speichert MoeStudio nicht. **Gesendete Daten löschen** schaltet beides ab und lässt MoeStudio alles zu dieser Installation löschen, auch deine Nachrichten an den Support. Mit `MOEPULSE_DISABLED=1` ist MoePulse fest aus, also auch Support und Hinweise, und die [Versionsprüfung](#versionsprüfung) fragt nur noch die Datei ab.

**Bestätigte E-Mail-Adresse und Domains**: Darf sich jeder registrieren, mit oder ohne Freigabe, verlangt **E-Mail-Adresse bestätigen lassen** einen Klick auf einen Link, den MoeCloud an die angegebene Adresse schickt. Erst danach klappt die Anmeldung. Der Link gilt 48 Stunden, wer sich vorher anmelden will, bekommt ihn noch einmal, und unbestätigte Konten verschwinden danach von selbst. Mit **Nur E-Mail-Adressen dieser Domains** nimmt MoeCloud nur Adressen etwa von `firma.de` an und bestätigt sie immer, sonst ließe sich die Regel mit einer erfundenen Adresse umgehen. Beides braucht den [E-Mail-Versand](#e-mail). Einladungen gelten weiter für jede Adresse, und Admins geben ein Konto unter **Admin › Personen** auch ohne Bestätigung frei.

**Registrierung mit Freigabe**: Mit **Jeder darf sich registrieren, du gibst die Konten frei** unter **Admin › Einstellungen › Anmeldung** legt sich jede Person selbst ein Konto an, kommt aber erst hinein, wenn ein Admin es freigegeben hat. Die Admins bekommen eine Benachrichtigung, das Konto steht unter **Admin › Personen** oben und lässt sich dort freigeben oder ablehnen. Nach der Freigabe bekommt die Person eine E-Mail, wenn sie eine Adresse angegeben hat und der [E-Mail-Versand](#e-mail) eingerichtet ist. Einladungen gelten weiter ohne Warten.

**Sicherheitsprüfung**: **Admin › Sicherheit** zeigt, wie es um deine Cloud steht. MoeCloud prüft bei jedem Aufruf, ob die Cloud über HTTPS läuft, ob jeder Admin einen zweiten Faktor hat, wer sich registrieren darf, wie streng die Regeln für Passwörter sind, welche App-Passwörter die Verwaltung bedienen dürfen, ob öffentliche Links ohne Passwort und ohne Ablauf offen stehen, ob Virenscan, Sicherung und Versionsprüfung laufen, wann die gespeicherten Dateien zuletzt geprüft wurden und ob Downloads und Push das eigene Netz erreichen dürfen. Was dringend ist, steht oben, Hinweise darunter, und was in Ordnung ist, am Ende. **Ansehen** führt zur passenden Einstellung.

<p align="center">
  <img src="docs/screenshots/admin-security.png" alt="Die Sicherheitsprüfung in der Verwaltung mit einem dringenden Punkt, mehreren Hinweisen und einer gesperrten Anmeldung" width="80%">
</p>

**Schutz vor Erpressungstrojanern**: Ein Erpressungstrojaner auf einem Rechner verschlüsselt Dateien, und ist dort ein WebDAV-Laufwerk oder ein Abgleich eingerichtet, landen die verschlüsselten Fassungen in der Cloud. Unter **Admin › Sicherheit** stehen drei Schalter dagegen, alle sind von Anfang an an:

- **Bekannte Erpressungstrojaner abweisen**: Dateien mit Endungen bekannter Erpressungstrojaner wie `.locky`, `.wncry`, `.cerber3` oder `.djvus` und typische Erpresserbriefe wie `HOW_TO_DECRYPT.txt` nimmt MoeCloud nicht an, weder beim Hochladen noch beim Umbenennen, über WebDAV oder beim Entpacken. Die Anfrage bekommt `403` mit dem Code `ransomware`.
- **Auffällig viele Änderungen erkennen**: Überschreibt, verschiebt, benennt oder löscht ein Gerät über WebDAV in zehn Minuten mehr vorhandene Dateien als die Grenze, standardmäßig 300, bekommt die Person eine Benachrichtigung, auch per E-Mail und Push, und alle Admins ebenso. Neue Dateien zählen nicht mit, ein großer Upload löst also nichts aus. Die Grenze legst du zwischen 20 und 10.000 fest.
- **Das Gerät dabei anhalten**: Das App-Passwort kann dann nur noch lesen, bis die Person es unter **Konto › WebDAV und App-Passwörter** wieder freigibt. Schreibversuche über WebDAV und die API bekommen `403` mit dem Code `device_paused`. Von dort führt **Dateien zurücksetzen** direkt zu [Auf früheren Stand zurücksetzen](#dateien), mit dem Zeitpunkt kurz vor den Änderungen.

Das Protokoll vermerkt jedes Anhalten und Freigeben, und als [Webhook](#webhooks) gibt es das Ereignis dazu. Die Sicherheitsprüfung erinnert, wenn einer der Schalter aus ist.

<p align="center">
  <img src="docs/screenshots/device-paused.png" alt="Ein angehaltenes App-Passwort im Konto mit Dateien zurücksetzen und Freigeben" width="80%">
</p>

**Dateien prüfen**: Jede Datei liegt mit ihrer Prüfsumme auf der Platte. **Jetzt prüfen** unter **Admin › Sicherheit** liest alle Dateien und vergleicht sie damit. So fällt auf, wenn eine Datei fehlt oder sich ihr Inhalt verändert hat, etwa durch einen defekten Datenträger, lange bevor jemand sie öffnen will. Die Seite nennt dann die betroffenen Dateien und wem sie gehören, auch wenn es nur noch ältere Versionen sind. Zurück kommen sie aus einer Sicherung des Datenordners oder durch erneutes Hochladen. Die Prüfung läuft im Hintergrund, der Betrieb geht weiter, und **Prüfung abbrechen** hält sie an. Mit **Von selbst prüfen** läuft sie jede Woche oder jeden Monat eine Stunde nach der nächtlichen Sicherung. Findet sie dabei etwas, bekommen die Admins eine Benachrichtigung, auf Wunsch per E-Mail und als [Webhook](#webhooks). Die Sicherheitsprüfung erinnert, wenn die letzte Prüfung mehr als 90 Tage her ist. Auf der Kommandozeile macht `check --deep` dasselbe und nennt jede betroffene Datei.

<p align="center">
  <img src="docs/screenshots/admin-integrity.png" alt="Prüfung der gespeicherten Dateien und die Liste der Netze, aus denen die Verwaltung erreichbar ist" width="80%">
</p>

**Verwaltung nur aus bestimmten Netzen**: Trägst du unter **Admin › Sicherheit** Adressen oder Netze ein, eines pro Zeile, etwa `192.168.1.0/24`, `203.0.113.7` oder `2001:db8::/32`, ist die Verwaltung nur noch von dort erreichbar. Von überall sonst bleibt sie zu, für Admins im Browser genauso wie für App-Passwörter mit Zugriff auf die Verwaltung. Alles andere geht weiter von überall. MoeCloud nimmt keine Liste an, in der deine eigene Adresse fehlt, und zeigt dir, unter welcher Adresse es dich gerade sieht. Steht dort die Adresse deines Proxys, sehen alle Besucher gleich aus: Trag den Proxy dann zuerst in `TRUST_PROXY` ein, siehe [Einstellungen und Umgebungsvariablen](#einstellungen-und-umgebungsvariablen). `TRUST_PROXY=true` eignet sich dafür nicht, weil sich die Adresse dann fälschen lässt. Die Sicherheitsprüfung warnt in diesem Fall. Die Liste schützt die Verwaltung vor dem Internet. Geräte, denen MoeCloud die Angaben eines Proxys glaubt, in der Voreinstellung der eigene Rechner und das lokale Netz, können eine andere Adresse angeben. Soll die Liste auch im eigenen Netz gelten, trag in `TRUST_PROXY` nur die Adresse deines Proxys ein. Hast du dich doch ausgesperrt, weil sich deine Adresse geändert hat, hebt `admin-networks clear` auf der Kommandozeile die Beschränkung auf.

**Gesperrte Anmeldungen**: Nach zehn Fehlversuchen sperrt MoeCloud ein Konto für eine Viertelstunde, nach dreißig eine Adresse. Hat sich jemand nur vertippt, steht die Sperre unter **Admin › Sicherheit**, und **Freigeben** hebt sie sofort auf. Adressen stehen dort gekürzt.

**Kontakt für Sicherheitsmeldungen**: Trägst du unter **Admin › Sicherheit** eine E-Mail-Adresse oder eine Seite mit `https://` ein, legt MoeCloud die Datei `/.well-known/security.txt` an. Wer eine Lücke in deiner Cloud findet, weiß dann, wem er schreiben soll. `/.well-known/change-password` führt Passwortmanager zu **Konto › Sicherheit**.

**Gesperrte Konten und ihre Links**: Ein gesperrtes oder abgelaufenes Konto kommt nirgends mehr hinein, weder im Browser noch mit App-Passwörtern oder über WebDAV, und seine öffentlichen Links gelten nicht, bis du es wieder freigibst. Dasselbe gilt für Links, die jemand in einem geteilten Ordner angelegt hat und den Ordner inzwischen nicht mehr bearbeiten darf. Unter **Admin › Links** und in der Freigabe steht dann **Konto gesperrt** oder **Ohne Zugriff, außer Kraft**. Fremde Links kannst du als Admin entfernen, aber nicht ändern.

**Unbenutzte Konten**: Mit **Unbenutzte Konten sperren nach** unter **Admin › Einstellungen › Anmeldung** sperrt MoeCloud Konten, die so viele Tage niemand genutzt hat, zwischen 30 und 3650. Es zählen Anmeldungen, offene Sitzungen und App-Passwörter. Admins sperrt MoeCloud nie von selbst, die Admins bekommen eine Nachricht mit den Namen, und unter **Admin › Personen** hebst du jede Sperre wieder auf. Die Dateien bleiben.

**Ablaufdatum**: Konten von Mitgliedern bekommen auf Wunsch ein Datum, an dessen Ende die Anmeldung nicht mehr klappt, etwa für Gäste, Praktika oder ein Projekt. Eine Woche vorher bekommt die Person eine Benachrichtigung, auf Wunsch auch per E-Mail. Danach gelten Sitzungen, App-Passwörter und WebDAV nicht mehr, die Dateien bleiben. Verschiebst du das Datum oder leerst das Feld, geht alles wieder. In der Liste steht bei solchen Konten „Bis …“ oder „Abgelaufen“. Admins bekommen kein Ablaufdatum.

**Personen importieren**: Unter **Admin › Personen › Importieren** wählst du eine CSV-Datei oder fügst ihren Inhalt ein, getrennt mit Komma oder Semikolon, so wie Excel und LibreOffice sie speichern. Die erste Zeile nennt die Spalten, Pflicht sind `username` und `name`, dazu passen `email`, `role` (`user`, `admin` oder `guest`), `quota` (etwa `10 GB`, leer für den Standard), `password`, `language` (`de` oder `en`) und `expires` (das Ablaufdatum als `2027-03-31` oder `31.03.2027`). Deutsche Spaltennamen wie `Benutzername`, `E-Mail`, `Rolle`, `Speicher`, `Passwort`, `Sprache` und `Ablaufdatum` gehen auch. **Prüfen** zeigt für jede Zeile, ob sie angelegt, übersprungen oder abgelehnt wird und warum, angelegt wird erst danach. Wer kein Passwort hat, bekommt einen Link per E-Mail, um selbst eins festzulegen. Bis zu 500 Personen gehen auf einmal.

```csv
username;name;email;role;quota;expires
lea;Lea Hoffmann;lea@example.com;user;10 GB;2027-03-31
mia;Mia Weber;mia@example.com;admin;;
```

**Eigenes Passwort bei der nächsten Anmeldung**: Gibst du einer Person ihr Passwort selbst, etwa beim Anlegen oder nach einem Anruf, kennt es außer ihr noch jemand. Mit **Bei der nächsten Anmeldung ein eigenes Passwort verlangen** im Dialog einer Person gilt es nur bis zur nächsten Anmeldung: Die Person landet danach auf einer Seite, auf der sie das bisherige und ein neues Passwort eingibt, und kommt vorher an nichts anderes. Das neue Passwort muss sich vom alten unterscheiden. Für neue Konten mit Passwort ist der Schalter vorgewählt, beim Import aus CSV gilt er auf Wunsch für alle Passwörter aus der Datei, und in der Liste steht bei solchen Konten **Neues Passwort fällig**. Ein Link zum Zurücksetzen per E-Mail erledigt den Wechsel ebenfalls. App-Passwörter arbeiten in der Zwischenzeit weiter.

<p align="center">
  <img src="docs/screenshots/password-change.png" alt="Seite, auf der eine Person nach der Anmeldung ein eigenes Passwort festlegt" width="60%">
</p>

**Sitzungen**: Unter **Admin › Einstellungen › Anmeldung** legst du fest, wie lange eine Anmeldung im Browser hält. **Abmelden ohne Nutzung nach** meldet ab, wer so viele Tage nicht da war, zwischen 1 und 365. **Spätestens neu anmelden nach** verlangt nach so vielen Tagen eine neue Anmeldung, auch bei täglicher Nutzung. Mit 0 entfällt diese Grenze, dann bleibt angemeldet, wer MoeCloud regelmäßig öffnet. Beide stehen auf 30 Tagen. Kürzere Werte gelten sofort auch für laufende Sitzungen. App-Passwörter haben ihr eigenes Ablaufdatum.

**Passwort-Richtlinie**: Unter **Admin › Einstellungen › Anmeldung** legst du die Mindestlänge für neue und geänderte Passwörter fest, zwischen 10 und 64 Zeichen. Mit **Passwörter aus Datenlecks ablehnen** fragt MoeCloud bei [Have I Been Pwned](https://haveibeenpwned.com/Passwords) nach, ob ein neues Passwort schon in einem Datenleck stand. Übertragen werden nur die ersten fünf Zeichen eines SHA-1-Hashwerts, nie das Passwort. Ist der Dienst nicht erreichbar, nimmt MoeCloud das Passwort an. Mit `BREACH_CHECK_URL` zeigst du auf eine eigene Quelle im selben Format.

**Nutzungsbedingungen**: Unter **Admin › Einstellungen › Rechtliches** trägst du neben Impressum und Datenschutz auch Nutzungsbedingungen ein, als Text oder als Adresse einer fremden Seite. Mit **Zustimmung zu den Nutzungsbedingungen verlangen** sieht jede Person den Text nach der Anmeldung und stimmt einmal zu, bevor es weitergeht. Das gilt auch für neue Konten und für die Anmeldung über SSO. Bis dahin antwortet die API im Browser mit `403` und dem Code `terms_required`. App-Passwörter und WebDAV laufen weiter, damit Geräte nicht mitten im Abgleich stehen bleiben. Die Zustimmung steht im Sicherheitsprotokoll der Person, und die Einstellungen zeigen, wie viele schon zugestimmt haben. Hat sich der Text geändert, holt **Alle neu zustimmen lassen** die Zustimmung noch einmal ein. Die Zustimmung geht nur mit Text, nicht mit einer fremden Adresse.

<p align="center">
  <img src="docs/screenshots/terms.png" alt="Nutzungsbedingungen mit der Bitte um Zustimmung nach der Anmeldung" width="80%">
</p>

**Startdateien**: Neue Konten müssen nicht leer starten. Öffne als Admin in deinen Dateien das Menü eines Ordners und wähl **Als Startdateien für neue Konten**. Jedes neue Konto bekommt dann eine Kopie von allem, was darin liegt, etwa eine Anleitung, Vorlagen oder die Hausordnung, bis zu 500 Dateien und Ordner. Gleiche Dateien liegen dabei nur einmal auf der Platte. Die Kopien zählen zum Speicher des neuen Kontos. Passen sie nicht hinein, startet das Konto leer, und das Serverprotokoll vermerkt es. Gastkonten bekommen keine Startdateien, bestehende Konten ändern sich nicht. Unter **Admin › Einstellungen › Anmeldung** steht, welcher Ordner gerade gilt.

**Gesperrte Dateiendungen**: Unter **Admin › Einstellungen › Speicher** trägst du Endungen ein, die auf dem Server nicht landen sollen, etwa `exe, bat, scr`. Solche Dateien lassen sich weder hochladen noch so umbenennen, auch nicht über WebDAV, über Links zum Hochladen oder beim Anlegen neuer Textdateien. Beim Entpacken von Archiven überspringt MoeCloud sie. Was schon da ist, bleibt. Es zählt die letzte Endung des Namens, `Rechnung.pdf.exe` ist also gesperrt, `Setup.exe.txt` nicht.

**Serverprotokoll**: Unter **Admin › System** stehen die letzten 400 Meldungen des Servers seit dem Start, gefiltert nach Fehlern, Warnungen oder allem, zum Kopieren für eine Fehlermeldung. Sie liegen nur im Arbeitsspeicher. Das vollständige Protokoll schreibt MoeCloud weiter in die Ausgabe des Dienstes, die du mit `sudo moecloud logs` oder `docker compose logs` liest.

**Wochenbericht**: Mit dem Schalter unter **Admin › Einstellungen › Wochenbericht** bekommen alle Admins mit E-Mail-Adresse jeden Montag um 8 Uhr nach der Zeit des Servers eine Übersicht: belegter Speicher und Zuwachs der letzten sieben Tage, aktive Konten, erfolgreiche und fehlgeschlagene Anmeldungen, neue Links, offene Meldungen, Funde des Virenscans, die letzte Sicherung und neue Versionen. **Jetzt an mich schicken** schickt den Bericht sofort.

Der **Speicherverlauf** in der Übersicht merkt sich jeden Tag, wie viel belegt ist, wie viel davon auf der Platte liegt und wie viele Dateien es sind. Mit der Maus oder den Pfeiltasten siehst du die Werte eines Tages, **Als Tabelle** zeigt alle Tage untereinander. Die Werte bleiben drei Jahre.

<p align="center">
  <img src="docs/screenshots/admin-usage.png" alt="Speicherverlauf der letzten Wochen mit dem Wert eines Tages" width="80%">
</p>

**Hinweise für alle** erscheinen oben auf jeder Seite, als Information oder Warnung und auf Wunsch bis zu einem Datum. Jede Person kann sie ausblenden. **Im Wartungsmodus** kommen nur Admins hinein, alle anderen sehen eine Wartungsseite mit deiner Nachricht, und Links und WebDAV sind gesperrt.

<p align="center">
  <img src="docs/screenshots/admin.png" alt="Übersicht in der Verwaltung" width="80%">
</p>

## Virenscan mit ClamAV

Mit [ClamAV](https://www.clamav.net) prüft MoeCloud jede Datei, bevor sie gespeichert wird: Uploads aus dem Browser, über Links zum Hochladen, per WebDAV und über die API, auch neue Fassungen einer Datei. Findet ClamAV Schadsoftware, wird die Datei verworfen und die Anfrage bekommt den Status 422 mit dem Namen des Funds. Das [Protokoll](#verwaltung) vermerkt den Fund, Admins bekommen eine Benachrichtigung.

MoeCloud spricht mit einem laufenden ClamAV-Dienst (`clamd`) über TCP oder einen Unix-Socket. Mit Docker startet die Ergänzung `docker/clamav.yml` ihn als eigenen Container, siehe [ClamAV dazunehmen](#clamav-dazunehmen). Ohne Docker installierst du ClamAV über die Paketverwaltung, unter Debian und Ubuntu etwa mit `apt install clamav-daemon`, und trägst den Socket `/run/clamav/clamd.ctl` ein.

<p align="center">
  <img src="docs/screenshots/admin-scan.png" alt="Einstellungen für den Virenscan" width="80%">
</p>

Unter **Admin › Virenscan** trägst du Server und Port ein (im Docker-Stack `clamav` und `3310`, mit `CLAMAV_HOST` schon vorbelegt) oder den Socket und prüfst die Verbindung mit „Verbindung testen“. Dabei geht die harmlose EICAR-Testdatei an ClamAV, die es erkennen muss. Außerdem legst du fest:

- **Größte geprüfte Datei**: Größere Dateien nimmt MoeCloud ungeprüft an (Standard 100 MB, auf Wunsch ohne Grenze). Soll ClamAV mehr prüfen, erhöhst du auch `StreamMaxLength` in der `clamd.conf`.
- **Wenn ClamAV nicht antwortet**: die Datei trotzdem annehmen (Standard) oder den Upload abweisen. Abweisen ist sicherer, blockiert aber alle Uploads, solange ClamAV ausfällt.
- **Vorhandene Dateien erneut prüfen**: nie automatisch (Standard), täglich oder alle 7, 14, 30 oder 90 Tage. Mit neuen Signaturen findet ClamAV manchmal, was vorher durchgerutscht ist.

Findet eine spätere Prüfung etwas, sperrt MoeCloud die Datei bei allen, die sie haben: Öffnen, Herunterladen, Teilen und WebDAV gehen nicht mehr, im Ordner steht sie mit dem Hinweis „Schadsoftware“. Unter **Gesperrte Dateien** entscheidest du, ob sie endgültig gelöscht oder bei einem Fehlalarm wieder freigegeben wird. „Ungeprüfte prüfen“ und „Alles neu prüfen“ starten eine Prüfung von Hand, auf der Kommandozeile geht das mit `scan`.

## E-Mail

Unter **Admin › E-Mail** richtest du den Versand über einen SMTP-Server ein: Server, Port, Verschlüsselung (STARTTLS, TLS oder keine), Benutzername, Passwort, Absenderadresse und Absendername. „Test senden“ schickt eine Test-E-Mail. Startwerte kannst du auch über die Variablen `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`starttls`, `tls` oder `none`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` und `SMTP_FROM_NAME` setzen. Sind `SMTP_HOST` und `SMTP_FROM` gesetzt, ist der Versand gleich eingeschaltet. Was du im Browser speicherst, hat Vorrang.

Darüber verschickt MoeCloud:

- **Passwort vergessen**: einen Link, der eine Stunde gilt und einmal funktioniert. Admins schicken ihn unter **Admin › Personen** auch selbst, etwa für neue Konten, dann gilt er 24 Stunden.
- **Einladungen**: Mit einer E-Mail-Adresse geht der Einladungslink gleich an die Person.
- **Öffentliche Links**: Aus dem Dialog zum Teilen geht ein Link direkt an eine E-Mail-Adresse, pro Konto höchstens 30 in einer Stunde.
- **Benachrichtigungen**: Freigaben, Uploads über Links und Kommentare, so wie jede Person es unter **Konto** eingestellt hat. Admins bekommen auf Wunsch Meldungen zu neuen Konten, Schadsoftware, Störungen des Virenscans, fehlgeschlagenen Sicherungen, knappem Speicherplatz, vielen fehlgeschlagenen Anmeldungen und neuen Versionen.
- **Zusammenfassungen**: Wer unter **Konto** Ruhezeiten oder gesammelte E-Mails gewählt hat, bekommt statt einzelner Nachrichten eine E-Mail mit allem Ungelesenen.
- **Wochenbericht**: Auf Wunsch jeden Montag an alle Admins, siehe [Verwaltung](#verwaltung).

## Webhooks

Unter **Admin › Webhooks** schickt MoeCloud wichtige Ereignisse an andere Dienste: **Discord**, **Slack**, **Matrix**, **Telegram**, **ntfy** und eigene Empfänger per JSON. Für jedes Ziel wählst du die Ereignisse:

| Ereignis                            | Wann                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Neue Konten                         | Jemand hat sich registriert                                                                                                                 |
| Schadsoftware gefunden              | Der Virenscan hat eine Datei abgewiesen oder gesperrt                                                                                       |
| Virenscan gestört                   | ClamAV antwortet nicht                                                                                                                      |
| Sicherung fehlgeschlagen            | Die nächtliche Sicherung hat nicht geklappt                                                                                                 |
| Wenig Speicherplatz                 | Auf der Platte wird der Platz knapp                                                                                                         |
| Dateien fehlen oder sind beschädigt | Die Prüfung der gespeicherten Dateien, die von selbst läuft, hat etwas gefunden, siehe [Verwaltung](#verwaltung)                            |
| Auffällig viele Änderungen          | Ein Gerät hat über WebDAV in kurzer Zeit sehr viele Dateien geändert, siehe Schutz vor Erpressungstrojanern unter [Verwaltung](#verwaltung) |
| Neue Version                        | Die [Versionsprüfung](#versionsprüfung) hat etwas gefunden                                                                                  |
| Viele fehlgeschlagene Anmeldungen   | Mindestens 25 Fehlversuche in 15 Minuten                                                                                                    |
| Plugin angehalten                   | Ein freigegebenes [Plugin](#plugins) steht still, weil sich seine Dateien geändert haben, sein Ordner fehlt oder der Start misslingt        |

Eigene Empfänger bekommen ein JSON mit `event`, `level` (`info` oder `error`), `title`, `text`, `site` und `at`. Mit einem Geheimnis trägt jede Anfrage den Header `X-MoeCloud-Signature` mit `sha256=` und einer HMAC-SHA256-Signatur des Inhalts. „Testnachricht senden“ prüft ein Ziel, die Liste zeigt, wann zuletzt etwas zugestellt wurde oder warum es nicht geklappt hat.

## Themes

Ein Theme legt fest, wie MoeCloud aussieht: die **Grundfarbe**, aus der alle Farben der Oberfläche entstehen, den **Stil**, auf Wunsch eine **zweite und dritte Farbe**, die **Schrift** und die **Ecken**.

<p align="center">
  <img src="docs/screenshots/themes.png" alt="Themes in der Verwaltung" width="80%">
</p>

- **Zwanzig Themes** sind dabei, von Moe über Ozean, Wald und Kirschblüte bis Graphit und Terminal. Neu dazugekommen sind Nordlicht, Mitternacht, Lagune, Zitrone, Sand, Rosenholz, Espresso und Klarblick, ein Theme mit einer besonders gut lesbaren Schrift.
- **Für alle**: Unter **Admin › Einstellungen › Aussehen** wählst du das Theme, das alle sehen, auch auf der Anmeldeseite und in geteilten Links.
- **Eigene Themes**: **Neues Theme** öffnet den Editor. Jede Änderung siehst du sofort in der ganzen Oberfläche, gespeichert wird erst mit dem Knopf. Sieben Stile stehen zur Wahl, von **Aus der Grundfarbe** über **Ruhig**, **Lebhaft** und **Farbtreu** bis **Schwarzweiß**, dazu sieben Schriften und drei Arten von Ecken. Bei den Schriften stehen neben Rund, System, Serifen und Mono die klare **Geist**, die gut lesbare **Atkinson Hyperlegible** und die elegante **Fraunces** zur Wahl. Alle liegen in MoeCloud selbst, es wird nichts aus dem Netz nachgeladen.
- **Eigenes CSS** für Feinheiten, die das Theme nicht abdeckt, höchstens 20.000 Zeichen. `@import`, Adressen im Internet und alles, was Skripte ausführen könnte, lehnt MoeCloud ab.
- **Weitergeben**: Ein eigenes Theme lädst du als Datei herunter und auf einem anderen Server über **Theme aus Datei laden** wieder hoch.
- **Pro Person**: Erlaubt es die Verwaltung, wählt jede Person unter **Konto › Darstellung** ein Theme aus der Liste oder stellt sich eine eigene Farbe zusammen. Das gilt für ihr Konto auf allen Geräten.
- **Aus Plugins**: Themes eingeschalteter [Plugins](#plugins) stehen im selben Bereich als Vorlage bereit.

<p align="center">
  <img src="docs/screenshots/theme-editor.png" alt="Der Editor für ein eigenes Theme" width="80%">
</p>

Wer bisher eine eigene Grundfarbe eingestellt hatte, behält sie nach dem Update.

### Logo und Anmeldeseite

Unter **Admin › Einstellungen › Logo und Anmeldeseite** bekommt deine Cloud ein eigenes Gesicht, noch bevor sich jemand anmeldet:

- **Logo**: ein Bild als PNG, JPEG oder WebP bis 6 MB, am besten quadratisch und mit durchsichtigem Hintergrund. Es steht auf der Anmeldeseite und oben in der Seitenleiste. MoeCloud rechnet es auf höchstens 512 Pixel herunter. SVG nimmt MoeCloud hier nicht an, weil darin Skripte stecken können.
- **Hintergrundbild**: liegt hinter der Anmeldung und allen Seiten ohne Konto, etwa „Passwort vergessen“ oder der Abfrage des Passworts für einen Link.
- **Überschrift und Begrüßung** ersetzen „Anmelden“ und den Satz darunter. HTML darin zeigt MoeCloud als Text an.
- **Platz der Anmeldung**: links, in der Mitte oder rechts, damit vom Bild etwas zu sehen bleibt.

Die Bilder liegen im Datenordner unter `site/`. Symbole im Browser-Tab und auf dem Startbildschirm bleiben die von MoeCloud.

<p align="center">
  <img src="docs/screenshots/anmeldung-gestaltet.png" alt="Die Anmeldeseite mit eigenem Logo, Hintergrundbild und Begrüßung, die Anmeldung steht rechts" width="80%">
</p>

## Plugins

Plugins erweitern MoeCloud, ohne den Code von MoeCloud anzufassen. Ein Plugin ist ein Ordner mit einer `plugin.json` und etwas JavaScript und kann

- **Aktionen** ins Dateimenü hängen,
- **eigene Seiten** in die Navigation setzen, die das gewählte Theme übernehmen,
- **Uploads prüfen** und ablehnen,
- auf **Ereignisse** reagieren, etwa wenn jemand etwas hochlädt, teilt oder löscht,
- **eigene Adressen** beantworten, auch für Webhooks von außen,
- regelmäßig **Aufgaben** erledigen und **Benachrichtigungen** schicken,
- **Themes** mitbringen.

<p align="center">
  <img src="docs/screenshots/plugins.png" alt="Plugins in der Verwaltung" width="80%">
</p>

Unter **Admin › Plugins** siehst du, was im Ordner liegt, trägst Einstellungen ein und schaltest Plugins ein und aus. Sechs Beispiele sind dabei und lassen sich dort mit einem Klick hinzufügen:

| Beispiel          | Was es tut                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| **Statistik**     | Zählt mit, was du in deiner Cloud tust, und zeigt es auf einer eigenen Seite                                    |
| **Upload-Regeln** | Lehnt Uploads nach Dateiendung oder Größe ab, auf Wunsch nur bei Uploads über Links                             |
| **Inhaltsliste**  | Schreibt per Rechtsklick eine Übersicht aller Dateien eines Ordners als Markdown-Datei hinein                   |
| **Datei-Webhook** | Meldet Uploads, Freigaben und Gelöschtes signiert als JSON an eine Adresse deiner Wahl                          |
| **Briefkasten**   | Nimmt Dateien über eine geheime Adresse entgegen, etwa von Skripten oder Scannern, und legt sie in einen Ordner |
| **Farbpaket**     | Vier zusätzliche Themes, ganz ohne Code                                                                         |

Der Briefkasten nimmt Dateien bis 5 MB zum Beispiel so an:

```bash
curl -T scan.pdf https://cloud.example.com/ext/briefkasten/<geheimer-teil>/scan.pdf
```

<p align="center">
  <img src="docs/screenshots/plugin-page.png" alt="Die Seite des Plugins Statistik" width="80%">
</p>

**Vertrauen**: Ein Plugin läuft auf dem Server mit allen Rechten von MoeCloud. Deshalb startet es erst, nachdem ein Admin es freigegeben hat, und MoeCloud merkt sich dabei eine Prüfsumme über alle seine Dateien. Ändert sich eine davon, hält MoeCloud das Plugin innerhalb einer Minute an, bis du es neu freigibst, und sagt allen Admins Bescheid, auf Wunsch auch über einen [Webhook](#webhooks). Seiten von Plugins laufen im Browser abgeschottet und erreichen nur die Routen ihres eigenen Plugins.

<p align="center">
  <img src="docs/screenshots/plugin-trust.png" alt="Rückfrage vor dem Einschalten eines Plugins" width="80%">
</p>

**Einspielen**: Leg den Ordner eines Plugins nach `data/plugins/` und lies in der Verwaltung neu ein, oder nimm ein ZIP-Archiv:

```bash
sudo moecloud plugins install statistik-1.0.0.zip
sudo moecloud plugins enable statistik
```

Im Browser lassen sich Plugins nur hochladen, wenn der Server mit `PLUGIN_UPLOAD=on` läuft, mit Docker als Zeile in der `.env`. So braucht es ohne dein Zutun Zugriff auf den Server, um Code einzuspielen. Mit `PLUGINS=off` sind Plugins ganz abgeschaltet.

**Selbst schreiben**: Wie ein Plugin aufgebaut ist und was es darf, steht in der [Anleitung für Plugins](docs/plugins.md). Die Beispiele liegen unter [`examples/plugins`](examples/plugins).

## Einstellungen und Umgebungsvariablen

Alle Einstellungen stehen in der Datenbank und werden unter **Admin › Einstellungen** geändert. Sie gelten sofort.

| Bereich                  | Einstellungen                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allgemein                | Name der Cloud, Adresse, Standardsprache                                                                                                                                                                                                                                                                                                |
| Hinweis für alle         | Text, Art und wie lange er erscheint                                                                                                                                                                                                                                                                                                    |
| Wartungsmodus            | An oder aus, dazu die Nachricht auf der Wartungsseite                                                                                                                                                                                                                                                                                   |
| Aussehen                 | [Theme](#themes) für alle, eigene Themes anlegen, laden und weitergeben, eigenes Theme pro Person erlauben                                                                                                                                                                                                                              |
| Anmeldung                | Wer sich registrieren darf (nur Admins, mit Einladungslink, alle, alle mit Freigabe durch die Verwaltung), Passkeys, eigenes Konto löschen, Zwei-Faktor-Pflicht, Mindestlänge für Passwörter, Passwörter aus Datenlecks ablehnen, Dauer der Anmeldung, unbenutzte Konten sperren, Startdateien und sichtbare Funktionen für neue Konten |
| Speicher                 | Speicher pro Person, größte Datei, Frist für den Papierkorb, Versionen pro Datei, gesperrte Dateiendungen, Suche im Inhalt                                                                                                                                                                                                              |
| Teilen                   | Öffentliche Links, Passwort für Links, [Formulare](#formulare), längste Gültigkeit, Standort aus Fotos in Links entfernen, Teilen mit Personen, Personen finden, eigene Adressen für Links, Melden durch Besucher                                                                                                                       |
| Office                   | Adresse von Collabora Online und, falls nötig, die Adresse von MoeCloud für Collabora, siehe [Office-Bearbeitung dazunehmen](#office-bearbeitung-dazunehmen)                                                                                                                                                                            |
| Push-Benachrichtigungen  | Push im Browser und über ntfy oder Gotify, Dienste im lokalen Netz erlauben                                                                                                                                                                                                                                                             |
| Wochenbericht            | Übersicht per E-Mail an alle Admins, jeden Montag oder sofort an dich                                                                                                                                                                                                                                                                   |
| Aufbewahrung und Updates | Wie lange Protokoll und Aktivität bleiben, Versionsprüfung                                                                                                                                                                                                                                                                              |
| Rechtliches              | Impressum, Datenschutz und Nutzungsbedingungen, als Adresse einer anderen Seite oder als Text, dazu die Pflicht zur Zustimmung                                                                                                                                                                                                          |

Umgebungsvariablen brauchst du nur für den Betrieb. Mit Docker trägst du sie in eine `.env` neben der `docker-compose.yml` ein, die [`.env.example`](.env.example) erklärt jede einzelne. Änderungen gelten nach `docker compose up -d`, mit dem Installationsskript nach `sudo moecloud start`, ein `restart` allein übernimmt sie nicht. Ohne Docker setzt du die Variablen beim Start:

| Variable                                                                                                    | Standard                                      | Bedeutung                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                                                                      | `3000`                                        | Port, auf dem MoeCloud lauscht                                                                                                                                                                                                                                                                   |
| `HOST`                                                                                                      | `0.0.0.0`                                     | Adresse, auf der MoeCloud lauscht                                                                                                                                                                                                                                                                |
| `DATA_DIR`                                                                                                  | `data/` im Projekt, im Container `/data`      | Ordner für Datenbank und Dateien                                                                                                                                                                                                                                                                 |
| `PROCESSING_WORKERS`                                                                                        | Kerne minus eins, höchstens 4                 | Wie viele Dateien gleichzeitig Vorschaubilder, Bildinfos und Suchtext bekommen                                                                                                                                                                                                                   |
| `BACKUP_COPY_DIR`                                                                                           |                                               | Zweiter Ordner, in den jede Sicherung zusätzlich kopiert wird, siehe [Datensicherung](#datensicherung)                                                                                                                                                                                           |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_LABEL`, `OIDC_AUTO_CREATE`, `OIDC_ADMIN_GROUP` |                                               | Startwerte für die [Anmeldung über SSO](#anmeldung-über-sso)                                                                                                                                                                                                                                     |
| `DATABASE_URL` / `DATABASE_URL_FILE`                                                                        | `data/moecloud.db`                            | SQLite-Datei oder Adresse einer PostgreSQL-Datenbank, siehe [Datenbank](#datenbank)                                                                                                                                                                                                              |
| `POSTGRES_PASSWORD`                                                                                         |                                               | Nur Docker mit `docker/postgres.yml`: Passwort für PostgreSQL, das Installationsskript erzeugt es                                                                                                                                                                                                |
| `PUBLIC_URL`                                                                                                |                                               | Vorgabe für die Adresse im Einrichtungslink und im Assistenten, solange MoeCloud noch nicht eingerichtet ist                                                                                                                                                                                     |
| `TRUST_PROXY`                                                                                               | `loopback,linklocal,uniquelocal`              | Welchen Proxys MoeCloud `X-Forwarded-*` glaubt: `true` für alle, `false` für keinen, sonst Adressen oder Netze durch Kommas getrennt                                                                                                                                                             |
| `LOG_LEVEL`                                                                                                 | `info`                                        | `debug`, `info`, `warn` oder `error`                                                                                                                                                                                                                                                             |
| `LOG_FORMAT`                                                                                                | `pretty`                                      | `pretty` für die Konsole, `json` für Loki, Graylog und Co.                                                                                                                                                                                                                                       |
| `TZ`                                                                                                        | Systemzeit, mit Docker `Europe/Berlin`        | Zeitzone für Log und nächtliche Sicherung, dazu Vorgabe für die Zeitzone neuer Konten im Kalender. Ohne Region wie `UTC` nimmt der Kalender `Europe/Berlin`                                                                                                                                      |
| `CLAMAV_HOST` / `CLAMAV_PORT` / `CLAMAV_SOCKET`                                                             | Port `3310`                                   | Vorgabe für die Verbindung zu ClamAV. Ist `CLAMAV_HOST` oder `CLAMAV_SOCKET` gesetzt, ist der Virenscan von Anfang an eingeschaltet                                                                                                                                                              |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME`      | Port `587` mit `starttls`                     | Vorgaben für den E-Mail-Versand, siehe [E-Mail](#e-mail)                                                                                                                                                                                                                                         |
| `METRICS_TOKEN`                                                                                             |                                               | Token für `/metrics`, siehe [Metriken für Prometheus](#metriken-für-prometheus)                                                                                                                                                                                                                  |
| `UPDATE_CHECK_URL`                                                                                          | `https://moecloud.moestudio.net/version.json` | Adresse für die [Versionsprüfung](#versionsprüfung). Ohne Angabe fragt MoeCloud zuerst MoeStudio und nimmt diese Datei als Ersatz, mit einer eigenen Adresse nur dort, mit `off` ist die Prüfung fest aus                                                                                        |
| `MOEPULSE_DISABLED`                                                                                         |                                               | `1` schaltet MoePulse fest ab: keine Nutzungsstatistik, keine Fehlerberichte, kein Support und keine Hinweise. Die Versionsprüfung fragt dann nur die Datei aus `UPDATE_CHECK_URL`, siehe [Verwaltung](#verwaltung)                                                                              |
| `MOEPULSE_ENDPOINT`                                                                                         | `https://pulse.moestudio.net`                 | Adresse von MoePulse bei MoeStudio, nur mit `https://`. `off` wirkt wie `MOEPULSE_DISABLED=1`                                                                                                                                                                                                    |
| `BREACH_CHECK_URL`                                                                                          | `https://api.pwnedpasswords.com/range`        | Quelle für die Prüfung neuer Passwörter auf Datenlecks, mit `off` fest aus                                                                                                                                                                                                                       |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `PDFTOPPM_PATH`, `PDFTOTEXT_PATH`                                            | Suche im `PATH`                               | Pfade zu den Programmen für Vorschauen                                                                                                                                                                                                                                                           |
| `SOFFICE_PATH`                                                                                              | Suche im `PATH`                               | Pfad zu LibreOffice für die Office-Vorschau                                                                                                                                                                                                                                                      |
| `PLUGINS`                                                                                                   | an                                            | `off` schaltet [Plugins](#plugins) ganz ab                                                                                                                                                                                                                                                       |
| `PLUGINS_DIR`                                                                                               | `plugins` im Datenordner                      | Ordner, in dem Plugins liegen                                                                                                                                                                                                                                                                    |
| `PLUGIN_UPLOAD`                                                                                             | aus                                           | `on` erlaubt Admins, Plugins im Browser hochzuladen und zu entfernen                                                                                                                                                                                                                             |
| `PLUGINS_DEV`                                                                                               | aus                                           | `on` schaltet den Entwicklermodus für Plugins ein, siehe [Anleitung für Plugins](docs/plugins.md#entwickeln)                                                                                                                                                                                     |
| `OFFICE_URL`                                                                                                |                                               | Adresse eines Dienstes mit [Gotenberg](https://gotenberg.dev), der Office-Dateien für die Vorschau umwandelt. Mit `docker/office.yml` ist sie schon gesetzt                                                                                                                                      |
| `COLLABORA_INTERNAL_URL`                                                                                    |                                               | Adresse, unter der MoeCloud selbst [Collabora Online](#office-bearbeitung-dazunehmen) erreicht, etwa `http://collabora:9980`. Ohne `COLLABORA_URL` reicht MoeCloud den Editor dann unter der Adresse der Cloud durch. In der `compose.yaml` und mit `docker/collabora.yml` ist sie schon gesetzt |
| `COLLABORA_URL`                                                                                             |                                               | Eigene Adresse von Collabora Online für die Browser, etwa `https://office.example.com`                                                                                                                                                                                                           |
| `COLLABORA_WOPI_URL`                                                                                        |                                               | Adresse, unter der Collabora deine Cloud erreicht, falls sie von der öffentlichen abweicht. Was du unter **Admin › Einstellungen › Office** speicherst, hat bei allen dreien Vorrang                                                                                                             |
| `OFFICE_HTTPS`                                                                                              | aus, mit `DOMAIN` an                          | Nur Docker: `true` sagt dem mitgelieferten Collabora, dass die Cloud über HTTPS läuft                                                                                                                                                                                                            |
| `COLLABORA_TAG`                                                                                             | `latest`                                      | Nur Docker: Tag des Images `collabora/code`                                                                                                                                                                                                                                                      |
| `OFFICE_DICTIONARIES`                                                                                       | `de_DE en_US`                                 | Nur Docker: Wörterbücher für die Rechtschreibprüfung in Collabora                                                                                                                                                                                                                                |
| `MOECLOUD_INSTALL`                                                                                          | `node`, im Docker-Image `docker`              | Wie MoeCloud installiert ist, damit die Verwaltung den passenden Befehl zum Aktualisieren zeigt. Das Installationsskript setzt `script`                                                                                                                                                          |
| `PUID` / `PGID`                                                                                             | `1000`                                        | Nur Docker: Benutzer und Gruppe, denen `data/` gehört                                                                                                                                                                                                                                            |
| `MOECLOUD_BIND` / `MOECLOUD_PORT`                                                                           | `0.0.0.0` / `3000`                            | Nur Docker: Adresse und Port auf dem Host                                                                                                                                                                                                                                                        |
| `MOECLOUD_TAG`                                                                                              | `latest`                                      | Nur Docker: Tag des Images. Das Installationsskript trägt hier nichts ein und nimmt ohne Angabe `latest`                                                                                                                                                                                         |
| `DOMAIN`                                                                                                    |                                               | Nur Docker mit Caddy, siehe [Mit eigener Domain und HTTPS](#mit-eigener-domain-und-https)                                                                                                                                                                                                        |
| `VITE_DEV_SERVER`                                                                                           |                                               | Nur für die Entwicklung, siehe [Entwicklung](#entwicklung)                                                                                                                                                                                                                                       |

## Metriken für Prometheus

Unter `/metrics` liefert MoeCloud Zahlen im Format von Prometheus: Konten, Dateien, Ordner, Speicher, Links, Freigaben, Sitzungen, offene Uploads, Live-Verbindungen, die Warteschlange der Verarbeitung, Ergebnisse des Virenscans und fehlgeschlagene Anmeldungen. Der Zugriff braucht ein Token, das du unter **Admin › System › Metriken für Prometheus** erzeugst oder mit `METRICS_TOKEN` festlegst. Ohne Token antwortet `/metrics` mit 404.

```yaml
- job_name: moecloud
  scheme: https
  metrics_path: /metrics
  authorization:
    credentials: DEIN-TOKEN
  static_configs:
    - targets: ['cloud.example.com']
```

## Versionsprüfung

Einmal am Tag fragt MoeCloud bei MoePulse unter `https://pulse.moestudio.net` nach, ob es eine neue Version gibt. Dabei geht nur die installierte Version mit, damit MoePulse sagen kann, ob es für genau diese Version ein Sicherheitsupdate gibt oder ob sie zurückgezogen wurde. Eine Installations-ID oder andere Angaben über deinen Server gehen dabei nicht mit, und das gilt unabhängig davon, ob die Nutzungsstatistik an ist. Antwortet MoePulse nicht, fragt MoeCloud wie bisher die Datei `https://moecloud.moestudio.net/version.json` ab, die gar nichts mitbekommt. Gibt es eine neue Version, sehen Admins einen Hinweis in der Übersicht, unter **Admin › System** und unter **Admin › Hilfe**, mit den wichtigsten Neuerungen, dem Changelog und dem passenden Befehl zum Aktualisieren. Eine zurückgezogene Version meldet die Übersicht ausdrücklich. Einmal pro Version kommt außerdem eine Benachrichtigung, und die [Webhooks](#webhooks) für neue Versionen melden sich. Sicherheitsupdates sind als solche markiert.

Abschalten lässt sich die Prüfung unter **Admin › Einstellungen › Aufbewahrung und Updates**. Mit `UPDATE_CHECK_URL=off` ist sie fest aus, mit einer eigenen Adresse fragt MoeCloud nur dort nach, etwa für einen Fork. Mit `MOEPULSE_DISABLED=1` fragt MoeCloud nur die Datei ab. Die Datei sieht so aus, Pflicht ist nur `version`, `changelog` muss mit `https://` beginnen und von `notes` zeigt MoeCloud höchstens 10 Punkte pro Sprache:

```json
{
  "version": "1.9.0",
  "date": "2026-11-26",
  "changelog": "https://moecloud.moestudio.net/changelog.html#v1.9.0",
  "security": false,
  "notes": {
    "de": ["Öffentliche Links direkt per E-Mail verschicken"],
    "en": ["Send public links straight by email"]
  }
}
```

## Updates

Was neu ist und worauf du achten musst, steht im [Changelog](CHANGELOG.md).

- **Mit dem Installationsskript**: `sudo moecloud update`, oder jede Nacht von selbst mit `sudo moecloud auto-update on`
- **Mit Docker**: `docker compose pull` und `docker compose up -d`. Hast du `MOECLOUD_TAG` gesetzt, trägst du dort vorher das neue Tag ein oder nimmst die Zeile heraus
- **Mit Node.js**: `git pull`, `npm ci`, `npm run build` und MoeCloud neu starten

Ändert sich mit einem Update die Datenbank, sichert MoeCloud sie beim ersten Start als `moecloud-update-…db` in `data/backups/` und bringt sie danach auf den neuen Stand. Beim Update auf 1.9.0 kommen die Tabellen für Kalender, Termine, Aufgaben, Freigaben, Erinnerungen, Vorlagen, Buchungsseiten, Terminumfragen, Adressbücher und Kontakte dazu, außerdem zwei Spalten für das Ablaufdatum von Dateien und Ordnern. Beim Update auf 1.6.0 kommen die Tabellen für Teamordner und Abläufe dazu, außerdem Spalten für Profilbilder, die Zustimmung zu den Nutzungsbedingungen, Namen von Versionen und Einladungen für Gastkonten. Beim Update auf 1.4.0 kommen die Tabelle für gespeicherte Suchen und eine Spalte samt Index für die Zeitleiste in Fotos dazu, die MoeCloud beim ersten Start für alle vorhandenen Fotos füllt. Beim Update von 1.0.0 auf 1.1.0 kommen die Tabellen für Gruppen und die Spalten für Grenze und Pause von Links dazu, beim Update von 0.1.0 auf 1.0.0 die Tabellen für Protokoll, Aktivität, Benachrichtigungen, Kommentare, Webhooks und den Suchindex. Version 1.2.0 ändert den Aufbau der Datenbank nicht. Beim ersten Start ordnet sie Rohdateien als Bilder ein und merkt Dateien, die jetzt eine Vorschau bekommen, für die Verarbeitung vor. Vorhandene Dateien liest MoeCloud danach im Hintergrund für Vorschaubilder, Fotos und Suche ein, das läuft nebenher und braucht nichts von dir. Den Fortschritt siehst du unter **Admin › System**.

Wer von 0.1.0 kommt, startet für den Virenscan danach ClamAV und schaltet ihn unter **Admin › Virenscan** ein und richtet für E-Mails den Versand unter **Admin › E-Mail** ein. Wer mit dem Installationsskript von 1.0.0 kommt, bekommt beim ersten `sudo moecloud update` auch den neuen Befehl `moecloud` mit `status`, `doctor` und `auto-update`.

## Datenbank

Konten, Ordner, Freigaben und Einstellungen speichert MoeCloud in SQLite oder PostgreSQL. Deine Dateien liegen in beiden Fällen in `data/blobs/`.

- **SQLite** ist der Standard. Die Datenbank ist eine Datei in `data/`, braucht keinen eigenen Dienst und keine Pflege und ist für die meisten Installationen die schnellste Wahl, weil jede Abfrage direkt im Prozess läuft.
- **PostgreSQL** lohnt sich, wenn `data/` auf einem Netzlaufwerk oder einem FUSE-Dateisystem wie mergerfs liegt, wo die Dateisperren von SQLite nicht zuverlässig funktionieren, wenn viele Konten gleichzeitig arbeiten oder wenn du PostgreSQL schon mit eigener Sicherung betreibst. Jede Abfrage geht dann über eine Verbindung und braucht etwa 0,2 ms länger.

MoeCloud braucht PostgreSQL 15 oder neuer und eine leere Datenbank, die dem Benutzer von MoeCloud gehört. Die Adresse kommt in `DATABASE_URL`:

```bash
DATABASE_URL=postgres://moecloud:passwort@db.example.com:5432/moecloud
```

Sonderzeichen im Passwort schreibst du in der Adresse mit `%`, etwa `%40` für `@`, oder du lässt das Passwort weg und setzt es mit `PGPASSWORD`. Für TLS hängst du `?sslmode=verify-full` an, mit eigener Zertifizierungsstelle zusätzlich `&sslrootcert=/pfad/ca.pem`. Für Docker Secrets liest MoeCloud die Adresse mit `DATABASE_URL_FILE` aus einer Datei. Beim ersten Start legt MoeCloud alle Tabellen an. Darf der Benutzer die Erweiterungen `unaccent` und `pg_trgm` einrichten, was der Eigentümer einer Datenbank ab PostgreSQL 13 kann, findet die Suche Wörter auch ohne Akzente und Teile von Namen über einen eigenen Index. Ohne sie funktioniert alles, nur etwas langsamer. Welche Datenbank in welcher Version läuft, zeigen **Admin › System** und `moecloud db`.

### Umziehen

`db copy` kopiert alle Daten von einer Datenbank in eine andere, in beide Richtungen. Das Ziel muss leer sein oder darf nur von MoeCloud angelegt sein, ohne Konten und Dateien. Halte MoeCloud dafür an, die alte Datenbank bleibt unverändert liegen.

Mit dem Installationsskript erledigt das ein Befehl. Er hält MoeCloud an, startet PostgreSQL, kopiert die Daten, stellt die Konfiguration um und startet MoeCloud wieder:

```bash
sudo moecloud database postgres
sudo moecloud database sqlite
```

Mit Docker richtest du PostgreSQL ein wie unter [PostgreSQL dazunehmen](#postgresql-dazunehmen), startest aber noch nicht alles, sondern kopierst die Daten vorher:

```bash
docker compose stop moecloud
docker compose up -d postgres
docker compose run --rm --name moecloud-cli moecloud moecloud db copy --from /data/moecloud.db
docker compose up -d
```

Ohne Ziel kopiert `db copy` in die Datenbank aus `DATABASE_URL`. Zurück zu SQLite geht es mit `db copy /data/moecloud.db`, solange dort keine Datei liegt. Danach nimmst du `docker/postgres.yml` aus `COMPOSE_FILE` und startest mit `docker compose up -d --remove-orphans`. Hast du MoeCloud schon mit dem leeren PostgreSQL gestartet, ist das kein Problem: Solange es dort noch keine Konten gibt, nimmt `db copy` die Datenbank als Ziel, und das Log weist beim Start auf eine übrig gebliebene SQLite-Datei mit Konten hin.

## Datensicherung

Alles, was MoeCloud speichert, liegt in einem Ordner:

```
data/
  moecloud.db      Datenbank mit Konten, Ordnern, Freigaben und Einstellungen
  moecloud.db-wal  Änderungen, die noch nicht in der Datenbank stehen
  blobs/           die Dateien, benannt nach ihrer Prüfsumme
  thumbs/          Vorschaubilder, MoeCloud erzeugt sie bei Bedarf neu
  previews/        Große Vorschaubilder für die Bildansicht, MoeCloud erzeugt sie bei Bedarf neu
  avatars/         Profilbilder
  tmp/             laufende Uploads
  backups/         Sicherungen der Datenbank
```

Die Datenbank sichert MoeCloud jede Nacht um 3 Uhr als `moecloud-auto-…db` und behält die letzten 7 automatischen Sicherungen. Uhrzeit und Anzahl stellst du unter **Admin › Sicherungen** ein, dort startest du auch eine Sicherung von Hand und lädst sie herunter. Auf der Kommandozeile geht das mit `backup`, die Sicherung landet dann als `moecloud-manual-20261108-101509.db` in `data/backups/`:

```bash
docker compose exec moecloud moecloud backup
```

**Zweiter Ordner**: Mit `BACKUP_COPY_DIR` kopiert MoeCloud jede Sicherung zusätzlich dorthin, etwa auf eine andere Platte oder ein Netzlaufwerk, und räumt dort nach denselben Regeln auf. Mit Docker hängst du den Ordner als Volume ein, er muss dem Benutzer aus `PUID` gehören:

```yaml
services:
  moecloud:
    environment:
      BACKUP_COPY_DIR: /backups
    volumes:
      - /mnt/nas/moecloud-sicherungen:/backups
```

Klappt eine Kopie nicht, bleibt die Sicherung in `data/backups/` trotzdem bestehen. Admins bekommen eine Benachrichtigung und sehen den Grund unter **Admin › Sicherungen**.

Bevor ein Update die Datenbank ändert, legt MoeCloud eine Sicherung `moecloud-update-v3-…db` mit dem alten Stand an und behält die letzten drei. Klappt diese Sicherung nicht, startet MoeCloud nicht und lässt die Datenbank, wie sie ist. Die Meldung im Log nennt dann den Ordner und den Grund. Sicherungen brauchen keine Dateisperren, `data/backups/` darf deshalb auch auf einem Netzlaufwerk liegen. Die Datenbank selbst gehört auf einen lokalen Datenträger.

Die Dateien selbst stecken nicht in diesen Sicherungen. Sichere den Ordner `data/blobs/` zusätzlich, etwa mit `restic`, Borg oder `rsync`, und `data/avatars/`, wenn die Profilbilder mitkommen sollen. Zum Zurückspielen MoeCloud beenden, die Sicherung als `data/moecloud.db` ablegen, `moecloud.db-wal` und `moecloud.db-shm` löschen, `blobs/` zurückkopieren und MoeCloud wieder starten. `check` zeigt danach, ob alle Dateien da sind.

Mit PostgreSQL sind die Sicherungen ebenfalls SQLite-Dateien, die MoeCloud aus einem festen Stand der Datenbank schreibt. Du kannst sie also genauso herunterladen, ansehen und aufheben. Zum Zurückspielen legst du eine neue, leere Datenbank an und kopierst die Sicherung mit `db copy --from /data/backups/moecloud-auto-….db` hinein. `pg_dump` funktioniert daneben wie gewohnt.

Die Datenbank enthält Passwort-Hashes, die Schlüssel der Authenticator-Apps, das Passwort für den SMTP-Server und den Schlüssel, mit dem MoeCloud App-Passwörter prüft. Bewahre Sicherungen so sicher auf wie den Server selbst.

### Dateien ohne Datenbank zurückholen

Ist die Datenbank verloren und es gibt keine Sicherung, liegen deine Dateien trotzdem vollständig in `data/blobs/`. Weg sind dann Namen, Ordner, Konten und Freigaben. Mit `recover` holst du die Dateien in ein Konto zurück:

1. Kopiere `data/blobs/` vorher mit `cp -a` oder `rsync -a` auf eine andere Platte. So bleiben auch die Zeitstempel erhalten, die `recover` als Datum nutzt.
2. Starte MoeCloud und richte es im Browser neu ein.
3. `docker compose exec moecloud moecloud recover --dry-run` zeigt, was gefunden wird, ohne etwas zu ändern. Dazu gehört auch, wie viele Dateien die Datenbank schon kennt und welche Ordner MoeCloud nicht lesen darf.
4. `docker compose exec moecloud moecloud recover emi` holt alles in den Ordner „Wiederhergestellt“ von emi. Ohne Namen nimmt `recover` das einzige Admin-Konto. Meldet der Befehl `locking protocol`, nimm den Weg aus [Kommandozeile](#kommandozeile).

`recover` prüft jede Datei gegen ihre Prüfsumme und erkennt die Art am Inhalt, auch bei RAW-Fotos, HEIC und alten Office-Dateien. Die Dateien landen nach Art sortiert in Ordnern wie Bilder, Videos, Audio, PDFs, Dokumente und Texte, Bilder und Videos zusätzlich nach Jahr. Die Namen kommen, wo es geht, aus dem Inhalt:

| Art                                                     | Name                                          |
| ------------------------------------------------------- | --------------------------------------------- |
| Bilder und Videos                                       | Aufnahmedatum, etwa `2024-07-14 18.32.05.jpg` |
| Musik                                                   | Interpret und Titel aus den Tags              |
| Texte, PDFs, Word- und PowerPoint-Dateien, OpenDocument | Erste Zeile mit Text, etwa `Mietvertrag.pdf`  |
| Alles andere                                            | Zeitpunkt des Uploads                         |

Ältere Versionen und Dateien aus dem Papierkorb kommen ebenfalls zurück, und alles landet bei einer Person. Dateien, die nicht zu ihrer Prüfsumme passen, lässt `recover` liegen und nennt sie. Ein zweiter Aufruf übernimmt nur, was noch fehlt. Vorschaubilder, Bildinfos und den Suchtext erzeugt MoeCloud danach im Hintergrund, mit `process` sofort.

## Kommandozeile

| Befehl                                         | Zweck                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                                        | Alle Konten mit belegtem Speicher anzeigen                                                                                                           |
| `create-admin <name> [--email] [--name]`       | Admin-Konto mit neuem Passwort anlegen, etwa wenn du die Einrichtung im Browser überspringen willst                                                  |
| `reset-password <name> [--change]`             | Neues Passwort setzen und alle Sitzungen beenden, mit `--change` gilt es nur bis zur nächsten Anmeldung                                              |
| `reset-2fa <name> [--passkeys]`                | Authenticator-App eines Kontos entfernen, mit `--passkeys` auch alle Passkeys                                                                        |
| `setup-link [--new]`                           | Link für die Einrichtung anzeigen, mit `--new` einen neuen Code erzeugen                                                                             |
| `backup [ordner]`                              | Datenbank sichern, ohne den Server anzuhalten                                                                                                        |
| `cleanup`                                      | Papierkorb, alte Uploads und verwaiste Dateien aufräumen                                                                                             |
| `check [--deep]`                               | Prüfen, ob alle Dateien auf der Platte liegen, mit `--deep` auch, ob ihr Inhalt zur Prüfsumme passt                                                  |
| `maintenance <on\|off> [text]`                 | Wartungsmodus ein- oder ausschalten                                                                                                                  |
| `admin-networks [clear]`                       | Netze zeigen, aus denen die Verwaltung erreichbar ist, mit `clear` die Beschränkung aufheben                                                         |
| `scan-test`                                    | Verbindung zu ClamAV mit der EICAR-Testdatei prüfen                                                                                                  |
| `scan [--all]`                                 | Ungeprüfte Dateien mit ClamAV prüfen, mit `--all` alle                                                                                               |
| `mail-test <adresse>`                          | Test-E-Mail schicken                                                                                                                                 |
| `process`                                      | Vorschaubilder, Bildinfos und Suchindex nachholen                                                                                                    |
| `recover [name] [--dry-run]`                   | Dateien aus `data/blobs/` ohne Eintrag in der Datenbank zurückholen, siehe [Dateien ohne Datenbank zurückholen](#dateien-ohne-datenbank-zurückholen) |
| `db`                                           | Art, Version, Größe und Stand der Datenbank zeigen                                                                                                   |
| `db copy [--from quelle] [ziel]`               | Alle Daten in eine leere Datenbank kopieren, als SQLite-Datei oder `postgres://…`, siehe [Umziehen](#umziehen)                                       |
| `reindex`                                      | Suchindex für Inhalte neu aufbauen                                                                                                                   |
| `plugins`                                      | [Plugins](#plugins) im Ordner anzeigen                                                                                                               |
| `plugins enable <id>` / `plugins disable <id>` | Plugin freigeben oder abschalten                                                                                                                     |
| `plugins install <zip>`                        | Plugin aus einem ZIP-Archiv einspielen                                                                                                               |
| `plugins example [name]`                       | Mitgelieferte Beispiele zeigen oder eines in den Ordner legen                                                                                        |
| `plugins remove <id>`                          | Plugin samt Einstellungen und gespeicherten Daten entfernen                                                                                          |
| `version`                                      | Installierte und neueste Version anzeigen                                                                                                            |

Mit Docker heißen die Befehle `docker compose exec moecloud moecloud users`, `… moecloud reset-password emi` und so weiter, nach dem Installationsskript `sudo moecloud users`. Sie laufen dort mit dem Benutzer, dem `data/` gehört. Ohne Docker nimmst du `npm run cli -- users`. Legst du das erste Konto mit `create-admin` an, starte MoeCloud danach einmal neu.

Meldet ein Befehl `locking protocol` oder `database is locked`, kommt er neben dem laufenden Server nicht an die Datenbank. Das passiert, wenn `data/` auf einem Netzlaufwerk oder einem FUSE-Dateisystem wie mergerfs liegt, weil die Dateisperren von SQLite dort zwischen zwei Prozessen nicht zuverlässig funktionieren. Dann läuft der Befehl bei angehaltenem Server in einem eigenen Container:

```bash
docker compose stop
docker compose run --rm --name moecloud-cli moecloud moecloud users
docker compose up -d
```

`sudo moecloud` fragt in diesem Fall selbst, ob es MoeCloud dafür kurz anhalten soll, und `sudo moecloud doctor` zeigt, auf welchem Dateisystem `data/` liegt. Auf Dauer gehört zumindest die Datenbank auf einen lokalen Datenträger.

## API

Die Weboberfläche nutzt dieselbe API wie deine Skripte. Skripte melden sich mit dem Benutzernamen und einem App-Passwort per HTTP Basic an. Das klappt für alle Pfade unter `/api/` außer denen, die das Konto selbst absichern, siehe [Als Laufwerk einbinden](#als-laufwerk-einbinden). Für `/api/admin/` braucht das App-Passwort den Haken **Darf die Verwaltung bedienen**, sonst kommt `403` mit dem Code `app_password_scope`. Ist die Verwaltung auf bestimmte Netze beschränkt, antwortet `/api/admin/` von anderen Adressen mit `403` und dem Code `admin_network`. Antworten kommen als JSON, Fehler als `{ "error": { "code", "message" } }`. Ein App-Passwort nur zum Lesen beantwortet ändernde Anfragen mit `403` und dem Code `read_only`, ein angehaltenes mit `403` und dem Code `device_paused`. Namen bekannter Erpressungstrojaner lehnt MoeCloud mit `403` und dem Code `ransomware` ab.

```bash
curl -u emi:APP-PASSWORT https://cloud.example.com/api/session
curl -u emi:APP-PASSWORT -F "file=@rechnung.pdf" https://cloud.example.com/api/nodes/ORDNER-ID/upload
```

| Methode | Pfad                                                          | Beschreibung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/session`                                                | Angemeldete Person, `user.rootId` ist die ID deines Hauptordners                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET`   | `/api/nodes/:id`                                              | Ein Element mit Pfad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET`   | `/api/nodes/:id/children`                                     | Inhalt eines Ordners, mit `?folders=1` nur die Unterordner                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST`  | `/api/nodes/:id/folders`                                      | Ordner anlegen, JSON `{ "name" }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST`  | `/api/nodes/:id/upload`                                       | Dateien als `multipart/form-data` hochladen, mit `?conflict=replace` vorhandene ersetzen                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET`   | `/api/nodes/:id/content`                                      | Datei herunterladen, auch in Teilen per `Range`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PUT`   | `/api/nodes/:id/content`                                      | Inhalt einer Datei als `application/octet-stream` ersetzen, die alte Fassung wird zur Version                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GET`   | `/api/nodes/:id/meta`                                         | Abmessungen, Aufnahmedatum, Bildinfos, Musik-Tags, Ergebnis des Virenscans und die Prüfsumme als `sha256`                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET`   | `/api/nodes/:id/thumb`, `/api/nodes/:id/preview`              | Vorschaubild mit 480 Pixeln und großes Vorschaubild mit bis zu 2560 Pixeln als WebP, das große nur für Formate, die Browser nicht zeigen                                                                                                                                                                                                                                                                                                                                                                       |
| `PATCH` | `/api/nodes/:id`                                              | Umbenennen, JSON `{ "name" }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST`  | `/api/nodes/:id/lock`                                         | Datei sperren, JSON `{ "minutes" }` mit bis zu 43200 oder `null` ohne Ende. `DELETE` entsperrt. Gesperrte Dateien antworten anderen mit `423`                                                                                                                                                                                                                                                                                                                                                                  |
| `GET`   | `/api/nodes/:id/size`                                         | Größe, Dateien und Unterordner eines Ordners samt Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST`  | `/api/nodes/rename`                                           | Mehrere umbenennen, JSON `{ "items": [{ "id", "name" }] }`, MoeCloud prüft alle Namen vorher                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PUT`   | `/api/nodes/color`                                            | Ordner einfärben, JSON `{ "ids": [], "color" }` mit `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `brown`, `gray` oder `null`                                                                                                                                                                                                                                                                                                                                                          |
| `PUT`   | `/api/nodes/icon`                                             | Ordnern ein Symbol geben, JSON `{ "ids": [], "icon" }` mit einem von 28 Namen wie `star`, `work`, `photo`, `travel` oder `money`, `null` entfernt es. Ordner tragen es als `icon`                                                                                                                                                                                                                                                                                                                              |
| `POST`  | `/api/nodes/move`, `/api/nodes/copy`                          | Verschieben oder kopieren, JSON `{ "ids": [], "target" }`. Eigene Dateien lassen sich auch in geteilte Ordner und Teamordner verschieben                                                                                                                                                                                                                                                                                                                                                                       |
| `POST`  | `/api/nodes/trash`, `/api/nodes/restore`, `/api/nodes/delete` | In den Papierkorb, zurückholen oder endgültig löschen, JSON `{ "ids": [] }`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET`   | `/api/search?q=&kind=`                                        | Suche nach Namen und im Inhalt, `kind` ist `folder`, `image`, `video`, `audio`, `pdf` oder `document`, dazu `after`, `before`, `minSize`, `maxSize` und `tag`                                                                                                                                                                                                                                                                                                                                                  |
| `GET`   | `/api/recent`, `/api/starred`, `/api/trash`                   | Zuletzt, Favoriten und Papierkorb                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET`   | `/api/photos`                                                 | Fotos und Videos nach Aufnahmedatum, weitere Seiten mit `?at=&seq=` aus `next`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET`   | `/api/activity`, `/api/nodes/:id/activity`                    | Aktivität in deinen Ordnern oder an einem Element, ältere mit `?before=`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET`   | `/api/nodes/:id/comments`                                     | Kommentare, jeweils mit `reactions` (`emoji`, `count`, `mine`, `people`). `POST` mit JSON `{ "text" }` schreibt einen neuen                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET`   | `/api/nodes/:id/comments/people`                              | Personen, die sich dort mit `@benutzername` erwähnen lassen                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST`  | `/api/nodes/:id/comments/:comment/reactions`                  | Reaktion setzen oder zurücknehmen, JSON `{ "emoji", "on" }` mit 👍, ❤️, 😂, 🎉, 😮, 😢, 👀 oder ✅. Die Antwort enthält den Kommentar mit allen Reaktionen                                                                                                                                                                                                                                                                                                                                                     |
| `PUT`   | `/api/nodes/:id/description`                                  | Beschreibung setzen, JSON `{ "text" }`, ein leerer Text entfernt sie                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PUT`   | `/api/nodes/:id/reminder`                                     | Erinnerung setzen, JSON `{ "dueAt", "note" }` mit der Zeit in Millisekunden. `DELETE` löscht sie, `GET /api/reminders` listet alle anstehenden                                                                                                                                                                                                                                                                                                                                                                 |
| `PUT`   | `/api/nodes/:id/expiry`                                       | Ablaufdatum setzen, JSON `{ "at" }` mit der Zeit in Millisekunden, höchstens zehn Jahre voraus, oder `null` zum Entfernen. Elemente tragen es als `expiresAt`                                                                                                                                                                                                                                                                                                                                                  |
| `GET`   | `/api/templates`                                              | Vorlagenordner und seine Dateien. `PUT` mit JSON `{ "folderId" }` legt ihn fest, `POST /api/nodes/:id/from-template` mit `{ "templateId", "name" }` legt eine Kopie im Ordner an                                                                                                                                                                                                                                                                                                                               |
| `POST`  | `/api/nodes/:id/import/webdav`                                | Import per WebDAV in diesen Ordner starten, JSON `{ "url", "username", "password", "name" }`. `GET /api/imports/webdav` zeigt den Stand, `DELETE /api/imports/webdav/:id` bricht ab                                                                                                                                                                                                                                                                                                                            |
| `GET`   | `/api/nodes/:id/office`                                       | Die Vorschau einer Office-Datei als PDF, wenn LibreOffice eingerichtet ist. Das Feld `office` eines Elements sagt, ob es sie gibt                                                                                                                                                                                                                                                                                                                                                                              |
| `GET`   | `/api/nodes/:id/epub`                                         | Titel, Autor und Abschnitte eines E-Books, die Dateien darin unter `/epub/-/pfad`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET`   | `/api/nodes/:id/archive`                                      | Inhalt eines ZIP-, TAR-, TAR.GZ- oder GZ-Archivs, eine einzelne Datei daraus mit `/archive/entry?path=`                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET`   | `/api/nodes/:id/versions`                                     | Ältere Fassungen einer Datei. `PATCH /api/nodes/:id/versions/:version` mit JSON `{ "label" }` gibt einer Fassung einen Namen, `null` nimmt ihn wieder weg                                                                                                                                                                                                                                                                                                                                                      |
| `GET`   | `/api/zip?ids=`                                               | Elemente als ZIP, IDs durch Kommas getrennt                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST`  | `/api/nodes/zip`                                              | Elemente als ZIP-Archiv in der Cloud anlegen, JSON `{ "ids": [], "name" }`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST`  | `/api/nodes/:id/extract`                                      | ZIP-, TAR- oder TAR.GZ-Archiv in einen neuen Ordner daneben entpacken, eine einzelne GZ-Datei daneben. Die Antwort nennt Ordner, Zahl der Dateien und was übersprungen wurde                                                                                                                                                                                                                                                                                                                                   |
| `GET`   | `/api/nodes/:id/rewind?at=`                                   | Vorschau, was **Auf früheren Stand zurücksetzen** bei einem eigenen Ordner ändern würde, `at` in Millisekunden, bis zu 365 Tage zurück. Die Antwort nennt `counts` (`restore`, `content`, `rename`, `trash`, `missing`, `deleted`), `total` und bis zu 500 `items`. `POST` mit JSON `{ "at" }` setzt zurück und nennt in `done`, was erledigt wurde                                                                                                                                                            |
| `POST`  | `/api/nodes/:id/rotate`                                       | Bild drehen, JSON `{ "degrees" }` mit `90`, `180` oder `270`, die alte Fassung wird zur Version                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST`  | `/api/nodes/:id/edit`                                         | Bild bearbeiten, JSON mit `rotate`, `flipH`, `flipV`, `crop` (relativ von 0 bis 1), `maxEdge`, `format`, `quality` und `save` (`copy` oder `version`)                                                                                                                                                                                                                                                                                                                                                          |
| `GET`   | `/api/nodes/:id/pdf`                                          | Seiten einer PDF mit Größe und Drehung, `POST` mit JSON `{ "pages": [{ "page", "rotate" }], "save", "name" }` speichert eine neue Fassung                                                                                                                                                                                                                                                                                                                                                                      |
| `POST`  | `/api/pdf/merge`                                              | PDFs zusammenfügen, JSON `{ "ids": [], "name" }`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST`  | `/api/pdf/images`                                             | Aus Bildern eine PDF machen, JSON `{ "ids": [], "name", "layout" }` mit `a4` oder `fit`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET`   | `/api/nodes/:id/subtitles`                                    | Untertitel neben einem Video, als WebVTT unter `/api/nodes/:id/vtt`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET`   | `/api/nodes/:id/position`                                     | Gemerkte Stelle in Video oder Audio, `PUT` mit JSON `{ "seconds", "duration" }` speichert sie                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GET`   | `/api/tags`                                                   | Deine Schlagwörter, `POST` legt eins an, `PUT /api/nodes/tags` mit JSON `{ "ids", "add", "remove" }` vergibt sie                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET`   | `/api/albums`                                                 | Deine Alben, `POST` legt eins an, `POST /api/albums/:id/items` nimmt Fotos auf                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PUT`   | `/api/nodes/:id/watch`                                        | Ordner beobachten, JSON `{ "watching" }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `PUT`   | `/api/nodes/:id/cleanup`                                      | Aufräumregel für einen eigenen Ordner, JSON `{ "days" }` mit 1 bis 3650 oder `null` zum Abschalten                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET`   | `/api/nodes/:id/email`                                        | Betreff, Absender, Empfänger, Datum und Anhänge einer `.eml`-Datei, den Inhalt unter `/email/body` und Anhänge unter `/email/attachments/:index`                                                                                                                                                                                                                                                                                                                                                               |
| `POST`  | `/api/nodes/:id/grants`                                       | Teilen, JSON `{ "userId", "permission" }` oder `{ "groupId", "permission" }` mit `view` oder `edit`, optional `expiresAt` in Millisekunden und `note` mit bis zu 300 Zeichen                                                                                                                                                                                                                                                                                                                                   |
| `POST`  | `/api/nodes/:id/links`                                        | Öffentlichen Link anlegen, JSON mit `label`, `password`, `expiresAt`, `maxDownloads`, `allowDownload`, `allowUpload`, `uploadOnly`, `notify`, `notifyDownloads`, `slug`, `startsAt` für den Beginn in Millisekunden, `message` für eine Nachricht an Besucher und `theme` mit der Kennung eines Themes                                                                                                                                                                                                         |
| `PATCH` | `/api/links/:id`                                              | Link ändern, dieselben Felder und `paused` zum Pausieren                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET`   | `/api/links/:id/events`                                       | Verlauf eines Links: geöffnet, heruntergeladen, hochgeladen, falsches Passwort, jeweils mit Zeit und Gerät                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST`  | `/api/links/:id/send`                                         | Link per E-Mail verschicken, JSON `{ "email" }`. Braucht den eingerichteten E-Mail-Versand                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET`   | `/api/shared`                                                 | Was mit dir geteilt ist und was du teilst. Teamordner stehen mit `team: true` in `withMe`, die Notiz einer Freigabe als `shareNote`                                                                                                                                                                                                                                                                                                                                                                            |
| `GET`   | `/api/home?date=&offset=`                                     | Die Startseite: zuletzt Bearbeitetes, Favoriten, Geteiltes, Teamordner, Erinnerungen, Fotos vom selben Tag und Speicher. `date` ist der Tag als `2026-11-19`, `offset` der Abstand zur Weltzeit in Minuten                                                                                                                                                                                                                                                                                                     |
| `GET`   | `/api/teams`                                                  | Deine Teamordner mit `rootId`, eigenem Recht, belegtem Speicher und Grenze. `GET /api/teams/:id` nennt dazu die Mitglieder, `POST /api/teams/:id/leave` verlässt ihn                                                                                                                                                                                                                                                                                                                                           |
| `PUT`   | `/api/teams/:id/people/:member`                               | Leitung und Admins: Person aufnehmen oder ihr Recht ändern, JSON `{ "role" }` mit `view`, `edit` oder `manage`. `DELETE` nimmt sie heraus. Gruppen genauso unter `/api/teams/:id/groups/:member` mit `view` oder `edit`                                                                                                                                                                                                                                                                                        |
| `GET`   | `/api/teams/:id/trash`                                        | Leitung und Admins: Papierkorb des Teamordners. `POST /api/teams/:id/trash/restore` und `/trash/delete` mit JSON `{ "ids": [] }` holen zurück oder löschen endgültig, `DELETE /api/teams/:id/trash` leert ihn                                                                                                                                                                                                                                                                                                  |
| `GET`   | `/api/automations?folder=`                                    | Deine Abläufe, auf Wunsch nur die eines Ordners. `POST` legt einen an, JSON `{ "name", "folderId", "deep", "conditions", "actions" }`, `PATCH` und `DELETE` unter `/api/automations/:id` ändern und löschen, `POST /api/automations/:id/run` wendet ihn auf vorhandene Dateien an                                                                                                                                                                                                                              |
| `GET`   | `/api/nodes/:id/convert`                                      | Formate, in die sich eine Datei umwandeln lässt. `POST` mit JSON `{ "format" }` und `pdf`, `jpeg`, `png`, `webp` oder `avif` legt die Kopie daneben                                                                                                                                                                                                                                                                                                                                                            |
| `GET`   | `/api/office`                                                 | Ob das Bearbeiten mit Collabora eingerichtet ist und für welche Endungen. `POST /api/nodes/:id/office/edit` öffnet eine Datei und gibt Adresse und Schlüssel für den Editor zurück, `POST /api/nodes/:id/office/new` mit JSON `{ "kind", "name" }` und `document`, `spreadsheet` oder `presentation` legt eine leere Datei im Ordner an                                                                                                                                                                        |
| `GET`   | `/api/notes`                                                  | Deine Notizen mit Titel, Anfang des Texts und Kategorie. `POST` legt eine an, JSON `{ "title", "content", "category" }`. `GET /api/notes/:id` liefert Text und Stand, `PUT` speichert mit JSON `{ "content", "base" }` und antwortet mit `409` und `note_conflict`, wenn `base` nicht mehr der aktuelle Stand ist. `GET /api/notes/tasks` sammelt die Aufgaben aus allen Notizen mit Zeile, Text und Stand, `POST /api/notes/:id/tasks` mit JSON `{ "line", "text" }` hakt eine ab oder nimmt den Haken zurück |
| `GET`   | `/api/music`                                                  | Deine Audiodateien mit Titel, Interpret, Album, Jahr, Nummer und Dauer in `track`, dazu `plays` und `playedAt`. `POST /api/music/played` mit JSON `{ "id" }` zählt eine Wiedergabe, `DELETE /api/music/played` leert die Zählung                                                                                                                                                                                                                                                                               |
| `GET`   | `/api/playlists`                                              | Deine Wiedergabelisten, `POST` legt eine an, JSON `{ "name", "ids" }`. `GET /api/playlists/:id` liefert die Titel in Reihenfolge, `PATCH` ändert `name` und mit `order` die Reihenfolge, `POST /api/playlists/:id/items` und `/remove` mit JSON `{ "ids": [] }` nehmen auf und heraus, `GET /api/playlists/:id/m3u` gibt die Liste als M3U aus, `POST /api/nodes/:id/playlist` liest eine M3U-Datei ein                                                                                                        |
| `GET`   | `/api/forms`                                                  | Deine Formulare mit `url`, `state` und Zahl der Antworten. `POST` mit JSON `{ "title" }` legt eins an. `GET`, `PATCH` und `DELETE` unter `/api/forms/:id` lesen, ändern und löschen es, `PATCH` nimmt `title`, `description`, `questions`, `accepting`, `closesAt`, `maxResponses`, `once`, `signedIn`, `named`, `notify` und `confirmation`. `POST /api/forms/:id/copy` kopiert es, `POST /api/forms/:id/token` erzeugt einen neuen Link                                                                      |
| `GET`   | `/api/forms/:id/results`                                      | Auswertung eines Formulars pro Frage. `GET /api/forms/:id/responses?offset=&limit=` listet die einzelnen Antworten, `DELETE /api/forms/:id/responses` und `/api/forms/:id/responses/:response` löschen alle oder eine, `GET /api/forms/:id/export` liefert sie als CSV                                                                                                                                                                                                                                         |
| `GET`   | `/api/calendar/calendars`                                     | Deine Kalender und die mit dir geteilten. `POST` legt einen an, `PATCH` und `DELETE` unter `/api/calendar/calendars/:id` ändern ihn oder legen ihn in den Papierkorb, `GET /api/calendar/calendars/:id/export.ics` liefert ihn als ICS, `POST /api/calendar/calendars/:id/import` nimmt eine ICS-Datei                                                                                                                                                                                                         |
| `GET`   | `/api/calendar/occurrences?from=&to=`                         | Termine im Zeitraum mit allen Wiederholungen, `from` und `to` in Millisekunden, höchstens 400 Tage, mit `&calendars=` nur bestimmte Kalender und mit `&tasks=1` samt Aufgaben                                                                                                                                                                                                                                                                                                                                  |
| `POST`  | `/api/calendar/events`                                        | Termin oder Aufgabe anlegen, JSON mit `calendarId`, `component` (`VEVENT` oder `VTODO`), `title`, `start`, `end` oder `due` in Millisekunden, als `YYYY-MM-DD` oder ISO, `allDay`, `zone`, `rrule`, `location`, `description`, `alarms`, `attendees` und mehr. `GET`, `PATCH` und `DELETE` unter `/api/calendar/events/:id`                                                                                                                                                                                    |
| `GET`   | `/api/calendar/tasks`                                         | Offene Aufgaben, mit `?completed=1` auch erledigte, jeweils mit `status` und `assignee`. `POST /api/calendar/events/:id/complete` hakt eine ab, `PATCH /api/calendar/events/:id` mit `{ "changes": { "status": "IN-PROCESS" } }` schiebt sie auf In Arbeit und mit `assignee` weist sie jemandem zu. Wer infrage kommt, steht unter `GET /api/calendar/calendars/:id/members`                                                                                                                                  |
| `GET`   | `/api/calendar/upcoming`                                      | Die nächsten Termine und offene Einladungen. `POST /api/calendar/events/:id/rsvp` mit JSON `{ "status" }` und `ACCEPTED`, `DECLINED` oder `TENTATIVE` antwortet auf eine                                                                                                                                                                                                                                                                                                                                       |
| `GET`   | `/api/calendar/booking-pages`, `/api/calendar/polls`          | Deine Buchungsseiten und Terminumfragen, jeweils mit `POST`, `PATCH` und `DELETE`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST`  | `/api/calendar/import`                                        | Import aus anderen Diensten starten, als `multipart/form-data` mit ICS-, ZIP- oder CSV-Dateien oder als JSON mit `{ "node" }`, `{ "url" }` oder `{ "caldav": { "url", "username", "password" } }`. `GET /api/calendar/import/:id` zeigt Stand und Vorschau, `POST /api/calendar/import/:id/run` mit `calendars` und `mode` übernimmt, `DELETE` verwirft. `POST /api/calendar/calendars/:id/detach` macht aus einem Abo einen eigenen Kalender                                                                  |
| `GET`   | `/api/contacts`                                               | Kontakte, mit `?q=`, `?book=`, `?label=`, `?group=`, `?favorites=1` oder `?trash=1`. `POST` legt einen an, JSON `{ "bookId", "data" }`, `GET`, `PUT` und `DELETE` unter `/api/contacts/:id`, dazu `/favorite`, `/restore`, `/forever`, `/vcard` und `/photo` zum Abrufen, Hochladen als `multipart/form-data` und Löschen                                                                                                                                                                                      |
| `GET`   | `/api/contacts/books`                                         | Adressbücher mit Zahl der Kontakte. `POST` legt eines an, `PATCH` und `DELETE` unter `/api/contacts/books/:id`, Freigaben unter `/api/contacts/books/:id/shares` und `PUT` oder `DELETE` auf `/shares/:userId` mit `read` oder `write`                                                                                                                                                                                                                                                                         |
| `POST`  | `/api/contacts/import`                                        | vCard, CSV oder ZIP als `multipart/form-data` oder JSON `{ "node" }` lesen, `POST /api/contacts/import/:id/run` mit `{ "book", "name", "mode" }` übernimmt. `GET /api/contacts/export?book=&format=csv` exportiert als vCard oder CSV                                                                                                                                                                                                                                                                          |
| `GET`   | `/api/contacts/birthdays?from=&to=`                           | Geburtstage im Zeitraum mit Alter, Datum als `YYYY-MM-DD`, höchstens 400 Tage. Dazu `/api/contacts/labels`, `/api/contacts/duplicates`, `POST /api/contacts/merge`, `/move`, `/delete` und `GET /api/contacts/suggest?q=`                                                                                                                                                                                                                                                                                      |
| `POST`  | `/api/account/app-passwords`                                  | App-Passwort anlegen, JSON `{ "name", "readOnly", "shared", "admin", "expiresAt" }`, nur mit Sitzung im Browser. `admin` erlaubt Admins die Verwaltung, `readOnly` erlaubt nur Lesen, `shared` zeigt Teamordner und Geteiltes im WebDAV-Laufwerk, `expiresAt` ist das Ablaufdatum in Millisekunden. `DELETE /api/account/app-passwords/:id` widerruft es                                                                                                                                                       |
| `POST`  | `/api/account/app-passwords/:id/resume`                       | Ein angehaltenes App-Passwort wieder freigeben, nur mit Sitzung im Browser. Angehaltene stehen in `GET /api/account` unter `security.appPasswords` mit `paused` (`at`, `count`, `since`)                                                                                                                                                                                                                                                                                                                       |
| `POST`  | `/api/account/secure`                                         | Konto absichern, JSON `{ "password", "sessions", "appPasswords", "links" }`, nur mit Sitzung im Browser. Die Antwort nennt, wie viele Sitzungen beendet, App-Passwörter widerrufen und Links pausiert wurden                                                                                                                                                                                                                                                                                                   |
| `PUT`   | `/api/account/avatar`                                         | Profilbild als `application/octet-stream` setzen, `DELETE` entfernt es. Bilder anderer Personen gibt es unter `/api/avatars/:id`                                                                                                                                                                                                                                                                                                                                                                               |
| `GET`   | `/api/storage`, `/api/storage/report`                         | Belegter Speicher und Grenze, dazu die Aufteilung nach Art, die größten und die doppelten Dateien                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST`  | `/api/storage/duplicates`                                     | Doppelte Dateien aufräumen, JSON `{ "keep": [] }` mit den IDs der Kopien, die bleiben. Alle anderen mit gleichem Inhalt kommen in den Papierkorb                                                                                                                                                                                                                                                                                                                                                               |
| `POST`  | `/api/storage/request`                                        | Die Verwaltung nach mehr Speicher fragen, JSON `{ "message" }`, höchstens einmal am Tag                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET`   | `/api/account/export`                                         | Alle eigenen Dateien und `konto.json` als ZIP                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PUT`   | `/api/account/push`                                           | Push einrichten, JSON `{ "kind", "url", "token" }` mit `ntfy` oder `gotify`. `DELETE` schaltet ab, `POST /api/account/push/test` schickt eine Testnachricht                                                                                                                                                                                                                                                                                                                                                    |
| `GET`   | `/api/account/webpush`                                        | Browser mit Push und der öffentliche Schlüssel des Servers. `POST` meldet einen Browser an, `DELETE /api/account/webpush/:id` entfernt ihn, `POST /api/account/webpush/test` schickt eine Testnachricht                                                                                                                                                                                                                                                                                                        |
| `POST`  | `/api/account/delete`                                         | Eigenes Konto löschen, JSON `{ "confirm", "password" }` mit dem Benutzernamen. Nur wenn die Verwaltung es erlaubt                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET`   | `/api/notifications`                                          | Benachrichtigungen, `POST /api/notifications/read` markiert sie als gelesen                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET`   | `/api/events`                                                 | Änderungen live als Server-Sent Events                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET`   | `/api/admin/groups`                                           | Nur Admins: Gruppen mit Mitgliedern, `POST` legt eine an, `PATCH` und `DELETE` unter `/api/admin/groups/:id` ändern und löschen                                                                                                                                                                                                                                                                                                                                                                                |
| `POST`  | `/api/admin/users`                                            | Nur Admins: ein Konto anlegen, JSON `{ "username", "name", "email", "password", "role", "quota", "expiresAt", "sendLink", "mustChange" }`. `PATCH /api/admin/users/:id` ändert es, `DELETE` löscht es. Mit `mustChange` verlangt MoeCloud bei der nächsten Anmeldung ein eigenes Passwort. Bis dahin antwortet die API dieser Person im Browser mit `403` und dem Code `password_change_required`, außer bei `GET /api/session`, `POST /api/account/password` und dem Abmelden                                 |
| `POST`  | `/api/admin/users/import`                                     | Nur Admins: Personen aus CSV anlegen, JSON `{ "csv", "sendLinks", "mustChange", "apply" }`. Ohne `apply` kommt nur die Vorschau. Mit `mustChange` gelten Passwörter aus der Datei nur bis zur ersten Anmeldung                                                                                                                                                                                                                                                                                                 |
| `POST`  | `/api/admin/users/:id/approve`                                | Nur Admins: ein Konto freigeben, das auf die Freigabe wartet. In der Liste unter `/api/admin/users` steht es mit `pending: true`                                                                                                                                                                                                                                                                                                                                                                               |
| `GET`   | `/api/admin/office`                                           | Nur Admins: ob Collabora antwortet und welche Endungen es bearbeitet, mit `?refresh=1` neu abgefragt. `builtIn` sagt, ob MoeCloud den Editor selbst durchreicht, `secure`, ob Collabora mit HTTPS rechnet                                                                                                                                                                                                                                                                                                      |
| `PUT`   | `/api/admin/branding/:kind`                                   | Nur Admins: Logo (`logo`) oder Hintergrundbild (`background`) als `application/octet-stream` hochladen, `DELETE` entfernt es. Abrufbar sind die Bilder ohne Anmeldung unter `/branding/logo` und `/branding/background`                                                                                                                                                                                                                                                                                        |
| `GET`   | `/api/admin/teams`                                            | Nur Admins: alle Teamordner. `POST` legt einen an, JSON `{ "name", "quota", "description", "color" }`, `PATCH /api/teams/:id` ändert ihn, `DELETE /api/admin/teams/:id?confirm=NAME` löscht ihn samt Inhalt                                                                                                                                                                                                                                                                                                    |
| `GET`   | `/api/admin/starter`                                          | Nur Admins: der Ordner mit den Startdateien für neue Konten. `PUT` mit JSON `{ "folderId" }` legt ihn fest, `null` schaltet ab                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET`   | `/api/admin/terms`                                            | Nur Admins: Stand der Zustimmung zu den Nutzungsbedingungen. `POST /api/admin/terms/renew` holt sie von allen neu ein                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET`   | `/api/admin/log?level=`                                       | Nur Admins: die letzten Meldungen des Servers ab `info`, `warn` oder `error`. `DELETE` leert die Liste                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET`   | `/api/admin/security`                                         | Nur Admins: die Sicherheitsprüfung mit `items` (jeweils `id`, `level` mit `ok`, `hint` oder `warn`, `title`, `text`, `link`), `counts`, `lockouts`, `stats`, `networks`, `address` und `ransomware` (`names`, `burst`, `pause`, `limit`). `POST /api/admin/security/unlock` mit JSON `{ "id" }` gibt eine gesperrte Anmeldung frei, `PUT /api/admin/security/networks` mit JSON `{ "networks" }` beschränkt die Verwaltung auf Adressen und Netze                                                              |
| `GET`   | `/api/admin/integrity`                                        | Nur Admins: Stand der Prüfung der gespeicherten Dateien mit `running`, `last` (`checked`, `missing`, `damaged`, `problems`) und `schedule`. `POST` startet sie, `DELETE` bricht sie ab                                                                                                                                                                                                                                                                                                                         |
| `GET`   | `/api/admin/audit/export?user=&action=`                       | Nur Admins: das Protokoll als CSV-Datei, mit denselben Filtern wie `/api/admin/audit`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET`   | `/api/admin/reports`                                          | Nur Admins: Meldungen von Besuchern. `POST /api/admin/reports/:id/resolve` mit JSON `{ "pause" }` erledigt eine und pausiert auf Wunsch den Link                                                                                                                                                                                                                                                                                                                                                               |
| `POST`  | `/api/admin/report/send`                                      | Nur Admins: den Wochenbericht sofort an die eigene Adresse schicken                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Öffentlich erreichbar sind `/s/:token` (geteilte Links), `/f/:token` ([Formulare](#formulare)), `/branding/logo` und `/branding/background` (Logo und Hintergrund der Anmeldeseite), `/register/confirm` (Bestätigung der E-Mail-Adresse), `/dav/` (WebDAV), `/caldav/` (CalDAV), `/carddav/` (CardDAV), `/b/:slug` und `/api/calendar/public/` (Buchungsseiten, Umfragen und öffentliche Kalender), `/u/:token` (Terminumfragen), `/p/:token` (öffentliche Kalender und ICS-Feeds), `/rsvp/:token` (Antworten auf Einladungen), `/holidays/:region` (Feiertage als ICS), `/wopi/files/:id` (nur für Collabora, mit dem Schlüssel einer geöffneten Datei), `/forgot` und `/reset` (Passwort vergessen), `/impressum`, `/datenschutz`, `/nutzungsbedingungen`, `/metrics` mit Token und `/healthz` für Health-Checks.

### Große Dateien über die API

Große Dateien gehen in Teilen hoch, so lässt sich ein abgebrochener Upload fortsetzen:

1. `POST /api/uploads` mit JSON `{ "parentId", "name", "size" }` beginnt den Upload. Optional sind `modifiedAt` in Millisekunden, `relativePath` für Unterordner und `conflict` mit `rename` oder `replace`. Die Antwort enthält die `id` und die Größe der Teile in `chunkSize` (16 MB).
2. `PUT /api/uploads/:id?offset=…` schickt das nächste Teil als `application/octet-stream`. `offset` ist die Zahl der Bytes, die schon angekommen sind, die Antwort nennt den neuen Stand in `received`. Passt der Offset nicht, antwortet MoeCloud mit 409 und dem richtigen Stand in `error.received`.
3. `POST /api/uploads/:id/complete` schließt den Upload ab, prüft die Datei mit dem Virenscan und gibt die neue Datei in `node` zurück. Enthält sie Schadsoftware, kommt 422 mit dem Code `infected`.

`GET /api/uploads/:id` zeigt den Stand nach einem Abbruch, `DELETE /api/uploads/:id` verwirft den Upload. Unfertige Uploads verfallen nach 24 Stunden ohne neues Teil.

```bash
DATEI=video.mp4
GROESSE=$(stat -c %s "$DATEI")
ORDNER=$(curl -s -u emi:APP-PASSWORT https://cloud.example.com/api/session | jq -r .user.rootId)
ID=$(curl -s -u emi:APP-PASSWORT -H "Content-Type: application/json" \
  -d "{\"parentId\":\"$ORDNER\",\"name\":\"$DATEI\",\"size\":$GROESSE}" https://cloud.example.com/api/uploads | jq -r .id)
OFFSET=0
while [ "$OFFSET" -lt "$GROESSE" ]; do
  OFFSET=$(tail -c +$((OFFSET + 1)) "$DATEI" | head -c 16777216 | curl -s -X PUT -u emi:APP-PASSWORT \
    -H "Content-Type: application/octet-stream" --data-binary @- \
    "https://cloud.example.com/api/uploads/$ID?offset=$OFFSET" | jq -r .received)
done
curl -s -X POST -u emi:APP-PASSWORT https://cloud.example.com/api/uploads/$ID/complete
```

## Entwicklung

```bash
npm install
npm run dev:web
npm run dev
```

`npm run dev:web` startet Vite auf Port 5173, `npm run dev` startet den Server auf Port 3000 mit `VITE_DEV_SERVER=http://localhost:5173`. Änderungen an der Oberfläche erscheinen sofort, der Server startet bei Änderungen neu. Der Server läuft direkt aus TypeScript, ohne eigenen Build.

| Befehl                                | Zweck                                                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                   | TypeScript für Server und Oberfläche prüfen                                                                                                                                                        |
| `npm run build`                       | Oberfläche nach `dist/web` bauen                                                                                                                                                                   |
| `npm test`                            | Tests für API, Anmeldung, Zwei-Faktor-Pflicht, Freigaben, Gruppen, Links, Archive, WebDAV, Virenscan, E-Mail, Vorschauen und Verwaltung. Braucht vorher `npm run build`                            |
| `npm run test:postgres`               | Dieselben Tests mit PostgreSQL statt SQLite. `TEST_POSTGRES` zeigt auf einen Server, auf dem der Benutzer Datenbanken anlegen darf, Standard ist `postgres://moecloud:moecloud@localhost/postgres` |
| `npm run test:browser`                | Abläufe im Browser mit Chrome prüfen und die Screenshots in `docs/screenshots` neu erzeugen. Braucht vorher `npm run build`, mit `CHROME_PATH` gibst du den Pfad zu Chrome an                      |
| `npm run format`                      | Code mit Prettier formatieren                                                                                                                                                                      |
| `npm run check`                       | Formatierung, Typen, Versionsangaben, Übersetzungen, Build und Tests in einem Durchlauf                                                                                                            |
| `node tools/i18n.ts`                  | Prüft, ob alle Texte übersetzt sind und alle Platzhalter stimmen                                                                                                                                   |
| `node tools/version.ts [x.y.z]`       | Prüft, ob überall dieselbe Version steht und im Changelog nichts doppelt ist. Mit einer Version trägt es sie überall ein                                                                           |
| `node tools/demo.ts <adresse> [code]` | Legt Beispieldaten mit Emi, Mia und Lea an, mit Code auch gleich die Einrichtung                                                                                                                   |
| `node tools/themes.ts`                | Rechnet die Farben der mitgelieferten Themes neu aus, mit `--check` prüft es nur                                                                                                                   |
| `node tools/icons.ts`                 | Erzeugt alle Icons aus `public/favicon.svg`                                                                                                                                                        |

Die Tests für den Virenscan brauchen kein ClamAV, sie sprechen mit einem nachgebauten `clamd`. E-Mails landen in den Tests in einem Postausgang im Speicher, die Anmeldung über SSO läuft gegen `oidc-provider` als Anbieter im Testprozess.

Die Texte sind auf Deutsch geschrieben und dienen gleichzeitig als Schlüssel für die Übersetzung. Die englischen Texte für Oberfläche und Server liegen in `src/i18n/en.json`, Platzhalter wie `{name}` bleiben gleich. Wo Einzahl und Mehrzahl im Deutschen gleich sind, im Englischen aber nicht, stehen beide Formen durch `|` getrennt, etwa `"{count} Ordner": "{count} folder|{count} folders"`.

| Ordner             | Inhalt                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes`       | Seiten und API, nach Bereichen getrennt                                                                                                |
| `src/services`     | Logik für Dateien, Uploads, Vorschauen, Virenscan, E-Mail, Benachrichtigungen, Freigaben, Anmeldung, Sicherungen und Wartung           |
| `src/lib`          | Datenbank für SQLite und PostgreSQL, Migrationen, Umzug zwischen Datenbanken, ClamAV, Krypto, HTTP-Helfer, Validierung und Übersetzung |
| `src/views`        | Seiten ohne JavaScript wie Anmeldung, Registrierung und Passwort vergessen, mit Preact auf dem Server                                  |
| `src/i18n`         | Englische Texte                                                                                                                        |
| `web/src`          | Oberfläche mit React und Material UI, nach Bereichen getrennt, die Vorschauen unter `app/files/preview`                                |
| `web/src/theme`    | Farbschema aus dem Theme, Tokens und MUI-Theme                                                                                         |
| `examples/plugins` | Mitgelieferte Plugins als Beispiel und Vorlage                                                                                         |
| `docs/plugins.md`  | Anleitung zum Schreiben von Plugins                                                                                                    |
| `docker/`          | Startskript, Kommandozeile im Container, der Befehl `moecloud` für den Server, Caddyfile und die Ergänzungen für ClamAV und PostgreSQL |
| `test/`            | API-Tests und der Ablauf im Browser                                                                                                    |
| `tools/`           | Übersetzungen und Versionsangaben prüfen, Beispieldaten und Icons                                                                      |
| `cli.ts`           | Befehle für die Kommandozeile                                                                                                          |
| `install.sh`       | Installationsskript, das auch unter moecloud.moestudio.net/install.sh liegt                                                            |

## Support, Mitwirken und Lizenz

Fehler und Ideen gerne als [Issue](https://github.com/MaximilianGT500/moecloud/issues/new/choose) oder Pull Request, siehe [CONTRIBUTING.md](CONTRIBUTING.md). Sicherheitslücken meldest du bitte nicht öffentlich, sondern wie in [SECURITY.md](SECURITY.md) beschrieben. Kontakt gibt es auch über meine [Website](https://m-s.gg).

MoeCloud steht unter der [MIT-Lizenz](LICENSE). Für HEIC nutzt MoeCloud das Paket [libheif-js](https://github.com/catdad-experiments/libheif-js) mit libheif und libde265 unter der LGPL 3.0. Es wird unverändert als eigenes Paket installiert und lässt sich austauschen.
