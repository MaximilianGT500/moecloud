const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function size(bytes) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}

const escape = (text) => text.replace(/[\\|*_`[\]]/g, '\\$&');

export default (moe) => {
  moe.action('schreiben', async ({ user, nodes, lang }) => {
    const folder = nodes[0];
    const english = lang === 'en';
    const target = String(moe.settings.get('name') || 'Inhalt.md');
    const date = new Intl.DateTimeFormat(english ? 'en-GB' : 'de-DE', { dateStyle: 'medium' });
    const entries = moe.files
      .list(user.id, folder.id)
      .filter((entry) => entry.name !== target)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, lang) : a.type === 'folder' ? -1 : 1));
    const lines = [
      `# ${folder.name || (english ? 'My files' : 'Meine Dateien')}`,
      '',
      english
        ? `${entries.length} entries, as of ${date.format(new Date())}`
        : `${entries.length} Einträge, Stand ${date.format(new Date())}`,
      '',
      english ? '| Name | Size | Changed |' : '| Name | Größe | Geändert |',
      '| --- | ---: | --- |',
      ...entries.map(
        (entry) =>
          `| ${escape(entry.name)}${entry.type === 'folder' ? '/' : ''} | ${entry.type === 'folder' ? '' : size(entry.size)} | ${date.format(new Date(entry.modifiedAt))} |`
      ),
      '',
    ];
    try {
      await moe.files.write(user.id, folder.id, target, lines.join('\n'), { conflict: 'replace' });
    } catch (error) {
      throw moe.reject(error.message);
    }
    return {
      message: english ? `“${target}” is in the folder` : `„${target}“ liegt im Ordner`,
      refresh: true,
    };
  });
};
