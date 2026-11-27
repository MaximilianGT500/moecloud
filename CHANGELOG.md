# Changelog

Alle wichtigen Änderungen an MoeCloud stehen in dieser Datei. Die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

## [1.9.0] · 2026-11-27

Mit dieser Version bekommt MoeCloud einen Kalender mit Aufgaben, Einladungen, Buchungsseiten und Terminumfragen und Adressbücher für deine Kontakte, beides mit CalDAV und CardDAV für Handy und Rechner. Termine und Kontakte aus Google, Apple, Outlook, Nextcloud und anderen Diensten übernimmst du mit wenigen Klicks. Neu dabei sind außerdem ein E-Mail-Postfach im Browser, ein Chat für alle auf dem Server, Lesezeichen, ein Reader für Feeds und Podcasts und Schnipsel zum Teilen von Text und Code. Damit die Oberfläche trotzdem übersichtlich bleibt, fragt MoeCloud beim ersten Anmelden, was jemand nutzen möchte, und die Verwaltung schaltet ganze Bereiche ab. Die Navigation darf auch oben stehen, und auf dem Handy wischst du, ziehst zum Aktualisieren und bekommst Dialoge von unten. Dazu kommen ein Dokumentenscanner, ein Ablaufdatum für Dateien und Ordner, Datei-Uploads in Formularen und Hilfe von MoeStudio direkt in der Verwaltung.

### Neu

- **Kalender** in der Navigation: Tag, drei Tage, Arbeitswoche, Woche, Monat, Jahr und Terminliste, Termine aufziehen und verschieben mit Rückgängig, Schnelleingabe wie „Kaffee mit Mia morgen 15 Uhr #privat“, Wiederholungen nach RFC 5545 mit Ausnahmen, ganztägige Termine, Geburtstage, Fokuszeiten und Abwesenheiten, Zeitzonen pro Termin, mehrere Kalender mit Farben und Standard-Erinnerungen, Feiertage für Deutschland, Österreich, die Schweiz, das Vereinigte Königreich und die USA, Videokonferenzen über Jitsi, Suche, Papierkorb, Statistik und Drucken
- **Aufgaben** mit Fälligkeit, Uhrzeit, Priorität, Fortschritt und Schlagwörtern, als eigene Liste und auf Wunsch zwischen den Terminen
- **Aufgaben als Board** mit den Spalten Offen, In Arbeit und Erledigt. Karten ziehst du mit der Maus in die nächste Spalte oder verschiebst sie über ihr Menü
- **Aufgaben zuweisen**: In geteilten Kalendern legst du fest, wer sich um eine Aufgabe kümmert. Die Person bekommt eine Benachrichtigung, und der Filter **Mir zugewiesen** zeigt, was bei dir liegt
- **Gemeinsam planen**: Kalender mit anderen Konten teilen, nur frei und beschäftigt, mit allen Details oder zum Bearbeiten, Einladungen mit Zusage, Absage und Vielleicht, Gäste ohne Konto per E-Mail mit Kalenderdatei und Antwort-Link und **Gemeinsame Zeit finden** mit Vorschlägen
- **Buchungsseiten** unter `/b/…`: Andere buchen freie Zeiten ohne Konto, mit Verfügbarkeit pro Wochentag, mehreren Dauern, Puffer, Vorlauf, Höchstzahl pro Tag und eigenen Fragen. Gebuchtes steht sofort im Kalender und lässt sich vom Gast selbst absagen
- **Terminumfragen** unter `/u/…` mit Ja, Vielleicht und Nein, auch ohne Konto. Den besten Termin trägst du mit einem Klick ein
- **Öffentliche Kalender und Abos**: Kalender als Seite, zum Einbetten und als ICS-Feed veröffentlichen, Kalender aus dem Netz per iCal- oder webcal-Adresse abonnieren und als ICS, ZIP oder CSV exportieren. Ein Abo machst du mit einem Klick zum eigenen Kalender
- **Kalender aus anderen Diensten übernehmen**: ICS-Dateien, auch mehrere auf einmal, ZIP-Archive aus Google Takeout und von Apple, CSV aus Google und Outlook, eine iCal-Adresse einmalig oder ein ganzes CalDAV-Konto von Nextcloud, iCloud, Fastmail, mailbox.org, Posteo, Radicale und anderen. Eine Vorschau zeigt jeden gefundenen Kalender, und du wählst, was in einen neuen oder vorhandenen Kalender kommt, mit Name und Farbe und was mit schon vorhandenen Terminen passiert. ICS-Dateien aus deinen Dateien übernimmst du mit **In Kalender importieren**
- **Kontakte** in der Navigation: mehrere Adressbücher, Kontakte mit Fotos, Telefonnummern, E-Mail-Adressen, Anschriften, Webseiten, Geburtstagen und Jahrestagen, Labels, Favoriten, Suche, Sortierung nach Vor- oder Nachnamen, Papierkorb und eine Übersicht der nächsten Geburtstage. Adressbücher teilst du mit anderen Konten zum Ansehen oder Bearbeiten
- **Kontakte übernehmen und exportieren**: vCard 2.1, 3.0 und 4.0 von iPhone, Android, Outlook und Thunderbird, CSV aus Google Kontakte und Outlook auf Deutsch und Englisch und ZIP aus Google Takeout, mit Vorschau. Hinaus gehen Adressbücher als vCard oder als CSV für Google. **Doppelte zusammenführen** findet Kontakte mit gleicher E-Mail-Adresse, Nummer oder gleichem Namen und führt sie verlustfrei zusammen
- **CardDAV** unter `/carddav/` für iPhone, Mac, Android mit DAVx⁵ und Thunderbird, mit den App-Passwörtern aus dem Konto. Apps finden die Adresse über `/.well-known/carddav` selbst, unbekannte Felder aus den Apps bleiben erhalten
- **Geburtstage im Kalender**: Die Geburtstage deiner Kontakte stehen von selbst im Kalender, mit Alter und einem Weg zurück zum Kontakt. Beim Einladen schlägt MoeCloud auch Kontakte mit E-Mail-Adresse vor
- **Erinnerungen an Termine und Aufgaben** in der Glocke, als Push und per E-Mail, dazu eine Übersicht per E-Mail, täglich oder für die ganze Woche
- **CalDAV** unter `/caldav/` für iPhone, Mac, Android, Thunderbird und Outlook, mit den App-Passwörtern aus dem Konto. Apps von Apple finden die Adresse über `/.well-known/caldav` selbst
- **Startseite**: neue Bereiche für die nächsten Termine samt offenen Einladungen und für offene Aufgaben
- **E-Mail** in der Navigation: eigene Postfächer per IMAP und SMTP direkt im Browser, mehrere pro Konto, mit Vorgaben für GMX, web.de, Gmail, iCloud, Outlook, Yahoo, Posteo, mailbox.org und andere. Ordner anlegen, umbenennen und löschen, Filter für Ungelesenes, Markiertes und Anhänge, Suche, Archivieren, Verschieben, Papierkorb und Spam. E-Mails erscheinen bereinigt in einem abgeschotteten Rahmen, Bilder aus dem Internet bleiben blockiert, bis du sie lädst oder dem Absender vertraust, und kommen dann über deinen Server. Schreiben mit Cc und Bcc, Anhängen vom Gerät oder aus deinen Dateien, Formatierung mit Markdown, Signatur, Entwürfen, **Später senden** und acht Sekunden zum Zurücknehmen. Anhänge speicherst du in deine Dateien, Einladungen trägst du in den Kalender ein, Absender kommen mit einem Klick zu den Kontakten, und **Als Aufgabe übernehmen** macht aus einer E-Mail eine Aufgabe. Neue E-Mails melden sich in der Glocke, als Push und mit einer Zahl in der Navigation, abschaltbar pro Postfach und unter **Konto** für alle. Das Passwort liegt verschlüsselt auf dem Server
- **Chat** in der Navigation: Nachrichten an einzelne Personen und Gruppen auf deinem Server, live auf allen Geräten, mit Antworten, Reaktionen, Erwähnungen per @, Bearbeiten, Löschen, Dateien und Bildern, Lesemarken, Stummschalten und Anheften. **Notizen an mich** ist eine Ablage nur für dich, für Links, Notizen und Dateien zwischen Handy und Rechner. Neue Nachrichten melden sich in der Glocke, als Push und mit einer Zahl in der Navigation, mehrere hintereinander zusammengefasst. Den Push dafür schaltest du unter **Konto** ab
- **Status** im Kontomenü: verfügbar, beschäftigt, abwesend oder **Nicht stören**, mit Emoji, Text und Ablaufzeit, dazu Vorschläge wie Mittagspause oder Im Urlaub. Der Status erscheint im Chat neben deinem Namen. Solange „Nicht stören“ gilt, hält MoeCloud Push und E-Mails zurück und schickt sie danach gesammelt
- **Lesezeichen** in der Navigation: Links mit Titel, Beschreibung, Symbol und Vorschaubild von der Seite, Schlagwörtern, Notizen und **Später lesen**, als Liste oder Kacheln, mit Suche, Sortierung, Mehrfachauswahl und Wischgesten. Tracking-Anhänge wie `utm_source` fliegen raus, doppelte Links erkennt MoeCloud. **Tote Links finden** prüft im Hintergrund, welche Seiten noch da sind. Import und Export im Format von Chrome, Firefox, Safari und Edge, ein Lesezeichen-Knopf für den Browser und auf dem Handy über **Teilen**. Hat eine Seite einen Feed, abonnierst du ihn gleich mit
- **Feeds und Podcasts** in der Navigation: RSS, Atom und JSON Feed abonnieren, auch nur mit der Adresse der Webseite, in Ordnern sortiert, mit ungelesenen Beiträgen, Favoriten, Suche, Wischgesten, Tastenkürzeln und **Alles als gelesen markieren**. Beiträge erscheinen bereinigt in einem abgeschotteten Rahmen, in deiner Schriftgröße und im passenden Hell oder Dunkel, Bilder kommen über deinen Server, damit die Seiten dich nicht verfolgen. Podcasts spielst du im Browser mit Tempo, Sprüngen und Steuerung vom Sperrbildschirm, MoeCloud merkt sich die Stelle und legt Folgen auf Wunsch in deine Dateien. Neues holt MoeCloud alle halbe Stunde von selbst, Import und Export als OPML
- **Schnipsel** in der Navigation: Text, Befehle und Code mit Farben für über 25 Sprachen aufheben, bearbeiten, als Datei speichern und per Link teilen, auf Wunsch mit Passwort, Ablaufdatum oder als **Einmal-Link**, der sich nach dem ersten Lesen löscht. Die Seite für den Link unter `/t/…` zeigt den Code mit Zeilennummern, zum Kopieren, Herunterladen und als Rohtext
- **Überall suchen** im Schnellzugriff mit Strg+K oder ⌘K: Dateien, Kontakte, Termine, Aufgaben, Chat-Nachrichten, Lesezeichen, Feeds und Schnipsel auf einmal, dazu ein Sprung in die Suche der E-Mails
- **Songtexte** im Musikspieler: Liegt neben einem Lied eine `.lrc`-Datei mit gleichem Namen oder steckt der Text in der Datei, läuft er unter **Songtext** mit. Ein Tipp auf eine Zeile springt an die Stelle
- **Kontakt als QR-Code** im Menü eines Kontakts, zum Abscannen mit der Kamera eines Handys
- **Per E-Mail senden** im Menü von Dateien öffnet eine neue E-Mail mit bis zu 20 Dateien als Anhang
- **Funktionen auswählen** unter **Konto › Funktionen**: Fotos, Musik, Notizen, Formulare, Schlagwörter, Kalender, Aufgaben, Buchungsseiten, Umfragen, Kontakte, E-Mail, Chat, Lesezeichen, Feeds und Schnipsel lassen sich einzeln ausblenden, aus Navigation, Startseite und Schnellzugriff. Die Daten bleiben
- **Admin › Funktionen**: Jede dieser Funktionen schaltet die Verwaltung für alle ab, samt Schnittstellen, Abgleich und öffentlichen Seiten, und legt fest, was neue Konten sehen. Die Daten bleiben und sind beim Einschalten wieder da. Dazu kommt, ob eigene Mailserver erlaubt sind, eine Vorgabe für den Mailserver der eigenen Domain, wie viele Postfächer und Feeds jede Person haben darf und ob MoeCloud Mailserver, Feeds und Seiten im lokalen Netz erreichen darf. Schon bei der Einrichtung fragt MoeCloud, was die Cloud können soll
- **Einführung beim ersten Anmelden**: MoeCloud fragt neue Konten, welche Funktionen sie nutzen möchten, ob die Navigation links oder oben stehen soll und ob es hell oder dunkel sein darf. Unter **Konto** startest du sie noch einmal, und die Verwaltung schaltet sie unter **Admin › Funktionen** ab
- **Navigation oben** unter **Konto › Darstellung**: Auf großen Bildschirmen steht die Navigation auf Wunsch als Leiste über dem Inhalt statt links
- **Besser auf dem Handy**: Dialoge kommen von unten, Listen in E-Mail, Chat, Lesezeichen und Feeds kennen Wischgesten, Dateien und die neuen Bereiche aktualisierst du durch Herunterziehen, und die untere Leiste verschwindet auf Wunsch beim Scrollen. Knöpfe haben auf Touchscreens mehr Fläche, und unter Android schiebt die Tastatur die Seite nach oben, statt Eingabefelder zu verdecken
- **Dokument scannen** unter **Neu**: Seiten mit der Kamera aufnehmen oder als Fotos auswählen, drehen, sortieren, als Dokument, in Graustufen oder in Farbe und als eine PDF im offenen Ordner speichern. Die Fotos verlassen den Browser nicht
- **Ablaufdatum** im Menü von Dateien und Ordnern: Zum gewählten Zeitpunkt wandern sie von selbst in den Papierkorb, mit Benachrichtigung. Eine Sanduhr hinter dem Namen und die Details zeigen das Datum
- **Datei-Upload in Formularen**: eine neue Art von Frage, die pro Antwort eine Datei annimmt, mit Grenze zwischen 1 und 100 MB und auf Wunsch nur bestimmten Dateitypen. Die Dateien landen unter **Formular-Uploads** in deinen Dateien, gehen durch den Virenscan und sind in den Antworten verlinkt
- **Admin › Hilfe**: Nachrichten an MoeStudio direkt aus der Verwaltung, mit Antworten, auf Wunsch mit Diagnose, dazu Hinweise von MoeStudio zu deiner Version und die Prüfung auf Updates mit Changelog
- **Daten an MoeStudio** unter **Admin › System**: Nutzungsstatistik und Fehlerberichte, beide aus, bis du sie einschaltest, mit Vorschau dessen, was gesendet würde, und einem Knopf, der alles Gesendete löschen lässt
- **Admin › Kalender**: Kalender, CalDAV, öffentliche Kalender, Abos, Importe aus anderen Diensten, Buchungsseiten, Umfragen, Einladungen nach außen, die Frei/beschäftigt-Suche und Kontakte einzeln schalten, dazu Papierkorb, Zeitzone und Feiertage für neue Konten

### Verbessert

- Die Versionsprüfung fragt bei MoePulse nach und weiß so auch, ob es für deine Version ein Sicherheitsupdate gibt oder ob sie zurückgezogen wurde. Dabei geht nur die Versionsnummer mit, und antwortet MoePulse nicht, fragt MoeCloud die bisherige `version.json`
- Der Datenexport enthält deine Kalender als ICS-Dateien im Ordner `kalender/`, deine Adressbücher als vCard-Dateien im Ordner `kontakte/`, Lesezeichen als `lesezeichen.html`, Feeds als `feeds.opml` und Schnipsel im Ordner `schnipsel/`. In `konto.json` stehen zusätzlich deine Chat-Nachrichten, dein Status und deine Postfächer ohne Passwörter
- Links, die du auf dem Handy über **Teilen** an MoeCloud schickst, landen bei eingeschalteten Lesezeichen dort statt als `.url`-Datei in den Dateien
- Das Manifest nennt E-Mail, Chat und Kalender als Kurzbefehle für den Startbildschirm
- Beim Löschen einer Person wandern ihre Kalender und Adressbücher mit den Dateien zur gewählten Person
- Unter **Konto › WebDAV und App-Passwörter** steht jetzt auch die Adresse für CalDAV
- Für vCard-Dateien gibt es in den Dateien und in der Vorschau **In Kontakte importieren**
- Neue Benachrichtigungen lassen sich unter **Konto** für Erinnerungen an Termine, Einladungen und Buchungen einzeln schalten

