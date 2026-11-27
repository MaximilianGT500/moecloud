# Sicherheit

MoeCloud verwaltet Dateien, Konten und Zugangsdaten. Wenn du eine Sicherheitslücke findest, hilft eine vertrauliche Meldung allen, die MoeCloud betreiben.

## Unterstützte Versionen

Sicherheitsupdates gibt es für die neueste Version. Aktualisiere am besten bald nach jeder neuen Version, wie das geht, steht in der [Anleitung](README.md#updates).

| Version | Sicherheitsupdates |
| ------- | ------------------ |
| 1.9.x   | Ja                 |
| Älter   | Nein               |

## Eine Lücke melden

Melde Sicherheitslücken bitte nicht öffentlich als Issue, sondern vertraulich:

- über **Security › Report a vulnerability** in diesem Repository oder
- über das [Kontaktformular](https://m-s.gg).

Hilfreich sind:

- die Version von MoeCloud und die Art der Installation (Installationsskript, Docker oder Node.js)
- welche Rolle für den Angriff nötig ist, etwa kein Konto, ein normales Konto, ein Link oder ein Admin-Konto
- die Schritte, mit denen sich die Lücke nachstellen lässt, und was jemand damit erreichen kann
- auf Wunsch ein Vorschlag, wie sich die Lücke schließen lässt

Schick dabei keine echten Passwörter, Tokens oder Dateien anderer Personen mit und teste nur auf deiner eigenen Installation.

## Wie es weitergeht

Du bekommst eine Rückmeldung, sobald die Meldung geprüft ist. Bestätigt sich die Lücke, erscheint so bald wie möglich eine neue Version. Sie ist bei MoePulse und in der [`version.json`](https://moecloud.moestudio.net/version.json) als Sicherheitsupdate markiert, damit alle Installationen mit eingeschalteter Versionsprüfung einen Hinweis zeigen, auch unter **Admin › Hilfe**. Erst danach steht die Lücke im [Changelog](CHANGELOG.md), auf Wunsch mit deinem Namen.

## Sicher betreiben

- Sieh unter **Admin › Sicherheit** nach, was MoeCloud an deiner Einrichtung bemängelt, und trag dort eine Adresse für Sicherheitsmeldungen ein.
- Betreib MoeCloud im Internet nur hinter HTTPS, siehe [Mit eigener Domain und HTTPS](README.md#mit-eigener-domain-und-https).
- Lass die Registrierung geschlossen und lade Personen über Einladungslinks ein.
- Richte für Admin-Konten eine Authenticator-App oder einen Passkey ein.
- Gib App-Passwörtern den Zugriff auf die Verwaltung nur für Skripte, die ihn brauchen, und widerruf sie, wenn das Skript wegfällt.
- Beschränk die Verwaltung unter **Admin › Sicherheit** auf dein Heimnetz, dein Büro oder dein VPN, wenn du sie von unterwegs nicht brauchst.
- Gibst du jemandem ein Passwort selbst, verlang bei der nächsten Anmeldung ein eigenes.
- Schalte den [Virenscan](README.md#virenscan-mit-clamav) ein, sobald andere Dateien hochladen.
- Lass die [Versionsprüfung](README.md#versionsprüfung) an und spiel Updates zeitnah ein.
- Bewahre [Sicherungen](README.md#datensicherung) so sicher auf wie den Server selbst. Sie enthalten Passwort-Hashes und die Schlüssel der Authenticator-Apps.
- Lass den Schutz vor Erpressungstrojanern unter **Admin › Sicherheit** an, samt Anhalten von Geräten. Kommt eine Nachricht über auffällig viele Änderungen, gib das Gerät erst frei, wenn du weißt, woher sie kamen, und setz den Ordner sonst auf den Stand davor zurück.
- Lass unter **Admin › Sicherheit** regelmäßig die gespeicherten Dateien prüfen. So merkst du, wenn ein Datenträger Dateien verliert oder verändert, solange die Sicherung sie noch hat.
- Schalte nur [Plugins](README.md#plugins) ein, deren Code du gelesen hast oder deren Quelle du vertraust. Sie laufen mit allen Rechten von MoeCloud. Lass `PLUGIN_UPLOAD` aus, solange du Plugins nicht im Browser einspielen musst.
- Schau ab und zu ins Protokoll unter **Admin › Protokoll**, dort stehen auch fehlgeschlagene Anmeldungen.
- Lass Mailserver, Feeds und Seiten im lokalen Netz unter **Admin › Funktionen** gesperrt, solange niemand sie braucht. Sonst kann jedes Konto über MoeCloud Dienste in deinem Netz ansprechen.

## Wie MoeCloud geprüft wird

Zu jeder Version läuft eine eigene Testreihe für die Sicherheit (`test/sec-*.test.ts`, mit `npm test`). Sie ruft jede Route ohne Anmeldung, mit fremdem Konto, als Gast, mit einem App-Passwort und ohne Formular-Kennzeichen auf und prüft öffentliche Links, hochgeladene Inhalte, Weiterleitungen, Anfragen ins eigene Netz, Pfade, WebDAV, CalDAV, CardDAV, Kalender, Kontakte, Buchungsseiten, Umfragen und eingeschleuste Eingaben. Für E-Mail, Chat, Lesezeichen, Feeds und Schnipsel prüfen eigene Tests, dass jede Person nur ihre eigenen Daten sieht, dass HTML aus E-Mails und Feeds ohne Skripte in einem abgeschotteten Rahmen landet und dass abgeschaltete Funktionen auch über die Schnittstellen nicht mehr erreichbar sind. Eine neue Route ohne Einordnung lässt die Tests scheitern. Das ersetzt keine Prüfung von außen: Wer MoeCloud für Vertrauliches einsetzt, lässt die eigene Einrichtung am besten zusätzlich von jemandem prüfen, der sie nicht gebaut hat.

## Bewusste Grenzen

- Admins sehen in der Verwaltung alle öffentlichen Links samt Adresse, können Passwörter anderer neu setzen und Dateien übertragen. Das steht jeweils im Protokoll. Ein Admin ist damit jemand, dem alle Mitglieder vertrauen müssen.
- Die Version steht in `/healthz` und im Quelltext geteilter Seiten, auch für Unangemeldete.
- Sperren nach Fehlversuchen und die Beschränkung der Verwaltung auf bestimmte Netze stützen sich auf die Adresse, die MoeCloud sieht. Geräte, denen MoeCloud die Angaben eines Proxys glaubt, in der Voreinstellung der eigene Rechner und das lokale Netz, können eine andere Adresse angeben. Wer das ausschließen will, trägt in `TRUST_PROXY` nur die Adresse des eigenen Proxys ein.
- Ein fälliger Passwortwechsel gilt für die Anmeldung im Browser. App-Passwörter des Kontos arbeiten weiter, bis du sie widerrufst.
- Der Schutz vor Erpressungstrojanern erkennt bekannte Endungen und Erpresserbriefe und zählt Änderungen pro App-Passwort. Ein Trojaner mit neuer Endung, einer, der nur wenige Dateien auf einmal ändert, oder einer, der im Browser angemeldet ist, fällt damit nicht auf. Er ersetzt keine Sicherung, und **Auf früheren Stand zurücksetzen** holt nur zurück, wovon es noch eine Version oder einen Eintrag im Papierkorb gibt.
- Wer ein Formular ausfüllen darf, entscheidet allein der Link. Er verrät nichts über deine Dateien, aber jeder, der ihn kennt, kann antworten. Antworten ohne Konto lassen sich nicht einer Person zuordnen. Hat das Formular eine Frage zum Datei-Upload, legt jeder mit dem Link Dateien in deinen Speicher, bis zur Grenze der Frage und solange Platz ist. Ist der Virenscan an, prüft er sie.
- Buchungsseiten zeigen jedem mit dem Link, wann du frei bist. Terminumfragen zeigen allen mit dem Link die Namen und Stimmen der anderen, außer du blendest sie in der Umfrage aus. Einladungen an Gäste ohne Konto enthalten einen Link, mit dem jeder antworten kann, der die E-Mail hat.
- Abonniert oder importiert jemand einen Kalender aus dem Netz, ruft MoeCloud dessen Adresse ab, bei Abos regelmäßig. Adressen im lokalen Netz sind dabei gesperrt, solange die Verwaltung sie unter **Admin › Kalender** nicht erlaubt. Beim Import aus einem CalDAV-Konto schickt MoeCloud Benutzername und Passwort nur an diesen Server und folgt Weiterleitungen nur innerhalb derselben Domain. Die Zugangsdaten bleiben nur für die Dauer des Imports im Speicher und landen weder in der Datenbank noch im Protokoll.
- Wer ein Adressbuch zum Bearbeiten geteilt bekommt, kann darin alles ändern und löschen, auch über CardDAV. Gelöschtes bleibt im Papierkorb, bis er geleert wird. Ein App-Passwort mit **Nur lesen** ändert auch an Kontakten nichts.
- Links nur zum Ansehen verhindern das Herunterladen in der Oberfläche. Wer eine Datei ansehen darf, kann ihren Inhalt technisch immer auch speichern.
- Die Passwörter verbundener Postfächer liegen verschlüsselt in der Datenbank, mit einem Schlüssel, der ebenfalls dort liegt. Das schützt vor einem Blick in einzelne Tabellen, nicht vor jemandem mit der ganzen Datenbank oder einer Sicherung. Nimm für MoeCloud am besten ein App-Passwort deines Mailanbieters, das du dort jederzeit widerrufen kannst.
- E-Mails und Beiträge aus Feeds zeigt MoeCloud bereinigt und ohne Skripte in einem abgeschotteten Rahmen. Bilder aus dem Internet holt dein Server über eine signierte Adresse, die einige Tage gilt, damit Absender und Webseiten deine Adresse nicht sehen. Wer eine solche Adresse kennt, kann über deinen Server genau dieses eine Bild laden.
- Feeds, Lesezeichen und Podcasts ruft MoeCloud selbst ab, Feeds regelmäßig. Die Seiten sehen dabei die Adresse deines Servers.
- Chat-Nachrichten, Lesezeichen, Feeds, Schnipsel und der Status liegen unverschlüsselt in der Datenbank, eine Verschlüsselung von Ende zu Ende gibt es nicht. Den Status und den Namen sieht jede Person, die dich im Chat findet.
- Einen geteilten Schnipsel liest jeder, der den Link kennt, mit Passwort nur mit diesem. Ein Einmal-Link löscht sich beim ersten Öffnen, egal durch wen. Vorschauen in Messengern öffnen ihn nicht, denn den Inhalt gibt es erst nach einem Klick.

Deine Dateien liegen unverschlüsselt im Datenordner. Wer Zugriff auf den Server oder eine Sicherung hat, kann sie lesen. Das ist eine bewusste Grenze von MoeCloud und keine Lücke. Gleiches gilt für Schadsoftware, die ClamAV nicht erkennt: Das meldest du am besten direkt an [ClamAV](https://www.clamav.net).
