# Changelog

Alle wichtigen Änderungen an MoeCloud stehen in dieser Datei. Die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

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

[1.1.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.1.0
[1.0.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v1.0.0
[0.1.0]: https://github.com/MaximilianGT500/moecloud/releases/tag/v0.1.0