### Behoben

- Die Meldungen beim Ausfüllen von Formularen, etwa „Wähl eine Antwort“ oder „Das ist keine Zahl“, erscheinen auf Englisch jetzt auch auf Englisch

### API

- Kalender unter `/api/calendar/`: `calendars` mit Freigaben, Veröffentlichung, Import und Export, `occurrences?from=&to=` mit allen Wiederholungen, `events` für Termine und Aufgaben samt `rsvp`, `complete`, `duplicate` und Papierkorb, `tasks`, `upcoming`, `search`, `stats`, `freebusy`, `templates`, `subscriptions`, `prefs`, `booking-pages`, `polls`, `export.zip` und `export.csv`. Zeiten gehen in Millisekunden, als `YYYY-MM-DD` oder ISO
- Kalender-Import: `POST /api/calendar/import` mit Dateien als `multipart/form-data` oder JSON `{ "node" }`, `{ "url" }` oder `{ "caldav": { "url", "username", "password" } }`, dazu `GET` und `DELETE /api/calendar/import/:id` und `POST /api/calendar/import/:id/run`. `POST /api/calendar/calendars/:id/detach` macht ein Abo zum eigenen Kalender
- Aufgaben haben `assignee` als ID einer Person, die den Kalender bearbeiten darf, und in `/tasks` ein Objekt mit `id`, `name` und `initials`. `GET /api/calendar/calendars/:id/members` nennt, wer infrage kommt. `GET /api/calendar/people?q=&contacts=1` liefert zusätzlich `contacts`
- Kontakte unter `/api/contacts/`: `books` mit Freigaben, Kontakte mit `photo`, `vcard`, `favorite`, `restore` und `forever`, `labels`, `suggest`, `birthdays?from=&to=`, `duplicates`, `merge`, `move`, `delete`, `trash`, `import` mit `run` und `export?book=&format=csv`
- CalDAV unter `/caldav/` und CardDAV unter `/carddav/` mit HTTP Basic und App-Passwort, öffentlich `/b/:slug`, `/u/:token`, `/p/:token`, `/rsvp/:token`, `/holidays/:region` und `/api/calendar/public/`
- Ablaufdatum: `PUT /api/nodes/:id/expiry` mit JSON `{ "at" }` in Millisekunden oder `null`, Elemente tragen das Feld `expiresAt`
- Formulare: Fragen der Art `file` mit `max` in MB und `accept`, `POST /f/:token` nimmt dafür `multipart/form-data`. Datei-Antworten stehen in `/responses` als `value` mit `name`, `size` und `node` und zusätzlich als `file` mit `name`, `size` und `url`
- Konto: `PATCH /api/account/prefs` kennt `features` mit den ausgeblendeten Funktionen sowie `mailInvites`, `mailBookings`, `pushReminders`, `pushMail`, `pushChat` und `welcome`. `GET /api/home` bringt unter `planning` Termine, Aufgaben und offene Einladungen mit. Den Status liest und setzt `GET`, `PUT` und `DELETE /api/account/status`, die Zahlen für die Navigation liefert `GET /api/badges`
- E-Mail unter `/api/mail/`: `setup`, `accounts` mit `connection`, `order`, `folders`, `messages`, `message`, `body`, `source`, `attachment`, `flags`, `move`, `archive`, `delete`, `save`, `invite`, `drafts` und `send`, dazu `outbox`, `recipients`, `unread` und `senders/trust`. Ohne Zeitpunkt geht eine E-Mail sofort, mit `sendAt` später
- Chat unter `/api/chat/`: `rooms` mit `members`, `settings`, `read`, `messages` und Dateien, `messages/:id` mit `reactions`, dazu `people`, `folder`, `unread` und `search`
- Lesezeichen unter `/api/bookmarks` mit `tags`, `preview`, `remove`, `tag`, `tags/rename`, `visit`, `refresh`, `check`, `import` und `export`
- Feeds unter `/api/feeds` mit `refresh`, `folders/rename`, `import` und `export`, Beiträge unter `/api/feeds/items` mit `read`, `star`, `position`, `body`, `media` und `save`
- Schnipsel unter `/api/snippets` mit `share`, `save` und `raw`, öffentlich `GET /api/public/snippets/:token`, `POST /api/public/snippets/:token/view`, `/t/:token` und `/t/:token/raw`
- Suche über alle Bereiche: `GET /api/search/everywhere?q=`. Songtexte: `GET /api/nodes/:id/lyrics`. Bilder aus E-Mails, Feeds und Lesezeichen kommen über `GET /api/proxy/image` mit signierter, ablaufender Adresse
- Verwaltung: `GET` und `PUT /api/admin/pulse`, `GET /api/admin/pulse/preview`, `POST /api/admin/pulse/forget` und `POST /api/admin/moepulse/support`. Die Einstellungen kennen `calendar.*`, `contacts.enabled`, `photos.enabled`, `music.enabled`, `notes.enabled`, `tags.enabled`, `tasks.enabled`, `webmail.*`, `chat.enabled`, `bookmarks.enabled`, `feeds.*`, `snippets.enabled`, `accounts.features`, `accounts.welcome`, `pulse.stats` und `pulse.errors`, die Einrichtung nimmt `apps` mit den gewünschten Funktionen, `GET /api/admin/updates` nennt unter `latest` zusätzlich `yanked`, `title`, `markdown` und `releases`, das Protokoll die Aktionen `pulse_changed`, `pulse_forgotten` und `support_ticket`
- Benachrichtigungen haben die neuen Arten `event_reminder`, `task_due`, `invitation`, `invitation_updated`, `invitation_cancelled`, `invitation_reply`, `calendar_shared`, `booking_new`, `booking_cancelled`, `poll_vote`, `subscription_failed`, `calendar_import`, `contacts_shared`, `task_assigned`, `node_expired`, `mail_new`, `mail_failed`, `chat_message`, `chat_mention` und `chat_added`, die Live-Ereignisse `events`, `calendars`, `contacts`, `badges`, `mail`, `chat`, `status`, `bookmarks`, `feeds` und `snippets`
- Alle anderen Adressen und Felder bleiben, wie sie sind

### Kleinigkeiten

- Die Datenbank bekommt Stand 13. Vorher legt MoeCloud wie gewohnt eine Sicherung an
- Mit `MOEPULSE_DISABLED=1` oder `MOEPULSE_ENDPOINT=off` ist der Kontakt zu MoeStudio fest aus. `TZ` gibt jetzt auch die Zeitzone neuer Konten im Kalender vor
- Abhängigkeiten auf dem neuesten Stand, darunter MUI 9.6, music-metadata 12.8 und @fastify/rate-limit 11.3. Neu sind imapflow 2.12 für IMAP, postal-mime 4.2 zum Lesen von E-Mails und fast-xml-parser 5.12 für Feeds, nodemailer ist jetzt auf 10.6
- 1660 neue Texte mit englischer Übersetzung
- 699 Tests statt 579, auf SQLite und auf PostgreSQL

### Update von 1.8.0

Mit dem Installationsskript reicht `sudo moecloud update`, mit Docker `docker compose pull` und `docker compose up -d`, mit Git `git pull`, `npm ci` und `npm run build`.

Beim ersten Start sichert MoeCloud die Datenbank nach `data/backups/` und legt danach die Tabellen für Kalender, Termine, Aufgaben, Gäste, Erinnerungen, Vorlagen, Buchungsseiten, Umfragen, Adressbücher, Kontakte, Postfächer, Chats, Lesezeichen, Feeds, Schnipsel und den Status an, dazu zwei Spalten für das Ablaufdatum von Dateien und Ordnern. An deinen Dateien ändert sich nichts.

**E-Mail**, **Chat**, **Lesezeichen**, **Feeds** und **Schnipsel** sind nach dem Update für alle Mitglieder eingeschaltet, Gastkonten haben sie nicht. Unter **Admin › Funktionen** schaltest du jede davon für alle ab. Postfächer und Feeds im lokalen Netz sind gesperrt, bis du das unter **Admin › Funktionen** erlaubst. Vorhandene Konten sehen die Einführung nicht, sie gilt nur für neue.

**Kalender** und **Kontakte** sind nach dem Update für alle Mitglieder da, Gastkonten haben keine. Unter **Admin › Kalender** schaltest du beides ganz ab oder nur einzelne Teile. Die Zeitzone neuer Konten nimmt MoeCloud aus `TZ`, sonst `Europe/Berlin`. CalDAV liegt unter `/caldav/` und CardDAV unter `/carddav/`, denn unter `/dav/` liegen die Dateien. Steht ein Reverse Proxy vor MoeCloud, reicht er `/.well-known/caldav` und `/.well-known/carddav` einfach durch.

**Daten an MoeStudio** bleibt aus, bis du es unter **Admin › System** einschaltest. Die Versionsprüfung fragt ab jetzt zuerst MoePulse unter `pulse.moestudio.net` und schickt dabei die installierte Version mit. Wer das nicht möchte, setzt `MOEPULSE_DISABLED=1`, dann bleibt es bei der `version.json`.

Geprüft ist das Scannen in Chrome mit nachgebildeter Kamera, auf echten Handys noch nicht. CalDAV und CardDAV sind mit nachgebauten Abfragen geprüft, wie sie Apple, DAVx⁵ und Thunderbird schicken, der Import aus einem CalDAV-Konto gegen den eigenen Server. Mit echten Geräten und mit iCloud oder Nextcloud ist beides noch nicht ausprobiert.

## [1.8.0] · 2026-11-22

Diese Version bringt Formulare für Umfragen und Anmeldungen, die jeder über einen Link ausfüllt, und schützt deine Dateien vor Erpressungstrojanern: MoeCloud weist ihre Dateien ab, hält Geräte an, die auffällig viele Dateien ändern, und setzt einen Ordner samt Inhalt auf einen früheren Stand zurück, ohne dabei etwas zu verlieren. Dazu kommen Aufnahmen direkt im Browser, Reaktionen auf Kommentare und das Entpacken von TAR- und GZ-Archiven.

### Neu

- **Formulare** in der Navigation: Umfragen, Anmeldungen und Rückmeldungen, die jeder über einen Link ausfüllt, auch ohne Konto. Acht Arten von Fragen von kurzer Antwort über Datum und Zahl bis Auswahl und Skala, Pflichtfragen, Hinweise und ein Text nach dem Absenden. Ein Formular nimmt Antworten an, bis du es schließt, bis zu einem Zeitpunkt oder bis zu einer Zahl von Antworten, auf Wunsch nur eine pro Person oder nur von angemeldeten Personen mit ihrem Namen
- **Auswertung**: Balken für Auswahlen, Durchschnitt für Skalen und Zahlen, die neuesten Texte, alle einzelnen Antworten und ein Export als CSV, in dem Zellen, die eine Tabellenkalkulation als Formel lesen würde, entschärft sind. Neue Antworten melden sich in der Glocke, mehrere kurz hintereinander als eine Nachricht
- **Auf früheren Stand zurücksetzen** im Menü und in der Kopfzeile eigener Ordner: Du wählst einen Zeitpunkt bis zu 365 Tage zurück, und die Vorschau zeigt, was sich ändert. Dateien bekommen ihren Inhalt von damals als neue Version, alte Namen und Gelöschtes aus dem Papierkorb kommen zurück, und was danach dazukam, wandert in den Papierkorb. Der heutige Stand bleibt dabei als Version oder im Papierkorb erhalten
- **Schutz vor Erpressungstrojanern** unter **Admin › Sicherheit**: Dateien mit Endungen bekannter Erpressungstrojaner wie `.locky` oder `.wncry` und typische Erpresserbriefe nimmt MoeCloud nicht an, auch nicht beim Umbenennen, über WebDAV oder beim Entpacken
- **Auffällig viele Änderungen**: Überschreibt, verschiebt, benennt oder löscht ein Gerät über WebDAV in zehn Minuten mehr vorhandene Dateien als die Grenze, bekommen die Person und die Admins Bescheid, und MoeCloud hält das App-Passwort an. Bis die Person es unter **Konto** wieder freigibt, kann es nur noch lesen. **Dateien zurücksetzen** führt von dort direkt zum Stand kurz davor
- **Aufnehmen** unter **Neu**: Sprachnotizen, Fotos, Videos und den Bildschirm nimmst du direkt im Browser auf, hörst oder siehst sie dir an, benennst sie und speicherst sie im offenen Ordner. Bei Videos wechselst du die Kamera, beim Bildschirm läuft auf Wunsch das Mikrofon mit
- **Reaktionen auf Kommentare**: 👍, ❤️, 😂, 🎉, 😮, 😢, 👀 oder ✅ unter jedem Kommentar, mit der Zahl und den Namen derer, die so reagiert haben
- **TAR, TAR.GZ und GZ**: Die Vorschau zeigt den Inhalt dieser Archive und lädt einzelne Dateien daraus, und **Entpacken** packt sie aus wie ein ZIP. Eine einzelne GZ-Datei wie `Bericht.csv.gz` wird zu `Bericht.csv` daneben. Symbolische Links und Geräte überspringt MoeCloud, harte Links werden zu einer Kopie ohne zusätzlichen Platz auf der Platte

### Verbessert

- Der Datenexport enthält deine Formulare samt Antworten und deine Reaktionen
- Die Sicherheitsprüfung meldet, wenn der Schutz vor Erpressungstrojanern nicht ganz eingeschaltet ist
- Das Protokoll und die Webhooks kennen das Anhalten und Freigeben von Geräten
- Kamera, Mikrofon und Bildschirmfreigabe dürfen die Seiten von MoeCloud jetzt für angemeldete Personen nutzen. Öffentliche Seiten und eingebettete Inhalte dürfen das weiterhin nicht

### API

- Formulare: `GET` und `POST /api/forms`, `GET`, `PATCH` und `DELETE /api/forms/:id`, `POST /api/forms/:id/copy` und `/token`, `GET /api/forms/:id/results`, `/responses` und `/export`, `DELETE /api/forms/:id/responses` und `/responses/:response`. Ausgefüllt werden Formulare ohne Anmeldung unter `/f/:token`
- Zurücksetzen: `GET /api/nodes/:id/rewind?at=` zeigt die Vorschau, `POST` mit JSON `{ "at" }` setzt zurück
- Reaktionen: `POST /api/nodes/:id/comments/:comment/reactions` mit JSON `{ "emoji", "on" }`, Kommentare bringen `reactions` mit
- App-Passwörter: Angehaltene tragen in `GET /api/account` das Feld `paused`, `POST /api/account/app-passwords/:id/resume` gibt sie im Browser wieder frei. Schreibende Anfragen mit einem angehaltenen App-Passwort bekommen `403` mit dem Code `device_paused`, über WebDAV ebenfalls `403`. Namen bekannter Erpressungstrojaner lehnt MoeCloud mit `403` und dem Code `ransomware` ab
- Archive: `GET /api/nodes/:id/archive`, `/archive/entry` und `POST /api/nodes/:id/extract` nehmen auch TAR, TAR.GZ, TGZ und GZ. Bei einer einzelnen GZ-Datei kommt `/archive/entry` ohne `Content-Length`, und `extract` nennt als `folderId` den Ordner, in dem das Archiv liegt
- Verwaltung: Die Einstellungen kennen `forms.enabled`, `security.ransomware`, `security.burst`, `security.burstPause` und `security.burstLimit`, `GET /api/admin/security` nennt `ransomware`, Webhooks das Ereignis `changes_burst` und das Protokoll die Aktionen `device_burst` und `device_resumed`
- Benachrichtigungen haben die neuen Arten `form_response`, `device_burst` und `admin_burst`, die Live-Ereignisse das Ereignis `forms`
- Alle anderen Adressen und Felder bleiben, wie sie sind

### Kleinigkeiten

