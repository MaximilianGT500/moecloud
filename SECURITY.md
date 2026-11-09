# Sicherheit

MoeCloud verwaltet Dateien, Konten und Zugangsdaten. Wenn du eine Sicherheitslücke findest, hilft eine vertrauliche Meldung allen, die MoeCloud betreiben.

## Unterstützte Versionen

Sicherheitsupdates gibt es für die neueste Version. Aktualisiere am besten bald nach jeder neuen Version, wie das geht, steht in der [Anleitung](README.md#updates).

| Version | Sicherheitsupdates |
| ------- | ------------------ |
| 1.0.x   | Ja                 |
| 0.1.x   | Nein               |

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

- Betreib MoeCloud im Internet nur hinter HTTPS, siehe [Mit eigener Domain und HTTPS](README.md#mit-eigener-domain-und-https).
- Lass die Registrierung geschlossen und lade Personen über Einladungslinks ein.
- Richte für Admin-Konten eine Authenticator-App oder einen Passkey ein.
- Schalte den [Virenscan](README.md#virenscan-mit-clamav) ein, sobald andere Dateien hochladen.
- Lass die [Versionsprüfung](README.md#versionsprüfung) an und spiel Updates zeitnah ein.
- Bewahre [Sicherungen](README.md#datensicherung) so sicher auf wie den Server selbst. Sie enthalten Passwort-Hashes und die Schlüssel der Authenticator-Apps.
- Schau ab und zu ins Protokoll unter **Admin › Protokoll**, dort stehen auch fehlgeschlagene Anmeldungen.

Deine Dateien liegen unverschlüsselt im Datenordner. Wer Zugriff auf den Server oder eine Sicherung hat, kann sie lesen. Das ist eine bewusste Grenze von MoeCloud und keine Lücke. Gleiches gilt für Schadsoftware, die ClamAV nicht erkennt: Das meldest du am besten direkt an [ClamAV](https://www.clamav.net).
