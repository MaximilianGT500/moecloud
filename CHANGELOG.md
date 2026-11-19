# Changelog

Alle wichtigen Änderungen an MoeCloud stehen in dieser Datei. Die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

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