- Die Datenbank bekommt Stand 12. Vorher legt MoeCloud wie gewohnt eine Sicherung an
- 263 neue Texte mit englischer Übersetzung
- 579 Tests statt 542, auf SQLite und auf PostgreSQL

### Update von 1.7.0

Mit dem Installationsskript reicht `sudo moecloud update`, mit Docker `docker compose pull` und `docker compose up -d`, mit Git `git pull`, `npm ci` und `npm run build`.

Beim ersten Start sichert MoeCloud die Datenbank nach `data/backups/` und legt danach die Tabellen für Formulare, ihre Antworten und Reaktionen an, dazu zwei Spalten für angehaltene App-Passwörter. An deinen Dateien ändert sich nichts.

**Schutz vor Erpressungstrojanern**: Er ist nach dem Update eingeschaltet. Dateien mit Endungen wie `.locky`, die schon da sind, bleiben, neue lassen sich nicht mehr hochladen oder so benennen. Ein Gerät, das über WebDAV regelmäßig sehr viele vorhandene Dateien auf einmal ändert, kann MoeCloud anhalten. Dann gibst du es unter **Konto › WebDAV und App-Passwörter** frei und setzt die Grenze unter **Admin › Sicherheit** höher oder schaltest dort nur das Anhalten ab.

**Formulare** stehen allen Mitgliedern gleich zur Verfügung. Unter **Admin › Einstellungen › Teilen** schaltest du sie ab.

Geprüft ist das Aufnehmen in Chrome mit nachgebildeter Kamera und nachgebildetem Mikrofon. Die Aufnahme des Bildschirms und andere Browser sind noch nicht geprüft. TAR-Archive sind mit selbst gebauten Archiven und solchen von GNU tar in den Formaten GNU, PAX und USTAR geprüft.

## [1.7.0] · 2026-11-20

Diese Version bringt eine Compose-Datei, die alles mitstartet, und macht MoeCloud zu deiner Cloud: zwanzig Themes, sieben Schriften, eine Darstellung nach Maß, eine Navigation und eine Startseite in deiner Reihenfolge, Symbole für Ordner und eine Anmeldeseite mit eigenem Logo und Hintergrund. Dazu kommen Weblinks, eine Übersicht aller Aufgaben aus deinen Notizen, Tempo und Schlummern im Player, Links mit Beginn, Nachricht und eigenem Aussehen, Registrierung mit bestätigter E-Mail-Adresse und das Teilen aus anderen Apps in die Cloud. Außerdem ist MoeCloud mit einer eigenen Testreihe auf Sicherheit geprüft: Was dabei aufgefallen ist, ist behoben, und unter **Admin › Sicherheit** siehst du, wie es um deine eigene Cloud steht. Dort prüfst du auch, ob jede gespeicherte Datei noch unversehrt ist, und beschränkst die Verwaltung auf deine eigenen Netze.

### Neu

- **Alles in einem**: Die neue [`compose.yaml`](compose.yaml) startet MoeCloud zusammen mit Collabora Online, der Office-Vorschau und ClamAV. Nach `docker compose up -d` ist alles verbunden, ohne dass du etwas einträgst. Die `docker-compose.yml` bleibt die schlanke Grundlage für das Installationsskript und für alle, die nur einzelne Dienste dazunehmen
- **Office unter der Adresse der Cloud**: MoeCloud reicht den Editor von Collabora Online jetzt selbst durch, nur an Angemeldete und ohne die Verwaltungsseiten von Collabora. Collabora braucht damit keine eigene Domain, kein eigenes Zertifikat und keinen Port nach außen. Wer beides lieber trennt, gibt Collabora wie bisher eine eigene Adresse
- **Collabora mit dem Skript**: `--collabora`, `--office` und `--all` beim Installieren, `sudo moecloud collabora on` und `off` danach, dazu die Ergänzung `docker/collabora.yml` für die schlanke Compose-Datei
- **Acht neue Themes**: Nordlicht, Mitternacht, Lagune, Zitrone, Sand, Rosenholz, Espresso und Klarblick. Damit sind zwanzig dabei
- **Drei neue Schriften** für eigene Themes: die klare Geist, die gut lesbare Atkinson Hyperlegible und die elegante Fraunces. Alle liegen in MoeCloud selbst
- **Darstellung nach Maß** unter **Konto › Darstellung**: Schriftgröße in vier Stufen, luftige oder kompakte Zeilen, kleine, mittlere oder große Kacheln, ein Farbschimmer im Hintergrund und weniger Bewegung, jeweils pro Browser
- **Navigation anpassen**: Du bringst die Einträge der Seitenleiste in deine Reihenfolge, blendest aus, was du nicht brauchst, und wählst bis zu vier Einträge für die untere Leiste auf dem Handy. Das gilt für dein Konto auf allen Geräten
- **Startseite anpassen**: Die Bereiche der Startseite lassen sich umsortieren und ausblenden
- **Ordnersymbole**: **Symbol** im Menü eines Ordners setzt eines von 28 Symbolen hinein, zusammen mit der Farbe oder ohne
- **Logo und Anmeldeseite** unter **Admin › Einstellungen**: eigenes Logo für Anmeldeseite und Seitenleiste, Hintergrundbild, Überschrift, Begrüßung und die Anmeldung links, in der Mitte oder rechts
- **Weblinks**: **Neu › Neuer Weblink** legt eine Adresse als kleine Datei ab. Ein Doppelklick zeigt, wohin sie führt, und öffnet sie in einem neuen Tab. Verknüpfungen von Windows (`.url`) und macOS (`.webloc`) liest MoeCloud ebenfalls
- **Aufgaben** in den Notizen: eine Übersicht aller Zeilen zum Abhaken aus allen Notizen, mit Haken direkt in der Liste
- **Notizen nebeneinander**: **Beides** zeigt auf breiten Bildschirmen den Text links und die gestaltete Vorschau rechts
- **Tempo und Schlummern** im Player: Wiedergabe zwischen 0,75× und 2×, und ein Schlummern, das nach 15 bis 90 Minuten oder am Ende des Titels leise ausblendet
- **Zuletzt und oft gehört**: MoeCloud zählt deine Wiedergaben, und **Titel sortieren** stellt die zuletzt gehörten, die häufigsten oder die neuesten Titel nach oben
- **Links mit Beginn**: **Gilt ab** schaltet einen Link erst an einem bestimmten Tag frei. Vorher sehen Besucher, ab wann er gilt
- **Nachricht und Aussehen für Links**: eine Nachricht für Besucher über dem Inhalt und ein eigenes Theme für die Seite des Links
- **Registrierung mit bestätigter E-Mail-Adresse**: Wer sich selbst registriert, klickt erst auf einen Link in einer E-Mail. Unbestätigte Konten verschwinden nach 48 Stunden von selbst
- **Registrierung nur für bestimmte Domains**: MoeCloud nimmt auf Wunsch nur E-Mail-Adressen etwa von `firma.de` an und bestätigt sie dann immer
- **Teilen in die Cloud**: Als App installiert, steht MoeCloud im Teilen-Menü anderer Apps. Dateien landen in deinen Dateien, Adressen werden zu Weblinks, Text zur Notiz
- **Kurzbefehle** am Symbol der installierten App für Notizen, Fotos, Zuletzt und Favoriten
- **Sicherheitsprüfung** unter **Admin › Sicherheit**: MoeCloud prüft die Einstellungen, die über die Sicherheit entscheiden, und stellt Dringendes nach oben. Dazu gehören HTTPS, der zweite Faktor der Admins, die Registrierung, die Regeln für Passwörter, App-Passwörter mit Zugriff auf die Verwaltung, Links ohne Schutz, Virenscan, Sicherungen und Updates
- **Gesperrte Anmeldungen freigeben**: Dieselbe Seite zeigt, welches Konto und welche Adresse nach zu vielen Fehlversuchen gerade gesperrt ist, und gibt die Anmeldung mit einem Klick wieder frei
- **Konto absichern** unter **Konto › Sicherheit**: meldet alle anderen Geräte ab, widerruft alle App-Passwörter und pausiert auf Wunsch die eigenen Links, in einem Schritt und nur mit dem Passwort
- **Hinweise bei Änderungen am Konto**: Ein neues Passwort, ein neues App-Passwort, ein Passkey oder eine abgeschaltete Authenticator-App melden sich in der Glocke und per E-Mail
- **Kontakt für Sicherheitsmeldungen**: Mit einer Adresse unter **Admin › Sicherheit** legt MoeCloud `/.well-known/security.txt` an. `/.well-known/change-password` führt Passwortmanager zur richtigen Stelle
- **Passwort für Links erzeugen**: Der Würfel im Passwortfeld erzeugt ein zufälliges Passwort und kopiert es
- **Dateien prüfen** unter **Admin › Sicherheit**: MoeCloud liest jede gespeicherte Datei und vergleicht sie mit ihrer Prüfsumme. Fehlt eine Datei auf der Platte oder stimmt ihr Inhalt nicht mehr, nennt die Seite die betroffenen Dateien und wem sie gehören. Auf Wunsch läuft die Prüfung jede Woche oder jeden Monat nachts und meldet sich bei den Admins, auch als Webhook. Auf der Kommandozeile macht `check --deep` dasselbe
- **Verwaltung nur aus bestimmten Netzen**: Mit einer Liste von Adressen und Netzen unter **Admin › Sicherheit** bleibt die Verwaltung von überall sonst zu, auch für Admins und ihre App-Passwörter. MoeCloud nimmt keine Liste an, die dich selbst aussperrt, und `admin-networks clear` hebt sie auf der Kommandozeile wieder auf
- **Eigenes Passwort bei der nächsten Anmeldung**: Admins verlangen bei einem Konto, dass die Person ihr Passwort bei der nächsten Anmeldung selbst neu festlegt. Bei neuen Konten mit Passwort ist das vorgewählt, beim Import aus CSV gilt es auf Wunsch für alle, und auf der Kommandozeile setzt es `reset-password --change`. Bis dahin öffnet die Anmeldung nur die Seite für das neue Passwort
- **Regeln für Sitzungen** unter **Admin › Einstellungen**: nach wie vielen Tagen ohne Nutzung MoeCloud abmeldet und nach wie vielen Tagen spätestens eine neue Anmeldung fällig ist, auch bei täglicher Nutzung. Beides steht wie bisher auf 30 Tagen
- **Protokoll als CSV**: **Admin › Protokoll** lädt die Ereignisse mit dem gewählten Filter als CSV-Datei. Zellen, die eine Tabellenkalkulation als Formel lesen würde, sind entschärft

### Sicherheit

Für diese Version gibt es eine eigene Testreihe mit 114 Tests in elf Dateien (`test/sec-*.test.ts`). Sie prüft jede einzelne Route ohne Anmeldung, mit fremdem Konto, als Gast und ohne Formular-Kennzeichen, dazu öffentliche Links, hochgeladene Inhalte, Weiterleitungen, Anfragen ins eigene Netz, Pfade, WebDAV und eingeschleuste Eingaben. Dabei ist Folgendes aufgefallen und behoben:

- **Weiterleitung auf fremde Seiten**: Ein Ziel wie `/⇥/boese.example` mit Tabulator, Zeilenumbruch oder Rückstrich führte nach der Anmeldung auf eine fremde Seite. Ziele werden jetzt wie im Browser gelesen und müssen auf der eigenen Adresse bleiben
- **App-Passwörter konnten das ganze Konto übernehmen**: Mit einem App-Passwort ließen sich bisher die E-Mail-Adresse ändern, weitere App-Passwörter anlegen, Passkeys und die Authenticator-App verwalten und als Admin die ganze Verwaltung bedienen. Das alles geht jetzt nur noch im Browser. Die Verwaltung bedient ein App-Passwort nur, wenn du beim Anlegen **Darf die Verwaltung bedienen** ankreuzt
- **E-Mail-Adresse ändern verlangt das Passwort**: Wer kurz an einen offenen Browser kam, konnte bisher die Adresse ändern und sich darüber ein neues Passwort schicken lassen. Die alte Adresse bekommt außerdem einen Hinweis
- **Personensuche verriet E-Mail-Adressen**: Die Suche fand Personen auch über Teile der Adresse, die sich so Stück für Stück erraten ließ. Sie findet jetzt nur noch die ganze Adresse. Gastkonten, die nichts teilen können, bekommen kein Verzeichnis mehr
- **Links gesperrter Konten liefen weiter**: Öffentliche Links gelten nicht mehr, solange das Konto dahinter gesperrt oder abgelaufen ist oder wer den Link angelegt hat, den Ordner nicht mehr bearbeiten darf. Die Freigabe zeigt dann **Ohne Zugriff, außer Kraft**
- **Admins konnten fremde Links umbauen**, etwa das Passwort entfernen. Die Verwaltung kann fremde Links weiterhin löschen, aber nicht mehr ändern
- **Die Passwortseite eines Links nannte den Dateinamen**. Sie zeigt jetzt nur noch die Beschriftung, die du dem Link gibst
- **Links nur zum Hochladen** verrieten, wie viele Dateien schon im Ordner liegen
- **Serverfehler durch besondere Eingaben**: Eine Suche mit einem Null-Zeichen, der Filter `kind=__proto__` und Dateien mit Namen wie `a.constructor` führten zu einem Fehler 500. Der letzte Fall ließ sich auch über einen Link zum Hochladen auslösen
- **Gesperrte Dateiendungen** ließen sich mit einem Punkt am Ende umgehen (`a.exe.`)
- **Zurücksetzen des Passworts ohne eingetragene Adresse der Cloud**: Der Link in der E-Mail folgte der Adresse aus der Anfrage. Ohne eingetragene Adresse nimmt MoeCloud jetzt nur Adressen, über die sich schon ein Admin angemeldet hat
- **WebDAV**: Sehr große, absichtlich kaputte Anfragen hielten den Server sekundenlang auf, und die Tabelle der Sperren konnte beliebig wachsen

Dazu kommen Härtungen ohne bekannten Schaden: Jede Route unter `/api/` verlangt die Anmeldung jetzt an einer zentralen Stelle, bevor sie Eingaben prüft, und `/api/admin/` zusätzlich die Admin-Rolle. Namen mit unsichtbaren Zeichen, die die Schreibrichtung drehen und so eine Endung verstecken, werden abgelehnt. Die Vorschau von E-Mails entfernt Skripte, Formulare und eingebettete Seiten, bevor der Inhalt in den abgeschotteten Rahmen kommt. Antworten der API tragen `Cache-Control: no-store`, und Seiten aus E-Books laufen auch direkt geöffnet abgeschottet.

### Verbessert

- Die Schrift eines Themes wählst du im Editor aus einer Liste, jede in ihrer eigenen Schrift
- Wiedergabelisten und Profilbilder aktualisieren sich in anderen offenen Fenstern sofort
- Der Datenexport enthält die Zählung der Wiedergaben und bei Links Beginn und Nachricht
- Die Verwaltung zeigt bei wartenden Konten, ob die E-Mail-Adresse schon bestätigt ist, und gibt Konten auch ohne Bestätigung frei
- Per E-Mail verschickte Links nennen den Beginn, wenn sie erst später gelten
- **Admin › Einstellungen › Office** warnt, wenn Collabora mit HTTP rechnet und die Cloud über HTTPS läuft oder umgekehrt

### Behoben

- Office: Nennt Collabora in seiner Auskunft einen anderen Port als die eingetragene Adresse, gilt für den Editor jetzt der Port der eingetragenen Adresse
- Umbenennen, neue Textdatei und neuer Weblink: Wer gleich nach dem Öffnen tippt, behält seine Eingabe. Vorher konnte die Vorauswahl im Namensfeld sie teilweise überschreiben

### API

