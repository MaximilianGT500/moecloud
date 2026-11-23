# Sicherheit

MoeCloud verwaltet Dateien, Konten und Zugangsdaten. Wenn du eine Sicherheitslücke findest, hilft eine vertrauliche Meldung allen, die MoeCloud betreiben.

## Unterstützte Versionen

Sicherheitsupdates gibt es für die neueste Version. Aktualisiere am besten bald nach jeder neuen Version, wie das geht, steht in der [Anleitung](README.md#updates).

| Version | Sicherheitsupdates |
| ------- | ------------------ |
| 1.8.x   | Ja                 |
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

Du bekommst eine Rückmeldung, sobald die Meldung geprüft ist. Bestätigt sich die Lücke, erscheint so bald wie möglich eine neue Version. Sie ist in der [`version.json`](https://moecloud.moestudio.net/version.json) als Sicherheitsupdate markiert, damit alle Installationen mit eingeschalteter Versionsprüfung einen Hinweis zeigen. Erst danach steht die Lücke im [Changelog](CHANGELOG.md), auf Wunsch mit deinem Namen.

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

## Wie MoeCloud geprüft wird

Zu jeder Version läuft eine eigene Testreihe für die Sicherheit (`test/sec-*.test.ts`, mit `npm test`). Sie ruft jede Route ohne Anmeldung, mit fremdem Konto, als Gast, mit einem App-Passwort und ohne Formular-Kennzeichen auf und prüft öffentliche Links, hochgeladene Inhalte, Weiterleitungen, Anfragen ins eigene Netz, Pfade, WebDAV und eingeschleuste Eingaben. Eine neue Route ohne Einordnung lässt die Tests scheitern. Das ersetzt keine Prüfung von außen: Wer MoeCloud für Vertrauliches einsetzt, lässt die eigene Einrichtung am besten zusätzlich von jemandem prüfen, der sie nicht gebaut hat.

## Bewusste Grenzen

- Admins sehen in der Verwaltung alle öffentlichen Links samt Adresse, können Passwörter anderer neu setzen und Dateien übertragen. Das steht jeweils im Protokoll. Ein Admin ist damit jemand, dem alle Mitglieder vertrauen müssen.
- Die Version steht in `/healthz` und im Quelltext geteilter Seiten, auch für Unangemeldete.
- Sperren nach Fehlversuchen und die Beschränkung der Verwaltung auf bestimmte Netze stützen sich auf die Adresse, die MoeCloud sieht. Geräte, denen MoeCloud die Angaben eines Proxys glaubt, in der Voreinstellung der eigene Rechner und das lokale Netz, können eine andere Adresse angeben. Wer das ausschließen will, trägt in `TRUST_PROXY` nur die Adresse des eigenen Proxys ein.
- Ein fälliger Passwortwechsel gilt für die Anmeldung im Browser. App-Passwörter des Kontos arbeiten weiter, bis du sie widerrufst.
- Der Schutz vor Erpressungstrojanern erkennt bekannte Endungen und Erpresserbriefe und zählt Änderungen pro App-Passwort. Ein Trojaner mit neuer Endung, einer, der nur wenige Dateien auf einmal ändert, oder einer, der im Browser angemeldet ist, fällt damit nicht auf. Er ersetzt keine Sicherung, und **Auf früheren Stand zurücksetzen** holt nur zurück, wovon es noch eine Version oder einen Eintrag im Papierkorb gibt.
- Wer ein Formular ausfüllen darf, entscheidet allein der Link. Er verrät nichts über deine Dateien, aber jeder, der ihn kennt, kann antworten. Antworten ohne Konto lassen sich nicht einer Person zuordnen.
- Links nur zum Ansehen verhindern das Herunterladen in der Oberfläche. Wer eine Datei ansehen darf, kann ihren Inhalt technisch immer auch speichern.

Deine Dateien liegen unverschlüsselt im Datenordner. Wer Zugriff auf den Server oder eine Sicherung hat, kann sie lesen. Das ist eine bewusste Grenze von MoeCloud und keine Lücke. Gleiches gilt für Schadsoftware, die ClamAV nicht erkennt: Das meldest du am besten direkt an [ClamAV](https://www.clamav.net).
