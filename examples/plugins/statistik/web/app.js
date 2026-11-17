const TEXTS = {
  de: {
    uploads: 'Hochgeladen',
    shares: 'Geteilt',
    edits: 'Bearbeitet',
    removed: 'Gelöscht',
    title: 'Deine Aktionen pro Tag',
    span: (count) => `Letzte ${count} Tage`,
    range: 'Zeitraum',
    table: 'Als Tabelle zeigen',
    day: 'Tag',
    total: 'Aktionen',
    empty: 'Noch nichts gezählt. Sobald du etwas hochlädst, teilst oder änderst, erscheint es hier.',
    tip: (date, count) => `${date}: ${count === 1 ? 'eine Aktion' : `${count} Aktionen`}`,
    failed: 'Die Zahlen ließen sich nicht laden.',
  },
  en: {
    uploads: 'Uploaded',
    shares: 'Shared',
    edits: 'Edited',
    removed: 'Deleted',
    title: 'Your actions per day',
    span: (count) => `Last ${count} days`,
    range: 'Period',
    table: 'Show as table',
    day: 'Day',
    total: 'Actions',
    empty: 'Nothing counted yet. As soon as you upload, share or change something, it shows up here.',
    tip: (date, count) => `${date}: ${count === 1 ? 'one action' : `${count} actions`}`,
    failed: 'The numbers could not be loaded.',
  },
};

const GROUPS = {
  uploads: ['upload', 'link_upload', 'folder', 'text'],
  shares: ['share_link', 'share_user', 'share_group'],
  edits: ['edit', 'rename', 'move', 'copy', 'rotate', 'extract', 'version_restore', 'color', 'comment', 'restore'],
  removed: ['trash', 'delete'],
};

const byId = (id) => document.getElementById(id);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const totalOf = (counts) => Object.values(counts).reduce((total, value) => total + value, 0);

moecloud.ready.then((info) => {
  const lang = info.lang === 'en' ? 'en' : 'de';
  const text = TEXTS[lang];
  const number = new Intl.NumberFormat(lang);
  const short = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const select = byId('spanne');
  document.documentElement.lang = lang;
  document.title = lang === 'en' ? 'Statistics' : 'Statistik';
  byId('titel').textContent = text.title;
  byId('tabelle-titel').textContent = text.table;
  select.setAttribute('aria-label', text.range);
  for (const count of [7, 14, 30, 90]) select.add(new Option(text.span(count), String(count)));
  select.value = '14';

  const render = (days) => {
    const tiles = byId('kacheln');
    tiles.replaceChildren(
      ...Object.entries(GROUPS).map(([key, actions]) => {
        const card = element('div', 'moe-card');
        const sum = days.reduce((total, day) => total + actions.reduce((part, action) => part + (day.counts[action] ?? 0), 0), 0);
        card.append(element('div', 'moe-muted', text[key]), element('div', 'moe-stat', number.format(sum)));
        return card;
      })
    );

    const totals = days.map((day) => totalOf(day.counts));
    const top = Math.max(...totals);
    const chart = byId('diagramm');
    if (top === 0) {
      chart.replaceChildren(element('p', 'moe-muted', text.empty));
      byId('tabelle').replaceChildren();
      return;
    }
    const peak = top <= 4 ? 4 : Math.ceil(top / 2) * 2;
    const area = element('div', 'flaeche');
    const scale = element('div', 'werte');
    scale.append(element('span', '', number.format(peak)), element('span', '', number.format(peak / 2)), element('span', '', '0'));
    const columns = element('div', 'saeulen');
    const labels = element('div', 'tage');
    const tip = element('div', 'tipp');
    tip.hidden = true;
    const step = Math.ceil(days.length / 7);
    days.forEach((day, index) => {
      const date = new Date(`${day.day}T00:00:00Z`);
      const column = element('div', 'spalte');
      const caption = text.tip(long.format(date), totals[index]);
      column.tabIndex = 0;
      column.setAttribute('role', 'img');
      column.setAttribute('aria-label', caption);
      const bar = element('div', 'saeule');
      bar.style.height = `${(totals[index] / peak) * 100}%`;
      if (totals[index] === 0) bar.hidden = true;
      column.append(bar);
      const show = () => {
        tip.textContent = caption;
        tip.hidden = false;
        const box = column.getBoundingClientRect();
        const outer = area.getBoundingClientRect();
        tip.style.left = `${box.left - outer.left + box.width / 2}px`;
        tip.style.top = `${Math.max(0, 200 - (totals[index] / peak) * 200)}px`;
      };
      const hide = () => {
        tip.hidden = true;
      };
      column.addEventListener('pointerenter', show);
      column.addEventListener('focus', show);
      column.addEventListener('pointerleave', hide);
      column.addEventListener('blur', hide);
      columns.append(column);
      labels.append(element('span', '', (days.length - 1 - index) % step === 0 ? short.format(date) : ''));
    });
    area.append(scale, columns, labels, tip);
    chart.replaceChildren(area);

    const table = byId('tabelle');
    const head = element('tr');
    head.append(element('th', '', text.day), element('th', '', text.total));
    table.replaceChildren(
      head,
      ...days
        .map((day, index) => {
          const row = element('tr');
          row.append(element('td', '', long.format(new Date(`${day.day}T00:00:00Z`))), element('td', '', number.format(totals[index])));
          return row;
        })
        .reverse()
    );
  };

  const load = async () => {
    try {
      render((await moecloud.api('GET', `/tage?tage=${select.value}`)).days);
    } catch {
      byId('diagramm').replaceChildren(element('p', 'moe-muted', text.failed));
    }
  };

  select.addEventListener('change', load);
  load();
});