- Ordnersymbole: `PUT /api/nodes/icon` mit JSON `{ "ids": [], "icon" }`, Ordner tragen das Feld `icon`
- Links: `POST /api/nodes/:id/links` und `PATCH /api/links/:id` nehmen `startsAt`, `message` und `theme` an, Links bringen dazu `scheduled` mit. Vor dem Beginn antwortet `/s/:token` mit 404
- Musik: `GET /api/music` nennt `plays` und `playedAt`, `POST /api/music/played` zählt eine Wiedergabe, `DELETE /api/music/played` leert die Zählung
- Notizen: `GET /api/notes/tasks` und `POST /api/notes/:id/tasks`
- Konto: `PATCH /api/account/prefs` nimmt `nav` und `home` an, `GET /api/home` nennt `layout`
- Verwaltung: `PUT` und `DELETE /api/admin/branding/logo` und `/background`, die Bilder liegen unter `/branding/logo` und `/branding/background`. Die Einstellungen kennen `login.title`, `login.text`, `login.layout`, `auth.confirmEmail`, `auth.domains` und `collabora.internal`, Personen bringen `unconfirmed` mit
- Office: `GET /api/admin/office` nennt `builtIn` und `secure`. Passen HTTP und HTTPS nicht zusammen, antwortet das Öffnen mit `503` und dem Code `office_scheme`
- Registrierung: `GET /register/confirm?token=…` bestätigt eine E-Mail-Adresse
- Das Manifest nennt `shortcuts` und `share_target`, `POST /share-target` nimmt Geteiltes an
- Sicherheit: `GET /api/admin/security` liefert die Prüfung mit `items`, `counts`, `lockouts` und `stats`, `POST /api/admin/security/unlock` gibt eine gesperrte Anmeldung frei. Die Einstellungen kennen `security.contact`
- Konto: `POST /api/account/secure` mit JSON `{ "password", "sessions", "appPasswords", "links" }` sichert ein Konto ab. `PATCH /api/account` verlangt für eine neue E-Mail-Adresse das Feld `password` und antwortet sonst mit `400` und dem Code `password_required`
- App-Passwörter: `POST /api/account/app-passwords` nimmt `admin` an, App-Passwörter bringen das Feld `admin` mit. Ohne das Recht antwortet `/api/admin/` mit `403` und dem Code `app_password_scope`. Was nur im Browser geht, antwortet einem App-Passwort mit `403` und dem Code `session_required`: E-Mail-Adresse und Passwort ändern, App-Passwörter anlegen oder fremde widerrufen, Passkeys, Authenticator-App, Sitzungen, SSO-Verbindung und das Löschen des Kontos. Das eigene App-Passwort kann sich weiterhin selbst widerrufen
- Links bringen das Feld `blocked` mit, mit `account`, `access` oder `null`. `PATCH`, `DELETE` und die Aufrufe eines fremden Links antworten Admins mit `404`, zum Löschen bleibt `DELETE /api/admin/links/:id`
- `GET /api/users/search` findet E-Mail-Adressen nur noch ganz und antwortet Gastkonten mit `403`
- Anfragen ohne Anmeldung bekommen auf jeder Route unter `/api/` ein `401`, auch mit ungültigem Körper. Ein Null-Zeichen in Adresse oder Körper führt zu `400`
- Dateien prüfen: `GET /api/admin/integrity` nennt `running`, `last` und `schedule`, `POST` startet die Prüfung, `DELETE` bricht sie ab. Die Einstellungen kennen `integrity.schedule` mit `off`, `weekly` oder `monthly`, Webhooks das Ereignis `files_damaged`
- Verwaltung nur aus bestimmten Netzen: `PUT /api/admin/security/networks` mit JSON `{ "networks" }`, `GET /api/admin/security` nennt `networks` und `address`. Von anderen Adressen antwortet `/api/admin/` mit `403` und dem Code `admin_network`
- Passwortwechsel: `POST /api/admin/users`, `PATCH /api/admin/users/:id` und `POST /api/admin/users/import` nehmen `mustChange` an, Personen bringen das Feld mit. Solange der Wechsel aussteht, antwortet die API einer Anmeldung im Browser mit `403` und dem Code `password_change_required`. Offen bleiben `GET /api/session`, das dann `mustChangePassword` nennt, `POST /api/account/password` und das Abmelden. App-Passwörter arbeiten weiter
- Sitzungen: Die Einstellungen kennen `auth.sessionDays` und `auth.sessionMaxDays`
- Protokoll: `GET /api/admin/audit/export` liefert die Ereignisse als CSV, mit `user` und `action` wie die Liste
- Alle anderen Adressen und Felder bleiben, wie sie sind

### Kleinigkeiten

- Die Datenbank bekommt Stand 11. Vorher legt MoeCloud wie gewohnt eine Sicherung an
- Neue Umgebungsvariablen: `COLLABORA_URL`, `COLLABORA_INTERNAL_URL`, `COLLABORA_WOPI_URL`, für das mitgelieferte Collabora außerdem `OFFICE_HTTPS`, `COLLABORA_TAG` und `OFFICE_DICTIONARIES`
- 397 neue Texte mit englischer Übersetzung
- 542 Tests statt 391, auf SQLite und auf PostgreSQL

### Update von 1.6.0

Mit dem Installationsskript reicht `sudo moecloud update`, mit Docker `docker compose pull` und `docker compose up -d`, mit Git `git pull`, `npm ci` und `npm run build`.

Beim ersten Start sichert MoeCloud die Datenbank nach `data/backups/` und legt danach die Spalten für Ordnersymbole und für Beginn, Nachricht und Theme von Links an, dazu die Tabellen für die Zählung der Wiedergaben und für die Bestätigung von E-Mail-Adressen und das Feld für einen fälligen Passwortwechsel. An deinen Dateien ändert sich nichts.

**App-Passwörter**: Bestehende App-Passwörter von Admins behalten den Zugriff auf die Verwaltung, damit Skripte weiterlaufen. Sie tragen unter **Konto › WebDAV und App-Passwörter** den Zusatz **mit Verwaltung**, und **Admin › Sicherheit** zählt sie auf. Widerruf, was kein Skript braucht, und leg für Laufwerke und Apps ein neues ohne dieses Recht an. Skripte, die über ein App-Passwort die E-Mail-Adresse oder das Passwort eines Kontos geändert haben, müssen das jetzt im Browser tun.

**Links**: Öffentliche Links von gesperrten oder abgelaufenen Konten gelten ab dem Update nicht mehr, bis das Konto wieder freigegeben ist.

Für bestehende Installationen ändert sich nichts von selbst: Die `docker-compose.yml` bleibt schlank, und Collabora, die Office-Vorschau und ClamAV starten nur, wenn du sie dazunimmst. Wer Collabora schon unter einer eigenen Adresse betreibt, behält diese Einrichtung.

Geprüft sind die Wege zu Collabora mit Tests und einem nachgebauten Collabora, mit einem echten Collabora-Server und einem echten Start in Docker noch nicht. Das Teilen aus anderen Apps ist mit einem nachgestellten Aufruf im Browser geprüft, auf einem echten Handy noch nicht.

## [1.6.0] · 2026-11-19

Diese Version macht MoeCloud zum Ort für gemeinsame Arbeit: Teamordner mit eigenem Speicher, Gastkonten für Leute von außen, Office-Dokumente, die du mit Collabora Online im Browser bearbeitest, und Abläufe, die neue Dateien von selbst benennen, einsortieren und umwandeln. Dazu kommen Notizen, ein Bereich für Musik mit Wiedergabelisten, eine Startseite, Profilbilder, Nutzungsbedingungen mit Zustimmung und einiges für die Verwaltung.

### Neu

- **Teamordner** unter **Admin › Teamordner**: Ein Teamordner gehört keiner einzelnen Person und hat eigenen Speicher, der nicht zum Speicher der Mitglieder zählt. Was darin liegt, bleibt, auch wenn jemand das Team verlässt oder ein Konto gelöscht wird. Du nimmst Personen und Gruppen auf, zum Lesen oder Bearbeiten, und gibst einzelnen Personen die Leitung
- **Leitung**: Wer einen Teamordner leitet, nimmt selbst Personen und Gruppen auf, ändert Rechte, Beschreibung und Farbe und verwaltet den Papierkorb. Name und Speicher legen weiter nur Admins fest
- **Papierkorb pro Teamordner**: Was Mitglieder löschen, landet im Papierkorb des Teamordners. Leitung und Admins holen es zurück oder löschen es endgültig
- **Teamordner überall**: Mitglieder finden ihre Teamordner in der Navigation, auf der Startseite und in der Suche, im WebDAV-Laufwerk dann, wenn das App-Passwort es vorsieht. Öffentliche Links aus einem Teamordner gehören zum Team und bleiben, wenn die Person geht, die sie angelegt hat
- **Gastkonten**: Die neue Rolle **Gast** ist ein Konto ohne eigenen Speicher. Gäste sehen nur, was mit ihnen geteilt ist, und die Teamordner, in denen sie Mitglied sind. Eigene Dateien, öffentliche Links und die Leitung eines Teamordners gibt es für sie nicht
- **Einladen von außen**: Einladungen legen auf Wunsch ein Gastkonto an und nehmen die Person gleich in einen Teamordner auf. In den Mitgliedern eines Teamordners schicken Admins die Einladung direkt an eine E-Mail-Adresse
- **Abläufe** im Menü eines Ordners: Ein Ablauf kümmert sich um jede neue Datei, die hochgeladen wird, über einen Link zum Hochladen kommt oder über WebDAV. Er gilt für alle Dateien oder nur für bestimmte Arten, Endungen und Namen, auf Wunsch auch in Unterordnern
- **Aktionen für Abläufe**: Schlagwort vergeben, nach einem Muster wie `{datum} {name}` umbenennen, als PDF oder in einem anderen Bildformat speichern, eine Kopie in einen zweiten Ordner legen, in einen anderen Ordner verschieben und dort in Ordner pro Jahr oder Monat einsortieren, Bilder und Videos in ein Album legen, als Favorit markieren und Bescheid geben. **Jetzt anwenden** schickt einmal alles durch den Ablauf, was schon im Ordner liegt
- **Umwandeln** im Menü einer Datei: Bilder als JPEG, PNG, WebP oder AVIF, Office-Dokumente als PDF. Die neue Datei liegt neben dem Original, das bleibt, wie es ist. Mit mehreren ausgewählten Dateien gehen bis zu 50 auf einmal. Für PDFs braucht MoeCloud LibreOffice
- **Office im Browser**: Mit einem Server für Collabora Online bearbeitest du Word, Excel, PowerPoint und OpenDocument direkt in der Cloud, auch zu mehreren gleichzeitig. Die Adresse trägst du unter **Admin › Einstellungen › Office** ein, MoeCloud zeigt dort, ob Collabora antwortet und welche Formate es bearbeitet. **Neu › Neues Dokument**, **Neue Tabelle** und **Neue Präsentation** legen leere Dateien an. Wer nur ansehen darf, öffnet ohne Schreibrecht, und während du bearbeitest, entsteht eine Version zu Beginn und danach höchstens alle zehn Minuten
- **Notizen**: Ein eigener Bereich mit Liste und Editor für schnelle Notizen. Du schreibst in Markdown, hakst Aufgaben in der Leseansicht ab, sortierst mit Unterordnern in Kategorien und findest alles über das Suchfeld. MoeCloud speichert von selbst und sagt Bescheid, wenn sich eine Notiz an anderer Stelle geändert hat. Jede Notiz ist eine Textdatei im Ordner **Notizen**, mit Versionen, Teilen und WebDAV wie bei jeder anderen Datei
- **Musik**: Der neue Bereich zeigt alle Audiodateien als Titel, nach Alben und nach Interpreten, mit den Angaben und Covern aus den Dateien und einem Suchfeld
- **Wiedergabelisten**: Über **Zur Wiedergabeliste hinzufügen** sammelst du Titel, Alben und ganze Ordner in Listen, änderst die Reihenfolge und spielst sie ab. Jede Liste gibt es als M3U zum Herunterladen, und aus einer `.m3u`- oder `.m3u8`-Datei in der Cloud macht **Als Wiedergabeliste übernehmen** eine Liste
- **App-Passwörter mit Rechten**: Ein App-Passwort darf auf Wunsch **nur lesen**, über WebDAV wie über die API, und bekommt ein Ablaufdatum von 7 Tagen bis zu einem Jahr
- **Teamordner und Geteiltes im Laufwerk**: Mit **Im Laufwerk auch Teamordner und Geteiltes zeigen** erscheinen Teamordner und Freigaben im WebDAV-Laufwerk als Ordner neben den eigenen. Bei gleichen Namen hängt MoeCloud den Namen der Person an. Ohne den Haken zeigt das Laufwerk nur Eigenes, damit Programme, die einen Ordner spiegeln, nichts von anderen löschen
- **Registrierung mit Freigabe**: Mit der neuen Wahl unter **Admin › Einstellungen › Anmeldung** legt sich jede Person selbst ein Konto an und kommt hinein, sobald ein Admin es unter **Admin › Personen** freigegeben hat. Die Admins bekommen eine Benachrichtigung, die Person nach der Freigabe eine E-Mail
- **Notiz beim Teilen**: Beim Teilen mit Personen und Gruppen schreibst du ein paar Worte dazu. Die Empfänger sehen sie in der Benachrichtigung, unter **Geteilt** und in den Details
- **Unbenutzte Konten**: Auf Wunsch sperrt MoeCloud Konten, die eine eingestellte Zahl von Tagen niemand genutzt hat. Admins sind ausgenommen und bekommen eine Nachricht mit den Namen
- **Speicherwarnung für Teamordner**: Ist ein Teamordner zu 90 % voll, bekommt die Leitung eine Benachrichtigung, ohne Leitung die Admins
- **Start**: Eine Übersicht zeigt, was du zuletzt bearbeitet hast, deine Favoriten, was andere mit dir geteilt haben, deine Teamordner, anstehende Erinnerungen, Fotos vom selben Tag aus früheren Jahren und deinen Speicher. Unter **Konto › Profil** legst du fest, ob du nach der Anmeldung dort oder bei deinen Dateien landest
- **Profilbilder**: Unter **Konto › Profil** lädst du ein Bild hoch. Es erscheint überall, wo sonst die Initialen stehen, etwa beim Teilen, in Kommentaren, in der Aktivität und in der Verwaltung
- **Nutzungsbedingungen** unter **Admin › Einstellungen › Rechtliches**: Neben Impressum und Datenschutz gibt es jetzt Nutzungsbedingungen. Auf Wunsch stimmt jede Person dem Text nach der Anmeldung einmal zu, bevor es weitergeht. Die Einstellungen zeigen, wie viele schon zugestimmt haben, und **Alle neu zustimmen lassen** holt die Zustimmung nach einer Änderung noch einmal ein. App-Passwörter und WebDAV laufen dabei weiter
- **Benannte Versionen**: In den Details gibst du einer älteren Fassung einen Namen. Benannte Fassungen räumt MoeCloud nicht von selbst weg, weder über die Zahl pro Datei noch über die Frist in Tagen
- **Startdateien für neue Konten**: Admins machen im Menü eines eigenen Ordners dessen Inhalt zu Startdateien. Jedes neue Konto bekommt eine Kopie davon, etwa eine Anleitung oder Vorlagen
- **Gesperrte Dateiendungen** unter **Admin › Einstellungen › Speicher**: Dateien mit Endungen wie `exe` oder `bat` lassen sich weder hochladen noch so umbenennen, auch nicht über WebDAV oder Links. Beim Entpacken von Archiven überspringt MoeCloud sie
- **Serverprotokoll** unter **Admin › System**: Die letzten 400 Meldungen des Servers seit dem Start, gefiltert nach Fehlern und Warnungen und zum Kopieren
- **Prüfsumme**: Die Details einer Datei zeigen ihre Prüfsumme als SHA-256 zum Kopieren

### Verbessert

- **Verschieben in geteilte Ordner und Teamordner**: Eigene Dateien und Ordner lassen sich jetzt dorthin verschieben und nicht mehr nur kopieren. Sie zählen danach zum Speicher des Ziels. Ist darin noch etwas geteilt oder verlinkt, sagt MoeCloud das und verschiebt nichts. Aus geteilten Ordnern und Teamordnern heraus bleibt es beim Kopieren, damit dort nichts verschwindet, ohne im Papierkorb zu landen
- **Navigation**: Die Leiste beginnt mit **Start**, Teamordner bekommen einen eigenen Eintrag, sobald du in einem bist, dazu kommen **Notizen** und **Musik**. Passt nicht alles auf den Bildschirm, rückt die Leiste zusammen und sammelt den Rest unter **Mehr**, der Bereich, in dem du gerade bist, bleibt sichtbar. Auf dem Handy liegen Start, Dateien, Fotos, Geteilt und dein Konto am unteren Rand
- **Personen importieren** versteht die Rolle `guest`
- **Übersicht in der Verwaltung** und alle Zahlen zu Konten zählen die Speicher von Teamordnern nicht als Personen
- Der Schnellzugriff kennt **Start**, **Teamordner**, **Notizen**, **Musik** und **Teamordner verwalten**
- **Geteilt** zeigt die Notiz einer Freigabe in einer eigenen Zeile unter dem Namen
- Der **Datenexport** enthält auch deine Wiedergabelisten
- Neue Audiodateien merken sich die Nummer des Titels und das Genre aus den Tags

