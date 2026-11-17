export default (moe) => {
  const rules = () => ({
    blocked: new Set(
      String(moe.settings.get('gesperrt') ?? '')
        .split(',')
        .map((part) => part.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean)
    ),
    maxMb: Number(moe.settings.get('maxMb') ?? 0),
    onlyLinks: moe.settings.get('nurLinks') === true,
    hint: String(moe.settings.get('hinweis') || 'Diese Datei nimmt die Cloud nicht an'),
  });

  moe.filter('upload', (upload) => {
    const { blocked, maxMb, onlyLinks, hint } = rules();
    if (onlyLinks && upload.via !== 'link') return;
    const extension = upload.name.includes('.') ? upload.name.split('.').pop().toLowerCase() : '';
    if (blocked.has(extension)) throw moe.reject(`${hint} (.${extension})`);
    if (maxMb > 0 && upload.size > maxMb * 1024 * 1024) throw moe.reject(`${hint} (mehr als ${maxMb} MB)`);
  });
};
