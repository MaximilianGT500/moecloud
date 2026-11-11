## Was ändert sich

Beschreib kurz, was dieser Pull Request ändert und warum. Gehört er zu einem Issue, verlinke es mit `Fixes #123`.

## Geprüft

- [ ] `npm run format`
- [ ] `npm run typecheck`
- [ ] `node tools/i18n.ts --strict`
- [ ] `npm run build` und danach `npm test`, bei Änderungen an der Oberfläche auch `npm run test:browser`
- [ ] Neue Texte stehen auf Deutsch im Code und auf Englisch in `src/i18n/en.json`
- [ ] README und CHANGELOG sind angepasst, falls nötig