### Behoben

- Die Benachrichtigung über ein neues Konto führte zur Übersicht der Verwaltung statt zu den Personen

### API

- Teamordner: `GET /api/teams`, `GET` und `PATCH /api/teams/:id`, `PUT` und `DELETE /api/teams/:id/people/:member` und `/groups/:member`, `POST /api/teams/:id/leave`, der Papierkorb unter `/api/teams/:id/trash`, für Admins `GET` und `POST /api/admin/teams` und `DELETE /api/admin/teams/:id`
- Abläufe: `GET` und `POST /api/automations`, `PATCH` und `DELETE /api/automations/:id`, `POST /api/automations/:id/run`
- Umwandeln: `GET` und `POST /api/nodes/:id/convert`
- Office: `GET /api/office`, `POST /api/nodes/:id/office/edit` und `/office/new`, für Admins `GET /api/admin/office`. Collabora selbst spricht mit `/wopi/files/:id` und `/wopi/files/:id/contents`
- Notizen: `GET` und `POST /api/notes`, `GET` und `PUT /api/notes/:id`
- Musik: `GET /api/music`, Wiedergabelisten unter `/api/playlists` mit `GET`, `POST`, `PATCH`, `DELETE`, `/items`, `/remove` und `/m3u`, `POST /api/nodes/:id/playlist` liest eine M3U-Datei ein
- App-Passwörter: `POST /api/account/app-passwords` nimmt `readOnly`, `shared` und `expiresAt` an. Ein Passwort nur zum Lesen beantwortet ändernde Anfragen mit `403` und dem Code `read_only`
- Teilen: `POST /api/nodes/:id/grants` und `PATCH /api/grants/:id` nehmen `note` an, `GET /api/shared` nennt sie als `shareNote`
- Konten: `POST /api/admin/users/:id/approve` gibt ein wartendes Konto frei, Personen bringen `pending` und `lastActiveAt` mit, die Rolle `guest` ist neu
- Start: `GET /api/home`
- Profilbilder: `PUT` und `DELETE /api/account/avatar`, `GET /api/avatars/:id`
- Versionen: `PATCH /api/nodes/:id/versions/:version` gibt einer Fassung einen Namen
- Verwaltung: `GET` und `PUT /api/admin/starter`, `GET /api/admin/terms`, `POST /api/admin/terms/renew`, `GET` und `DELETE /api/admin/log`
- `GET /api/nodes/:id` und `/children` nennen bei Teamordnern das Feld `team`, `GET /api/shared` kennzeichnet Teamordner mit `team: true`, `GET /api/nodes/:id/meta` nennt `sha256`, Personen bringen `avatar` mit
- Solange die Zustimmung zu den Nutzungsbedingungen fehlt, antwortet die API bei Anmeldung im Browser mit `403` und dem Code `terms_required`. Anfragen mit App-Passwort sind davon ausgenommen
- Alle bisherigen Adressen und Felder bleiben, wie sie sind

### Kleinigkeiten

- Die Datenbank bekommt Stand 9. Vorher legt MoeCloud wie gewohnt eine Sicherung an
- Abläufe hängen beim Umbenennen eine Zahl an, wenn es den Namen schon gibt
- Meldungen zu vollem Speicher nennen den Teamordner, wenn es um seinen Speicher geht
- 420 neue Texte mit englischer Übersetzung

### Update von 1.5.1

Mit dem Installationsskript reicht `sudo moecloud update`, mit Docker `docker compose pull` und `docker compose up -d`, mit Git `git pull`, `npm ci` und `npm run build`.

Beim ersten Start sichert MoeCloud die Datenbank nach `data/backups/` und legt danach die Tabellen für Teamordner, Abläufe, Wiedergabelisten und die Schlüssel für Office an, dazu Spalten für Profilbilder, die Zustimmung zu den Nutzungsbedingungen, Namen von Versionen, Einladungen für Gastkonten, Rechte und Ablauf von App-Passwörtern, Notizen zu Freigaben und die Freigabe neuer Konten. Deine Dateien, Konten und Freigaben bleiben unverändert. Neue Einstellungen sind zunächst aus: Es gibt keinen Teamordner, keine Pflicht zur Zustimmung, keine gesperrten Endungen, keine Startdateien und kein Office, bis du sie einrichtest.

Eins ändert sich für vorhandene App-Passwörter nicht: Sie zeigen im WebDAV-Laufwerk wie bisher nur deine eigenen Dateien. Für Teamordner und Geteiltes im Laufwerk legst du ein neues App-Passwort mit dem passenden Haken an.

## [1.5.1] · 2026-11-17

Diese Version repariert Installation und Update über das Skript. Es verlangte ein Image mit der Versionsnummer als Tag, das es in der Registry nicht gibt. MoeCloud läuft jetzt immer mit dem Image `latest`.

### Behoben

- Das Installationsskript und `sudo moecloud update` brachen bei **Images laden** ab, weil sie ein Image wie `moecloud:1.5.0` verlangten. In der Registry liegt der neueste Stand als `latest`, und genau dieses Image nimmt das Skript jetzt immer
- Nach einem so abgebrochenen Update blieb die Versionsnummer in der `.env` stehen, und MoeCloud kam nach `sudo moecloud stop` nicht wieder hoch. Die Compose-Datei beachtet `MOECLOUD_VERSION` nicht mehr, und das Skript nimmt die Zeile samt `MOECLOUD_PIN` beim nächsten Update heraus
- `sudo moecloud database postgres` und `sudo moecloud office on` suchten ihre Ergänzung für Docker unter einem Tag im Repository, den es nicht gibt, wenn die Datei auf dem Server noch fehlte. Jetzt kommen beide vom Hauptzweig
- `BREACH_CHECK_URL` aus der `.env` kam mit Docker nicht im Container an

### Installationsskript

- Auf dem Server reicht `sudo moecloud update`, auch wenn dort noch ein älteres Skript liegt. Es holt die neue Compose-Datei, bevor es das Image lädt
- `--version` entfällt beim Skript und bei `sudo moecloud update`, weil es einzelne Versionen nicht als Image gibt. `--version latest` bleibt erlaubt und ändert nichts
- `sudo moecloud status` und die Meldung nach einem Update nennen die Version, die wirklich läuft, statt der Zeile aus der `.env`
- Nennt die Website schon eine neuere Version, als das Image `latest` enthält, sagt das Update dazu, dass GitHub das Image noch baut
- Lässt sich ein Image nicht laden, zeigt das Skript die Meldung von Docker und sagt, dass MoeCloud unverändert weiterläuft

### Docker

- Das Tag des Images steht in `MOECLOUD_TAG` statt in `MOECLOUD_VERSION`, ohne Angabe bleibt es bei `latest`. Wer bei einem Stand bleiben möchte, trägt ein Tag wie `sha-1a2b3c4` ein. `sudo moecloud update` und die automatischen Updates bleiben dann bei diesem Image, `sudo moecloud status` zeigt das an
- README und `.env.example` nennen nur noch Tags, die es gibt

### Kleinigkeiten

- Tests spielen Installation und Update mit Attrappen für Docker und curl durch und prüfen, welches Image das Skript laden würde
- Das README sagt dazu, dass Änderungen an der `.env` erst nach `docker compose up -d` oder `sudo moecloud start` gelten und ein `restart` allein sie nicht übernimmt

## [1.5.0] · 2026-11-17

Diese Version bringt Plugins und Themes: MoeCloud lässt sich um eigene Aktionen, Seiten und Regeln erweitern und bekommt zwölf fertige Themes samt Editor für eigene. Dazu kommen der Umzug von Nextcloud und anderen Speichern per WebDAV, Push direkt im Browser, Erinnerungen, Erwähnungen, Vorlagen und ein Schnellzugriff mit Strg+K. Beim Teilen kommen Wunschadressen, ein Verlauf für jeden Link und ein Knopf zum Melden dazu. Die Vorschau zeigt jetzt E-Books und über LibreOffice auch PowerPoint- und OpenDocument-Dateien. Für die Verwaltung gibt es eine Passwort-Richtlinie, einen Wochenbericht, Sperren für Dateien und Ablaufdaten für Konten.

### Neu

- **Plugins** unter **Admin › Plugins**: Ein Plugin ist ein Ordner mit einer `plugin.json` und etwas JavaScript. Es hängt Aktionen ins Dateimenü, setzt eigene Seiten in die Navigation, prüft Uploads, reagiert auf Ereignisse, beantwortet eigene Adressen, erledigt regelmäßige Aufgaben, schickt Benachrichtigungen und bringt Themes mit. Wie das geht, steht in der [Anleitung für Plugins](docs/plugins.md)
- **Freigabe mit Prüfsumme**: Ein Plugin startet erst, nachdem ein Admin es freigegeben hat. MoeCloud merkt sich dabei eine Prüfsumme über alle seine Dateien, hält das Plugin an, sobald sich eine ändert, und sagt allen Admins Bescheid, auf Wunsch auch über einen Webhook. Seiten von Plugins laufen im Browser abgeschottet und erreichen nur die Routen ihres eigenen Plugins
- **Sechs Beispiele**, die sich in der Verwaltung mit einem Klick hinzufügen lassen: **Statistik** mit eigener Seite, **Upload-Regeln**, **Inhaltsliste**, **Datei-Webhook**, **Briefkasten** und **Farbpaket**
- **Plugins von der Kommandozeile**: `moecloud plugins` zeigt, was im Ordner liegt, gibt frei, schaltet ab, spielt ZIP-Archive ein und entfernt. Im Browser lassen sich Plugins nur hochladen, wenn der Server mit `PLUGIN_UPLOAD=on` läuft
- **Themes**: Zwölf fertige Themes von Moe über Ozean, Wald und Kirschblüte bis Graphit und Terminal. Ein Theme legt Grundfarbe, Stil, auf Wunsch eine zweite und dritte Farbe, Schrift und Ecken fest und gilt auch auf der Anmeldeseite und in geteilten Links
- **Eigene Themes** unter **Admin › Einstellungen › Aussehen**: Der Editor zeigt jede Änderung sofort in der ganzen Oberfläche, mit sieben Stilen, vier Schriften und eigenem CSS für Feinheiten. Themes lädst du als Datei herunter und auf einem anderen Server wieder hoch
- **Theme pro Person**: Erlaubt es die Verwaltung, wählt jede Person unter **Konto › Darstellung** ein Theme aus der Liste oder stellt sich eine eigene Farbe zusammen. Das gilt für ihr Konto auf allen Geräten
- **Schnellzugriff** mit Strg+K oder ⌘K: springt in jeden Bereich, findet Dateien und Ordner, wechselt das Theme und zwischen hell und dunkel
- **Per WebDAV importieren** unter **Neu**: Du gibst die WebDAV-Adresse von Nextcloud, ownCloud oder einem anderen Speicher an, dazu Benutzername und Passwort oder App-Passwort. MoeCloud legt einen Ordner an und holt alles hinein, mit allen Unterordnern und dem Änderungsdatum jeder Datei. Der Import läuft im Hintergrund weiter, zeigt den Fortschritt, lässt sich abbrechen und meldet sich am Ende mit dem, was nicht geklappt hat. Jede Datei geht durch Virenscan und Speichergrenzen, die Zugangsdaten speichert MoeCloud nicht
- **Push im Browser**: Unter **Konto › Push** schaltest du Benachrichtigungen für den Browser ein, in dem du gerade bist. Sie erscheinen auch, wenn MoeCloud nicht offen ist, in Chrome, Edge, Firefox und Safari, auf iPhone und iPad, sobald MoeCloud auf dem Home-Bildschirm liegt. Einen fremden Dienst oder ein Konto braucht es dafür nicht, die Schlüssel erzeugt MoeCloud selbst. Die Seite muss über HTTPS laufen
- **Push aufs Handy** über ntfy oder Gotify: Unter **Konto › Push** trägst du Adresse und Token ein und schickst eine Testnachricht. Push bekommt dieselben Benachrichtigungen wie E-Mail, mit denselben Schaltern. Adressen im lokalen Netz bleiben gesperrt, bis ein Admin sie unter **Admin › Einstellungen** erlaubt, und der Token taucht weder in der Oberfläche noch im Export auf
- **Ruhezeiten**: Unter **Konto** legst du fest, von wann bis wann weder E-Mails noch Push kommen. Danach bekommst du eine Zusammenfassung. Neue Anmeldungen, Schadsoftware und Störungen meldet MoeCloud trotzdem sofort
- **E-Mails gesammelt**: Statt jeder Benachrichtigung einzeln kommt auf Wunsch eine E-Mail am Morgen oder eine am Montag, mit allem, was du noch nicht gelesen hast
- **Erinnerungen**: **Erinnern** im Menü einer Datei oder eines Ordners meldet sich in einer Stunde, heute Abend, morgen früh, nächsten Montag oder zu einer eigenen Zeit, auf Wunsch mit Notiz. Ein Symbol in der Liste zeigt die Erinnerung, die Glocke sammelt alle anstehenden. Sehen kannst nur du sie
- **Erwähnungen**: Mit `@benutzername` sprichst du in einem Kommentar jemanden an, der dort Zugriff hat. Beim Tippen schlägt MoeCloud passende Personen vor, und wer erwähnt wird, bekommt eine eigene Benachrichtigung
- **Beschreibungen** für Dateien und Ordner in den Details, bis 2000 Zeichen. Alle mit Zugriff sehen sie, und die Suche findet den Text
- **Vorlagen**: **Als Vorlagenordner verwenden** im Menü eines Ordners macht seine Dateien zu Vorlagen. **Neu › Neu aus Vorlage** legt daraus eine Kopie im offenen Ordner an, etwa einen Briefkopf oder ein Protokoll
- **Bilder als PDF speichern**: Aus einer Auswahl von Bildern wird eine PDF, jedes Bild eine Seite, in A4 oder so groß wie das Bild. Das passt für fotografierte Belege und Scans
- **Wunschadresse für Links**: Statt der zufälligen Adresse bekommt ein Link auf Wunsch eine eigene wie `/s/urlaub-2026`. Admins schalten das unter **Admin › Einstellungen › Teilen** ab
- **Verlauf für Links**: Im Teilen-Fenster zeigt **Verlauf**, wann ein Link geöffnet wurde, was heruntergeladen oder hochgeladen wurde und ob jemand ein falsches Passwort eingegeben hat, jeweils mit Browser und System. IP-Adressen speichert MoeCloud dafür nicht
- **Erinnerung vor dem Ablauf**: Zwei Tage bevor ein Link abläuft, bekommst du eine Benachrichtigung und kannst das Datum verlängern
- **Inhalt melden**: Auf jeder geteilten Seite können Besucher einen Link melden, mit Grund und freiwilliger Nachricht. Die Meldung geht an alle Admins und steht unter **Admin › Links**, wo du sie erledigst oder den Link gleich pausierst. Abschalten lässt es sich unter **Admin › Einstellungen › Teilen**
- **Downloads über Links melden**: Auf Wunsch sagt MoeCloud Bescheid, wenn jemand über einen Link herunterlädt, höchstens einmal pro Stunde
- **E-Books** im EPUB-Format liest du in der Vorschau, mit Inhaltsverzeichnis und Blättern von Abschnitt zu Abschnitt. MoeCloud merkt sich pro Buch, wo du warst. Der Inhalt läuft abgeschottet ohne Skripte und lädt nichts aus dem Internet
- **Vorschau für PowerPoint, OpenDocument und ältere Office-Dateien** (`.pptx`, `.ppt`, `.odt`, `.ods`, `.odp`, `.doc`, `.xls`, `.rtf`): LibreOffice wandelt sie in eine PDF um, die MoeCloud aufbewahrt, bis sich die Datei ändert. Mit dem Installationsskript schaltet `sudo moecloud office on` das ein, mit Docker die Ergänzung `docker/office.yml`. Beides startet LibreOffice in einem eigenen Container ohne Zugang zum Internet. Mit Node.js genügt ein installiertes LibreOffice
- **Dateien sperren**: Im Menü einer Datei sperrst du sie für eine Stunde, acht Stunden, einen Tag, eine Woche oder bis du sie wieder entsperrst. Andere können sie dann ansehen und herunterladen, aber nicht ändern, umbenennen, verschieben oder löschen, auch nicht über WebDAV oder als Teil eines Ordners. Ein Schloss in der Liste zeigt, wer gesperrt hat. Wem die Datei gehört und Admins können die Sperre lösen, wer gesperrt hat, bekommt dann Bescheid. Aufräumregeln lassen gesperrte Dateien liegen
- **Passwort-Richtlinie** unter **Admin › Einstellungen › Anmeldung**: Die Mindestlänge für neue Passwörter stellst du zwischen 10 und 64 Zeichen ein. Auf Wunsch lehnt MoeCloud Passwörter ab, die schon in einem Datenleck standen. Dafür fragt es bei Have I Been Pwned nach und überträgt nur die ersten fünf Zeichen eines Hashwerts, nie das Passwort
- **Wochenbericht**: Jeden Montagmorgen bekommen alle Admins auf Wunsch eine E-Mail mit Speicher und Zuwachs, Konten, Anmeldungen, neuen Links, offenen Meldungen, Funden des Virenscans, der letzten Sicherung und neuen Versionen
- **Ablaufdatum für Konten**: Unter **Admin › Personen** bekommt ein Konto ein Datum, ab dem die Anmeldung nicht mehr klappt, etwa für Gäste oder Projekte. Eine Woche vorher kommt eine Erinnerung. Danach sind Sitzungen, App-Passwörter und WebDAV gesperrt, bis jemand das Datum verschiebt. Der CSV-Import kennt dafür die Spalte `expires`
- **Eigenes Konto löschen**: Schaltest du das unter **Admin › Einstellungen › Anmeldung** ein, kann jede Person ihr Konto unter **Konto** selbst löschen, bestätigt mit Benutzername und Passwort. Admins bekommen eine Nachricht, den letzten Admin schützt MoeCloud
- **Mehr Speicher anfragen** unter **Speicher** schickt der Verwaltung eine Anfrage samt belegtem Speicher und freiwilliger Nachricht, höchstens einmal am Tag
- Die Details eines Ordners zeigen Größe und Zahl der Dateien und Unterordner samt allem, was darin liegt

### Behoben

- Mit PostgreSQL schlug die Sicherung vor einem Update der Datenbank fehl, und MoeCloud startete danach nicht. Jetzt entsteht sie auf dem Stand vor dem Update, wie mit SQLite
- Änderungen von der Kommandozeile kamen bei einem laufenden MoeCloud erst nach einem Neustart an, etwa der Wartungsmodus oder ein neuer Einrichtungscode. Jetzt gelten sie nach wenigen Sekunden
- Beim Wechsel zwischen hellem und dunklem Design meldete der Browser in der Konsole einen Verstoß gegen die Content-Security-Policy
- Mehrere Hinweise kurz nacheinander stauten sich am unteren Rand. Jetzt ersetzt der neueste die älteren
- README, `SECURITY.md` und der Verhaltenskodex verlinken auf die richtige Adresse `m-s.gg`
- Das Installationsskript bricht bei einer festgehaltenen älteren Version nicht mehr ab, wenn es eine Ergänzung für Docker dort noch nicht gibt

### Kleinigkeiten

- Die Datenbank bekommt Stand 7. Vorher legt MoeCloud wie gewohnt eine Sicherung an
- Wer bisher eine eigene Grundfarbe eingestellt hatte, behält sie. Die Ecken, die du unter **Konto** gewählt hast, bleiben ebenfalls
- Neue Umgebungsvariablen: `OFFICE_URL` für einen eigenen Dienst zur Umwandlung, `SOFFICE_PATH` für den Pfad zu LibreOffice, `BREACH_CHECK_URL` für eine eigene Quelle der Datenlecks oder `off`, dazu `PLUGINS`, `PLUGINS_DIR`, `PLUGIN_UPLOAD` und `PLUGINS_DEV` für Plugins
- Webhooks kennen das neue Ereignis **Plugin angehalten**
- Die Vorlage `.env.example` erklärt jede Variable mit Standard, möglichen Werten und Beispiel
- Abhängigkeiten aktualisiert, darunter Motion 14.14, nodemailer 10.6, music-metadata 12.5 und Playwright 1.65.1
- Hinweise zu Passwörtern nennen überall die eingestellte Mindestlänge
- 515 neue Texte mit englischer Übersetzung

## [1.4.0] · 2026-11-14

Diese Version bringt PostgreSQL als zweite Datenbank, Anmeldung über Single Sign-on und viele neue Funktionen, von Warnungen bei fremden Anmeldungen über Aufräumregeln bis zur Vorschau für E-Mails, Termine und Kontakte. Dazu lädt die Oberfläche spürbar schneller, der Server startet schneller und braucht weniger Speicher.

### Neu

- **PostgreSQL** statt SQLite, wenn du willst: `DATABASE_URL=postgres://…` genügt, MoeCloud legt alle Tabellen selbst an. Die Ergänzung `docker/postgres.yml` startet PostgreSQL 18 als eigenen Container, das Installationsskript fragt danach oder nimmt `--postgres`. SQLite bleibt der Standard
- `moecloud db copy` zieht alle Daten in eine neue Datenbank um, in beide Richtungen, und `moecloud db` zeigt Art, Version, Größe und Stand. Mit dem Installationsskript erledigen `sudo moecloud database postgres` und `sudo moecloud database sqlite` den ganzen Umzug samt Konfiguration
- Sicherungen sind auch mit PostgreSQL SQLite-Dateien aus einem festen Stand und lassen sich mit `db copy` in eine leere Datenbank zurückspielen. Startet MoeCloud mit einem leeren PostgreSQL, während noch eine SQLite-Datei mit Konten daliegt, weist das Log darauf hin
- **Single Sign-on** über OpenID Connect mit Authentik, Keycloak, Authelia, Zitadel, Google oder Microsoft. Unter **Admin › Single Sign-on** trägst du den Anbieter ein und testest die Verbindung. Konten werden über die bestätigte E-Mail-Adresse verknüpft oder auf Wunsch neu angelegt, eine Gruppe vom Anbieter kann Admin-Rechte geben. Unter **Konto** lässt sich die Verknüpfung wieder trennen
- **Aus dem Internet laden** unter **Neu**: MoeCloud lädt eine Datei von einer Adresse im Hintergrund in den Ordner, mit Virenscan und Speichergrenzen, und meldet sich, wenn sie da ist. Adressen im lokalen Netz bleiben gesperrt, auch nach Weiterleitungen
- **An diesem Tag** zeigt in Fotos Bilder vom heutigen Tag aus früheren Jahren
- **Gespeicherte Suchen** merken sich Begriff und Filter und erscheinen über den Treffern und unter der leeren Suchleiste
- Alte Versionen löscht MoeCloud auf Wunsch nach einer festen Zahl von Tagen, einstellbar unter **Admin › Einstellungen › Speicher**
- Mit `BACKUP_COPY_DIR` landet jede Sicherung zusätzlich in einem zweiten Ordner, etwa auf einer anderen Platte. Den Stand zeigt **Admin › Sicherungen**
- `sudo moecloud status` und `doctor` kennen PostgreSQL, `doctor` empfiehlt bei einem Datenordner auf einem Netzlaufwerk den Umzug dorthin
- **Warnung bei neuen Geräten**: Meldet sich jemand von einem Gerät an, das MoeCloud für dein Konto noch nicht kennt, erscheint eine Benachrichtigung mit Browser, System und IP-Adresse, auf Wunsch auch per E-Mail. Meldest du unter **Konto › Sitzungen** alle anderen Geräte ab oder änderst dein Passwort, vergisst MoeCloud die übrigen Geräte
- **Daten exportieren** unter **Konto** lädt alle deine Dateien und eine Übersicht über dein Konto als ZIP herunter. In `konto.json` stehen Profil, Einstellungen, Favoriten, Schlagwörter, Alben, Links, Freigaben, Kommentare und gespeicherte Suchen
- **Aufräumregeln** für Ordner: Dateien, die länger als 7, 14, 30, 90 oder 365 Tage unverändert in einem Ordner liegen, wandern von selbst in den Papierkorb. Das passt zu Ordnern wie Downloads oder Scans. Die Regel gilt auch für Unterordner, und was du wiederherstellst, bekommt wieder die volle Frist
- Im Speicherbericht räumt **Nur eine behalten** doppelte Dateien auf, die älteste Kopie bleibt. **Alle aufräumen** erledigt das für alle Gruppen auf einmal
- **Personen importieren** unter **Admin › Personen** legt viele Konten aus einer CSV-Datei an, mit Komma oder Semikolon, und zeigt vorher, wer angelegt, übersprungen oder abgelehnt wird. Wer kein Passwort hat, bekommt einen Link per E-Mail
- **Standort aus Fotos entfernen**: Wer Fotos über einen Link öffnet oder herunterlädt, bekommt sie ohne GPS-Daten, auch im ZIP. Das klappt bei JPEG, HEIC und WebP ohne Qualitätsverlust, die Originale bleiben unverändert. Abschalten lässt es sich unter **Admin › Einstellungen › Teilen**
- **E-Mails** (`.eml`) zeigt die Vorschau mit Absender, Empfängern, Datum und Anhängen. Der Inhalt läuft abgeschottet ohne Skripte, Bilder aus dem Internet lädt MoeCloud nicht
- **Termine** aus `.ics`-Dateien erscheinen als Liste mit Zeit, Ort und Beschreibung, **Kontakte** aus `.vcf`-Dateien als Karten mit Telefon, E-Mail und Adresse
- **Speicherverlauf** unter **Admin › Übersicht** zeigt, wie viel an jedem Tag belegt war, als Diagramm oder als Tabelle

### Schneller

- Die Dateiansicht lädt beim ersten Aufruf rund 30 % weniger JavaScript. Ansichten, Dialoge, Bildansicht und Player kommen erst, wenn du sie brauchst, die Farbberechnung nur bei eigenen Farben oder mehr Kontrast
- JavaScript und CSS liegen fertig komprimiert vor. Das spart bei Brotli rund 15 % Übertragung und dem Server die Arbeit, jede Datei beim Abruf neu zu packen
- Die Zeitleiste in Fotos nutzt einen eigenen Index. Bei 10.000 Fotos braucht eine Seite statt rund 28 ms nur noch 2 ms, und die Zeit wächst nicht mehr mit der Größe der Bibliothek
- Ordner mit tausenden Einträgen fragen Sterne, Schlagwörter, Freigaben und Zähler mit je einer Abfrage ab statt in Blöcken. Mit PostgreSQL braucht die Liste eines Ordners mit 5.000 Dateien damit rund ein Drittel weniger Zeit
- Vorschaubilder, Bildinfos und Suchtext entstehen auf Servern mit mehreren Kernen parallel, einstellbar mit `PROCESSING_WORKERS`
- Der Speicherbericht zeigt je Gruppe doppelter Dateien höchstens 25 Einträge und die Gesamtzahl. Bei vielen Kopien derselben Datei war die Antwort sonst mehrere Megabyte groß
- Der Server startet rund ein Viertel schneller und braucht im Leerlauf rund 35 MB weniger Speicher, weil Bibliotheken für Passkeys, E-Mail, Bilder, Musik und PDFs erst laden, wenn sie gebraucht werden. Befehle wie `moecloud users` antworten in rund 200 statt 330 ms
- ZIP-Downloads mit vielen kleinen Dateien sind rund ein Viertel schneller
- SQLite hält mehr der Datenbank im Speicher. Suchen mit Filtern und der Speicherbericht sind bei großen Bibliotheken damit bis zu 20 % schneller

### Behoben

- Lädt nach einem Update ein Teil der Oberfläche nicht mehr, weil der Browser noch die alte Seite offen hat, lädt MoeCloud die Seite einmal neu. Bei einem anderen Fehler erscheint eine Meldung mit **Neu laden** statt einer leeren Seite
- Fehlte der Inhalt einer Datei in `data/blobs/` oder war er kürzer als erwartet, beendete ein ZIP-Download den ganzen Server. Jetzt fehlt nur diese Datei im ZIP

### Kleinigkeiten

- Neue Abhängigkeiten: `pg` 8.23.1, `openid-client` 6.9.0 und `postal-mime` 4.2.1, für die Tests `oidc-provider` 9.15.0
- Die Datenbank bekommt Stand 5 mit Tabellen für gespeicherte Suchen, bekannte Geräte, Aufräumregeln und den Speicherverlauf und einer Spalte für die Zeitleiste in Fotos. Vorher legt MoeCloud wie gewohnt eine Sicherung an
- Die Kacheln in **Admin › Übersicht** zeigen große Zahlen mit normalen statt gleich breiten Ziffern
- 199 neue Texte mit englischer Übersetzung

## [1.3.4] · 2026-11-11

Diese Version macht die Ausgabe von `recover` eindeutig.

### Behoben

- Durfte MoeCloud Unterordner von `data/blobs/` nicht lesen, meldete `recover` nur, es gebe nichts zurückzuholen. Jetzt nennt es diese Ordner mit dem Grund und zeigt, für welchen Benutzer die Leserechte fehlen
- `recover` sagt jetzt, wie viele Dateien die Datenbank schon kennt. Kennt sie alle, steht da, dass es nichts zurückzuholen gibt, statt dass der Ordner leer wirkt
- Einzahl und Mehrzahl in der Ausgabe von `recover` stimmen jetzt

## [1.3.3] · 2026-11-11

Diese Version hilft, wenn der Datenordner auf einem Netzlaufwerk oder einem FUSE-Dateisystem liegt.

### Behoben

- Befehle wie `moecloud recover` brachen neben dem laufenden Server mit einem Stacktrace und „locking protocol“ ab, wenn `data/` auf einem Dateisystem liegt, dessen Dateisperren zwischen zwei Prozessen nicht zuverlässig funktionieren. Jetzt erklärt die Meldung den Grund und nennt den Weg mit `docker compose run` bei angehaltenem Server
- `sudo moecloud` fragt in diesem Fall selbst, ob es MoeCloud kurz anhalten, den Befehl ausführen und danach wieder starten soll. Läuft MoeCloud gar nicht, nimmt es gleich einen eigenen Container, statt mit einem Fehler abzubrechen

### Neu

- Liegt der Datenordner auf NFS, SMB, FUSE, 9p, Ceph oder einem Ordner von VirtualBox, warnt MoeCloud beim Start im Log und unter **Admin › System**
- `sudo moecloud doctor` zeigt, auf welchem Dateisystem `data/` liegt, und warnt bei Netzlaufwerken und FUSE

### Kleinigkeiten

- 1 neuer Text mit englischer Übersetzung

## [1.3.2] · 2026-11-11

Diese Version bringt den Befehl `recover`, der deine Dateien zurückholt, wenn die Datenbank verloren ist und keine Sicherung da ist.

### Neu

- `moecloud recover` holt alle Dateien aus `data/blobs/`, die in der Datenbank fehlen, in den Ordner „Wiederhergestellt“ eines Kontos. Ohne Namen nimmt es das einzige Admin-Konto
- Die Art erkennt `recover` am Inhalt, auch bei RAW-Fotos, HEIC, alten Word-, Excel- und PowerPoint-Dateien und Textformaten wie CSV, Markdown und JSON. Sortiert wird nach Art, Bilder und Videos zusätzlich nach Jahr
- Die Namen kommen aus dem Inhalt: Fotos und Videos heißen nach dem Aufnahmedatum, Musik nach Interpret und Titel, Texte, PDFs und Office-Dateien nach ihrer ersten Zeile mit Text, alles andere nach dem Zeitpunkt des Uploads
- Jede Datei prüft `recover` vorher gegen ihre Prüfsumme. `--dry-run` zeigt vorab, was gefunden wird, und ein zweiter Aufruf übernimmt nur, was noch fehlt
- Das Protokoll unter **Admin** zeigt dafür den Eintrag „Dateien wiederhergestellt“ mit Anzahl und Größe

### Kleinigkeiten

- 5 neue Texte mit englischer Übersetzung
- `file-type` 22.3.0 ist jetzt eine direkte Abhängigkeit, bisher kam es nur über `music-metadata` mit

## [1.3.1] · 2026-11-11

Diese Version behebt einen Fehler, durch den MoeCloud nach dem Update auf 1.3.0 auf manchen Servern nicht mehr startete.

### Behoben

- Nach dem Update auf 1.3.0 brach der Start auf manchen Servern mit „database is locked“ ab, und Docker startete den Container immer wieder neu. Die Sicherung vor dem Update brauchte eine Dateisperre auf der neuen Datei in `data/backups/`, und die klappt nicht auf jedem Dateisystem, etwa auf Netzlaufwerken oder FUSE. Die Datenbank blieb dabei unverändert, das Update auf 1.3.1 läuft deshalb ganz normal durch
- Sicherungen kommen jetzt ohne Dateisperren aus. MoeCloud prüft jede Sicherung, bevor sie zählt, und kopiert die Datenbank, wenn der normale Weg scheitert. Das gilt für die Sicherung vor einem Update, die nächtliche Sicherung, die Sicherung unter **Admin › Sicherungen** und `moecloud backup`. Aus demselben Grund konnten auf solchen Servern bisher auch die nächtlichen Sicherungen fehlschlagen
- Scheitert die Sicherung vor einem Update trotzdem, nennt die Meldung im Log den Ordner und den Grund und sagt, dass die Datenbank unverändert bleibt
- Leere und unfertige Sicherungsdateien, wie sie bei den Neustarts entstanden sind, stehen nicht mehr in der Liste der Sicherungen. MoeCloud entfernt sie beim Start und beim nächtlichen Aufräumen, sobald sie älter als zehn Minuten sind

## [1.3.0] · 2026-11-11

Mit dieser Version ordnest du Dateien mit Schlagwörtern und Alben, bearbeitest Bilder und PDFs direkt in der Cloud und hörst Musik in einem eigenen Player mit Warteschlange. Videos zeigen Untertitel und merken sich die Stelle, an der du aufgehört hast. Dazu kommen Suchfilter, Freigaben mit Ablaufdatum, beobachtete Ordner, das Umbenennen vieler Dateien auf einmal, ZIP-Archive aus der Cloud, ein Vergleich von Textversionen und Ordnerbeschreibungen aus einer README.md.

### Ordnen

- Schlagwörter: Eigene Schlagwörter in zehn Farben, vergeben über das Menü oder die Details, auch für mehrere Elemente auf einmal und für Dinge, die andere mit dir teilen. Nur du siehst deine Schlagwörter
- Farbige Punkte hinter dem Namen zeigen die Schlagwörter in Liste und Kacheln, die neue Ansicht **Schlagwörter** in der Navigation listet alle mit Anzahl und zeigt, was dazugehört. Umbenennen, Farbe ändern und Löschen gehen dort direkt
- Alben unter **Fotos**: Bilder und Videos aus beliebigen Ordnern sammeln, ohne sie zu verschieben. Jedes Album hat ein Titelbild, eine Diashow und einen Download als ZIP
- In der Zeitleiste wählst du Fotos jetzt mit einem Kästchen oder langem Druck aus und legst sie in ein Album. In Dateien heißt der Menüpunkt dafür „Zum Album hinzufügen“
- Mehrere Dateien umbenennen: Wählst du mehrere Elemente und drückst F2 oder „Umbenennen“, kannst du Text ersetzen, Text ergänzen, durchnummerieren (wie in der Liste oder nach Aufnahmedatum) oder das Aufnahmedatum voranstellen. Eine Vorschau zeigt jeden neuen Namen, Endungen bleiben, wie sie sind
- Der Server prüft alle neuen Namen, bevor er etwas ändert, und tauscht Namen auch untereinander
- Als ZIP packen: Eine Auswahl aus Dateien und Ordnern wird zu einem ZIP-Archiv im selben Ordner, ganz ohne Download und Upload. Fehlt dir dort das Schreibrecht, landet das Archiv in deinen eigenen Dateien
- Ordnerbeschreibung: Liegt in einem Ordner eine README.md oder LIESMICH.md, zeigt MoeCloud sie formatiert über der Liste, zuerst eingeklappt. Das gilt auch für öffentliche Ordner-Links

### Bearbeiten

- Bilder bearbeiten: Zuschneiden mit freiem oder festem Seitenverhältnis, drehen, spiegeln, verkleinern und als JPEG, PNG, WebP oder AVIF speichern, als Kopie neben dem Original oder als neue Version. Das geht auch mit HEIC und dem eingebetteten Bild von Rohdateien, die Aufnahmedaten bleiben erhalten
- PDF-Werkzeuge: Seiten als Kacheln sehen, umsortieren, drehen, entfernen und ausgewählte Seiten als eigene PDF speichern. Mehrere PDFs fügst du in einer Reihenfolge deiner Wahl zu einer zusammen
- Versionen vergleichen: Bei Text, Markdown, Code, CSV und JSON zeigt „Version vergleichen“ unter **Versionen**, welche Zeilen dazugekommen und welche weggefallen sind
- Der Hinweis „Gespeichert als …“ hat einen Knopf „Zeigen“, wenn die neue Datei in einem anderen Ordner liegt

### Musik und Video

- Musik spielt jetzt in einem Player am unteren Rand, der beim Wechseln der Ansichten weiterläuft. Ein Doppelklick auf einen Titel spielt alle Audiodateien der Ansicht ab diesem Titel, dazu kommen „Abspielen“, „Zur Warteschlange hinzufügen“ und „Alle abspielen“
- Der Player zeigt Titel, Interpret, Album und Cover, kann zufällig abspielen und wiederholen und hat eine Wiedergabe-Ansicht mit Warteschlange. Medientasten und Sperrbildschirm steuern ihn über die Media Session API
- Startet ein Video, pausiert die Musik. Die Warteschlange bleibt nach dem Neuladen erhalten
- Untertitel: Liegt neben einem Video eine Datei wie `Film.srt`, `Film.vtt`, `Film.de.srt` oder `Film.en.vtt`, bietet die Wiedergabe sie als Spur an, die zur Sprache passende zuerst. SRT wandelt der Server in WebVTT um, auch mit Umlauten aus älteren Dateien
- Weiterschauen: Videos ab einer Minute und Audio ab zehn Minuten merken sich die Stelle pro Person, auch über Geräte hinweg. Beim nächsten Öffnen geht es dort weiter, „Von vorn“ startet neu
- In den Kacheln zeigt ein Balken, wie weit du ein Video schon gesehen hast

### Suchen und Teilen

- Suchfilter für Änderungsdatum, Größe und Schlagwort, zusätzlich zu den Arten. Filter funktionieren auch ohne Suchbegriff, etwa für alle Bilder der letzten 30 Tage, und der neue Knopf in der Suchleiste öffnet sie direkt
- Freigaben mit Ablaufdatum: Im Dialog zum Teilen bekommt jede Person und Gruppe ein Ablaufdatum, als Vorgabe oder mit eigenem Datum. Danach endet der Zugriff, und die Aktivität vermerkt das. Unter **Geteilt** steht, bis wann eine Freigabe gilt
- Ordner beobachten: Über das Menü oder die Glocke in der Kopfzeile eines Ordners bekommst du eine Benachrichtigung, wenn andere dort etwas hochladen, ändern oder löschen. Mehrere Änderungen kommen gesammelt in einer Nachricht. Per E-Mail kommt sie nur, wenn du das unter **Konto › Benachrichtigungen** eingeschaltet lässt

### Kleinigkeiten

- Endungen wie `.tar.gz` gelten in der Oberfläche jetzt als eine Endung, wie schon auf dem Server
- Das Fenster mit den Uploads blockiert keine Klicks mehr auf Knöpfe, die unter seinem Rand liegen
- Hinweise, der Knopf „Neu“ und das Fenster mit den Uploads rücken über den Player, solange er zu sehen ist
- Die Beispieldaten haben eine README.md in „Projekte“ und eine ältere Version von „Ideen.md“
- 242 neue Texte mit englischer Übersetzung

### API

- Schlagwörter: `GET` und `POST /api/tags`, `PATCH` und `DELETE /api/tags/:id`, `GET /api/tags/:id/nodes`, `PUT /api/nodes/tags`
- Alben: `GET` und `POST /api/albums`, `GET`, `PATCH` und `DELETE /api/albums/:id`, `POST /api/albums/:id/items`, `POST /api/albums/:id/remove`, `GET /api/albums/:id/zip`
- Bearbeiten: `POST /api/nodes/:id/edit`, `GET /api/nodes/:id/pdf`, `GET /api/nodes/:id/pdf/:page`, `POST /api/nodes/:id/pdf`, `POST /api/pdf/merge`
- Ordnen: `POST /api/nodes/rename`, `POST /api/nodes/zip`, `PUT /api/nodes/:id/watch`
- Wiedergabe: `GET /api/nodes/:id/subtitles`, `GET /api/nodes/:id/vtt`, `GET` und `PUT /api/nodes/:id/position`, für öffentliche Links `GET /api/public/:token/nodes/:id/subtitles` und `/vtt`
- `GET /api/search` versteht `after`, `before`, `minSize`, `maxSize` und `tag`, Freigaben nehmen `expiresAt`
- Listen nennen die neuen Felder `tags`, `progress` und `watching`

### Abhängigkeiten

- Neu sind `@pdfme/pdf-lib` 6.2.8 für die PDF-Werkzeuge und `diff` 9.0.0 für den Vergleich von Versionen, beide unter freien Lizenzen. Alle anderen Abhängigkeiten sind aktuell

### Update von 1.2.0

Mit dem Installationsskript reicht `sudo moecloud update`, mit Docker `docker compose pull` und `docker compose up -d`, mit Git `git pull`, `npm ci` und `npm run build`.

Beim ersten Start sichert MoeCloud die Datenbank nach `data/backups/` und legt danach die Tabellen für Schlagwörter, Alben, Wiedergabestellen und beobachtete Ordner sowie die Spalten für das Ablaufdatum von Freigaben an. Deine Dateien bleiben unverändert.

## [1.2.0] · 2026-11-11

MoeCloud zeigt jetzt Kamera-Rohformate wie DNG vom iPhone, HEIC, TIFF, Photoshop-Dateien und viele weitere Bildformate, dazu Vorschaubilder aus Dokumenten. Öffentliche Links verschickst du direkt aus dem Dialog zum Teilen per E-Mail, und Dateien und Screenshots lädst du mit Strg+V aus der Zwischenablage hoch. Dazu kommen 27 englische Texte, die bisher fehlten, mehr Zurückhaltung in der Aktivität geteilter Ordner und eine Prüfung, die alle Versionsangaben zusammenhält.

### Vorschau

- Kamera-Rohformate bekommen Vorschaubilder und öffnen sich in der Bildansicht: DNG samt ProRAW vom iPhone, CR2, CR3, NEF, ARW, RAF, ORF, RW2 und 18 weitere. MoeCloud nimmt das Vorschaubild, das die Kamera in die Datei gelegt hat, und dreht es richtig
- Rohdateien gelten jetzt als Bilder. Sie erscheinen unter **Fotos** und zeigen Abmessungen, Aufnahmedatum, Kamera, Objektiv und Belichtung. Bisher kannte MoeCloud nur DNG als Bild
- HEIC, HEIF und HIF bekommen Vorschaubild und Anzeige ohne Zusatzprogramme, richtig gedreht und mit umgerechneten Farben für Fotos im Farbraum Display P3
- TIFF öffnet sich in der Bildansicht jetzt in jedem Browser
- PSD, PSB, JPEG XL, JPEG 2000, TGA, DDS, QOI, PCX, PPM, PGM, PBM und SGI zeigt MoeCloud über ffmpeg, BMP und ICO bekommen damit Vorschaubilder
- Für Formate, die Browser nicht selbst zeigen, liefert der Server ein großes Vorschaubild mit bis zu 2560 Pixeln Kantenlänge. Es entsteht beim ersten Öffnen und liegt danach in `data/previews/`
- Dokumente mit eingebettetem Vorschaubild zeigen es in den Kacheln und in der Vorschau: OpenDocument, PowerPoint, Pages, Numbers, Keynote, EPUB mit Titelbild, Comics als CBZ, Krita, OpenRaster, XMind, Sketch, Procreate, 3MF und GeoGebra
- Dateien ohne oder mit unbekannter Endung erkennt MoeCloud am Inhalt als Text, Bild oder PDF. Illustrator-Dateien mit PDF-Inhalt öffnen sich als PDF, Videos mit der Endung `.ts` gelten nicht mehr als TypeScript
- Lässt sich ein Bild nicht laden oder kann der Browser ein Video oder eine Audiodatei nicht abspielen, steht dort ein Hinweis mit dem Knopf zum Herunterladen
- GPX, KML, Untertitel, E-Mail-Dateien und Batch-Dateien öffnen sich als Text
- Kurze Belichtungszeiten wie 1/4000 s stimmen jetzt in den Bildinfos, bisher waren sie gerundet oder fehlten
- Kameras, deren Modellname die Marke schon enthält, heißen nicht mehr doppelt, etwa „Canon EOS R“ statt „Canon Canon EOS R“
- Rohdateien lassen sich nicht drehen, das Original bleibt unverändert
- Neue Routen `GET /api/nodes/:id/preview` und `GET /api/public/:token/nodes/:id/preview` für das große Vorschaubild, Listen nennen dafür das Feld `rendition`

### Teilen

- Öffentliche Links per E-Mail verschicken: Das Brief-Symbol an jedem Link erscheint, sobald der E-Mail-Versand eingerichtet ist
- Die E-Mail nennt deinen Namen, das geteilte Element und das Ablaufdatum, das Passwort eines Links steht nie darin
- Pro Konto gehen höchstens 30 dieser E-Mails in einer Stunde raus, pausierte, abgelaufene und aufgebrauchte Links lassen sich nicht verschicken
- In der Aktivität eines geteilten Ordners steht nur noch für die Person, der er gehört, mit wem er geteilt ist. Links sehen dort nur Personen, die bearbeiten dürfen, und Verschiebungen in Ordner ohne eigenen Zugriff erscheinen nicht mehr

### Dateien

- Dateien und Bilder aus der Zwischenablage hochladen: Strg+V oder ⌘V lädt sie in den offenen Ordner
- Ein eingefügter Screenshot heißt „Eingefügtes Bild“ mit Datum und Uhrzeit
- Die Übersicht der Tastenkürzel nennt das neue Kürzel
- Die Knöpfe an einem Link brechen auf dem Handy sauber um
- Beim Öffnen der Dateien lädt die Liste nicht mehr doppelt
- Dateien, die du ablegst oder einfügst, während ein Ordner noch lädt, landen in diesem Ordner. Bisher erschien die Meldung, dass du dort nichts hochladen darfst

### Übersetzung

- 27 Texte gab es bisher nur auf Deutsch, darunter Meldungen zum vollen Speicher und zu ungültigen Eingaben, die Knöpfe in Benachrichtigungs-E-Mails, die Meldung zu Uploads über einen Link und der Ordner „Von …“ für übergebene Dateien
- Eingaben, die zu lang sind oder unbekannte Felder enthalten, bekommen „Die Eingabe ist ungültig“ statt eines technischen englischen Textes
- `node tools/i18n.ts` findet jetzt auch Texte in Standardmeldungen, Benachrichtigungen und Prüfregeln

### Versionen und Entwicklung

- `node tools/version.ts` prüft, ob `package.json`, `package-lock.json`, Changelog, README, `SECURITY.md` und die Vorlage für Fehlermeldungen dieselbe Version nennen und ob im Changelog keine Version doppelt oder in falscher Reihenfolge steht. Mit einer Version als Angabe trägt es sie überall ein
- `SECURITY.md`, das Beispiel für die `version.json` im README und die Vorlage für Fehlermeldungen nannten noch 1.0.0
- Die CI baut die Oberfläche jetzt vor den Tests, weil 3 Tests sie brauchen, und prüft die Versionsangaben. `npm run check` macht dasselbe in einem Durchlauf
- Doppelte Hilfsfunktionen sind zusammengelegt, etwa die Erkennung von ZIP-Archiven, die Sprache für E-Mails und die Datumsfelder
- Das Installationsskript kommt ohne Kommentarzeile aus
- Abhängigkeiten aktualisiert, darunter Vite 8.3.8, Motion 14.12, nodemailer 10.5 und music-metadata 12.4. Neu ist libheif-js 1.23.5 für HEIC

### Update von 1.1.0

Mit dem Installationsskript reicht `sudo moecloud update`, mit Docker `docker compose pull` und `docker compose up -d`, mit Git `git pull`, `npm ci` und `npm run build`. Der Aufbau der Datenbank ändert sich mit dieser Version nicht. Beim ersten Start ordnet MoeCloud vorhandene Rohdateien als Bilder ein und holt Vorschaubilder und Bildinfos für die neuen Formate im Hintergrund nach, den Fortschritt siehst du unter **Admin › System**.

## [1.1.0] · 2026-11-09

Mit Gruppen teilst du Ordner mit mehreren Personen auf einmal, ZIP-Archive packst du direkt in der Cloud aus, und Links laufen auf Wunsch nach einer festen Zahl an Downloads ab. Admins können die Zwei-Faktor-Anmeldung vorschreiben. Das Installationsskript prüft den Server vorher, hält auf Wunsch eine Version fest und spielt Updates jede Nacht ein, das Docker-Image ist deutlich kleiner.

### Teilen

- Gruppen unter **Admin › Gruppen**, geteilt wird mit ihnen wie mit einzelnen Personen
- Wer neu in eine Gruppe kommt, sieht sofort alles, was mit ihr geteilt ist, wer sie verlässt, verliert den Zugriff
- Teilen geht nur mit Gruppen, in denen man selbst ist, Admins dürfen mit allen
- Unter **Geteilt**, in der Liste und im Detailbereich steht, über welche Gruppe eine Freigabe kommt
- Grenze für Downloads bei Links: nach 1 bis 100 Downloads funktioniert der Link nicht mehr, Ansehen zählt nicht mit
- Besucher sehen auf der Seite des Links, wie viele Downloads noch übrig sind
- Links lassen sich pausieren und wieder freigeben, die Adresse bleibt gleich
- Mehrere Downloads gleichzeitig können die Grenze nicht überschreiten

### Dateien

- ZIP-Archive entpacken in einen neuen Ordner neben dem Archiv, mit Unterordnern und Änderungsdatum
- Jede Datei aus dem Archiv geht durch den Virenscan, Schadsoftware wird übersprungen
- Verschlüsselte Einträge, Pfade aus dem Ordner heraus, Verknüpfungen und Dateien über der Größengrenze überspringt MoeCloud ebenfalls und sagt, wie viele es waren
- Vor dem Entpacken prüft MoeCloud den Speicher der Person und den freien Platz auf dem Server
- Bilder in der Vorschau nach links oder rechts drehen, die alte Fassung bleibt als Version, für JPEG, PNG, WebP, AVIF und TIFF
- Übersicht aller Tastenkürzel mit `?` oder über das Kontomenü

### Sicherheit

- Zwei-Faktor-Pflicht für Admins oder für alle unter **Admin › Einstellungen › Anmeldung**
- Wer noch keinen zweiten Faktor hat, kommt nach der Anmeldung nur in die Kontoeinstellungen, bis eine Authenticator-App oder ein Passkey eingerichtet ist
- Bis dahin funktionieren App-Passwörter und WebDAV für dieses Konto nicht
- Passkeys zählen als zweiter Faktor, die Anmeldung mit Passwort fragt dann nach dem Passkey
- Auch mit Authenticator-App lässt sich die Anmeldung mit einem Passkey bestätigen
- Den letzten zweiten Faktor lässt MoeCloud nicht entfernen, solange die Pflicht gilt
- Die Pflicht lässt sich erst einschalten, wenn das eigene Konto einen zweiten Faktor hat
- Admins entfernen unter **Admin › Personen** alle Passkeys einer Person, auf der Kommandozeile mit `reset-2fa <name> --passkeys`
- Die Personenliste zeigt, wem der zweite Faktor noch fehlt

### Installationsskript

- Prüft vorher Architektur, Arbeitsspeicher, freien Platz, Ports, DNS der Domain und die Verbindung zur Registry, mit `--check` nur das, ohne etwas zu verändern
- `--version 1.1.0` installiert genau diese Version und hält sie fest, `--version latest` hebt das wieder auf
- Zurück auf eine ältere Version geht das Skript nicht, weil sich die Datenbank verändert haben kann
- `--auto-update` spielt Updates jede Nacht zwischen 4 und 5 Uhr ein
- Vor jedem Update sichert es die Datenbank, danach wartet es, bis MoeCloud wieder antwortet, und räumt alte Images auf
- Protokoll in `/var/log/moecloud-install.log`, bei einem Fehler zeigt das Skript die letzten Zeilen daraus
- Ist Port 3000 mit Domain schon belegt, nimmt es den nächsten freien
- Der Link zur Einrichtung kommt direkt aus MoeCloud statt aus den Logs
- Neue Befehle auf dem Server: `moecloud status`, `moecloud doctor`, `moecloud auto-update` und `moecloud uninstall`
- `moecloud logs` und `moecloud restart` nehmen auch andere Dienste wie `caddy` oder `clamav`

### Docker

- ffmpeg kommt als statisches Programm ins Image, die Abhängigkeiten nur für die Zielplattform und ohne Typen, Source-Maps und Dokumentation
- Die Abhängigkeiten für arm64 werden nicht mehr emuliert installiert, das beschleunigt den Build
- `MOECLOUD_VERSION` legt den Tag des Images fest, `.env.example` hat den neuen Eintrag
- Der Health-Check prüft nach dem Start alle 2 Sekunden, MoeCloud und Caddy sind dadurch schneller bereit
- Der Container geht beim Start nur noch durch alle Dateien im Datenordner, wenn bei den Besitzrechten oben etwas nicht passt
- Caddy läuft mit `no-new-privileges`
- Images mit SBOM und Herkunftsnachweis, die CI prüft außerdem Compose-Dateien, das Installationsskript und den Start im Container

### Update von 1.0.0

Mit dem Installationsskript reicht `sudo moecloud update`, dabei kommt auch der neue Befehl `moecloud` mit `status`, `doctor` und `auto-update`. Mit Docker Compose holst du die neue [`docker-compose.yml`](docker-compose.yml) und startest `docker compose pull` und `docker compose up -d`. Mit Git reichen `git pull`, `npm ci` und `npm run build`.

Beim ersten Start sichert MoeCloud die Datenbank nach `data/backups/` und legt danach die Tabellen für Gruppen und die Spalten für Grenze und Pause von Links an.

## [1.0.0] · 2026-11-08

MoeCloud prüft Uploads auf Schadsoftware, zeigt viel mehr Dateien in der Vorschau und sortiert deine Fotos nach Aufnahmedatum. Dazu kommen Kommentare, Aktivität, Benachrichtigungen und E-Mails, eine neue Verwaltung mit Protokoll und Sicherungen und ein Skript, das MoeCloud mit einem Befehl installiert.

### Virenscan

- Prüfung jeder Datei mit ClamAV, bevor sie gespeichert wird: aus der Weboberfläche, über Links zum Hochladen, per WebDAV, über die API und beim Speichern von Texten
- Befallene Dateien werden abgewiesen, der Fund landet im Protokoll und bei den Admins
- Vorhandene Dateien lassen sich von Hand oder in einem festen Abstand erneut prüfen
- Was dabei auffällt, wird gesperrt und lässt sich weder öffnen noch herunterladen oder teilen, bis ein Admin es freigibt oder löscht
- Einstellbar sind Verbindung über TCP oder Unix-Socket, die größte geprüfte Datei und was passiert, wenn ClamAV nicht antwortet
- Verbindungstest mit der EICAR-Testdatei

### Vorschau

- Markdown gesetzt mit Tabellen und Aufgabenlisten, auf Wunsch als Quelltext
- Code mit Hervorhebung für mehr als 30 Sprachen und Zeilennummern, JSON eingerückt
- CSV- und Excel-Dateien als Tabelle, Excel mit allen Blättern
- Word-Dokumente mit Seiten
- ZIP-Archive mit ihrem Inhalt, einzelne Dateien daraus lassen sich herunterladen
- Schriften zum Ausprobieren mit eigenem Text
- Vorschaubilder für Videos, PDFs und Musik mit Cover, sofern ffmpeg und Poppler installiert sind
- Bildansicht mit Zoom per Mausrad und Doppelklick, Kamera, Objektiv, Belichtung und Diashow
- Informationen zur Datei direkt in der Vollbildansicht, Wischen zur nächsten Datei

### Neue Bereiche

- Fotos mit allen Bildern und Videos nach Monaten, sortiert nach dem Aufnahmedatum aus den EXIF-Daten
- Speicher mit Aufteilung nach Art, den größten Dateien und doppelten Dateien
- Aktivität mit allem, was in deinen Ordnern passiert ist
- Zehn Farben für Ordner
- Suche im Inhalt von Texten, PDFs und Office-Dokumenten, mit Filter für Dokumente und der passenden Stelle im Treffer

### Zusammenarbeit

- Kommentare an Dateien und Ordnern, mit Benachrichtigung für alle, die dabei sind
- Aktivität für jede Datei und jeden Ordner im Detailbereich
- Glocke mit neuen Freigaben, Kommentaren, Uploads über Links und Hinweisen zum Speicher, für Admins auch mit Meldungen zum System
- Links zum Hochladen melden auf Wunsch, wenn etwas ankommt

### E-Mail

- Versand über einen eigenen SMTP-Server, mit Test-E-Mail und Startwerten aus Umgebungsvariablen
- „Passwort vergessen“ auf der Anmeldeseite
- Links zum Zurücksetzen von der Verwaltung, auch statt eines Passworts für neue Konten
- Einladungen per E-Mail
- Jede Person wählt im Konto, welche Benachrichtigungen auch per E-Mail kommen

### Konto

- Sicherheitsprotokoll mit Anmeldungen, Fehlversuchen und Änderungen am Zugang
- Alle eigenen Dateien als ZIP herunterladen
- Neue Navigation auf dem Handy mit Fotos und schnellem Zugriff auf Favoriten, Aktivität, Speicher und Papierkorb

### Verwaltung

- Neu aufgeteilt in Übersicht, Personen, Einladungen, Links, Protokoll, Virenscan, E-Mail, Webhooks, Sicherungen, Einstellungen und System
- Übersicht mit dem Zustand von E-Mail, Virenscan, Sicherungen, Verarbeitung und Anmeldungen, Speicher nach Art und wer am meisten belegt
- Protokoll mit Anmeldungen, Fehlversuchen, Änderungen der Verwaltung und Funden des Virenscans, filterbar nach Bereich und Person
- Alle öffentlichen Links aller Personen an einem Ort
- Beim Löschen einer Person lassen sich ihre Dateien an jemand anderen übergeben
- Sicherungen der Datenbank jede Nacht, auf Knopfdruck und vor jedem Update, mit Download
- Wartungsmodus und Hinweise für alle
- Versionsprüfung mit Hinweis auf neue Versionen und dem passenden Befehl zum Aktualisieren
- Webhooks für Discord, Slack, Matrix, Telegram, ntfy und eigene Empfänger mit HMAC-Signatur
- Metriken für Prometheus unter `/metrics`
- Aufbewahrung für Protokoll und Aktivität einstellbar

### Betrieb

- Installationsskript: `curl -fsSL https://moecloud.moestudio.net/install.sh | sudo bash` richtet MoeCloud mit Docker ein, auf Wunsch mit Domain, Caddy und ClamAV, danach aktualisiert `sudo moecloud update`
- Das Docker-Image bringt ffmpeg und Poppler für die Vorschaubilder mit
- `docker/clamav.yml` startet ClamAV neben MoeCloud
- Neue Befehle `maintenance`, `scan-test`, `scan`, `mail-test`, `process`, `reindex` und `version`
- Neue Umgebungsvariablen für ClamAV, SMTP, Metriken, Versionsprüfung und die Programme für Vorschauen, Vorlage in `.env.example`
- Website mit Kurzanleitung und Changelog unter [moecloud.moestudio.net](https://moecloud.moestudio.net)

### Update von 0.1.0

Den neuen Stand holen und MoeCloud neu starten. Mit Docker reicht `docker compose pull` und `docker compose up -d`, mit Git `git pull`, `npm ci` und `npm run build`.

Beim ersten Start sichert MoeCloud die Datenbank nach `data/backups/` und ergänzt danach die neuen Tabellen. Vorhandene Dateien werden im Hintergrund für Vorschau, Fotos und Suche eingelesen. Für den Virenscan ClamAV starten und unter **Admin › Virenscan** einschalten, für E-Mails den Versand unter **Admin › E-Mail** einrichten.

## [0.1.0] · 2026-11-08

Die erste Version.

### Dateien

- Hochladen per Drag & Drop oder über „Neu“, auch ganze Ordner mit Unterordnern
- Uploads in Teilen von 16 MB, die nach einem Verbindungsabbruch an derselben Stelle weiterlaufen
- Abfrage bei gleichen Namen mit „Beide behalten“ und „Ersetzen“
- Liste und Kacheln mit Vorschaubildern, Detailbereich und Pfadleiste als Ziel für Drag & Drop
- Ansicht für Bilder, Videos, Audio, PDFs, Texte und Code, Texte lassen sich direkt bearbeiten
- Versionen mit Wiederherstellen, Herunterladen und Löschen
- Papierkorb mit automatischem Aufräumen nach einstellbarer Frist
- Favoriten, Zuletzt und Suche nach Namen mit Filtern
- Download von Ordnern und mehreren Elementen als ZIP
- Tastenkürzel und Bedienung per Tastatur
- Änderungen erscheinen live auf allen offenen Geräten

### Teilen

- Freigaben für andere Konten mit „Kann ansehen“ und „Kann bearbeiten“
- Öffentliche Links mit Bezeichnung, Passwort, Ablaufdatum, QR-Code und Zählern
- Links nur zum Hochladen, um Dateien von anderen einzusammeln
- Vorschau geteilter Links in Messengern

### Konto und Sicherheit

- Anmeldung mit Passwort, Authenticator-App mit Wiederherstellungscodes und Passkeys
- App-Passwörter für WebDAV und Skripte
- Übersicht der Sitzungen mit Abmelden einzelner Geräte
- Darstellung mit Hell, Dunkel, System, Kontrast, Ecken und echtem Schwarz
- Deutsch und Englisch

### Verwaltung

- Einrichtung im Browser mit Einrichtungscode, ohne `.env`
- Übersicht über Speicher, Personen und Laufzeit
- Personen anlegen, bearbeiten, sperren und löschen
- Einladungslinks mit Gültigkeit und eigenem Speicher
- Einstellungen für Registrierung, Speicher, Teilen, Farben und rechtliche Seiten

### Betrieb

- WebDAV unter `/dav/` für Explorer, Finder, Linux und rclone
- API mit HTTP Basic und App-Passwort
- Docker-Image für `amd64` und `arm64`, ohne root, mit Health-Check und Caddy-Profil
- Kommandozeile für Konten, Sicherung, Aufräumen und Prüfen
- Gleiche Dateien liegen nur einmal auf der Platte

[1.9.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.9.0
[1.8.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.8.0
[1.7.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.7.0
[1.6.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.6.0
[1.5.1]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.5.1
[1.5.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.5.0
[1.4.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.4.0
[1.3.4]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.3.4
[1.3.3]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.3.3
[1.3.2]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.3.2
[1.3.1]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.3.1
[1.3.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.3.0
[1.2.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.2.0
[1.1.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.1.0
[1.0.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.0.0
[0.1.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v0.1.0
