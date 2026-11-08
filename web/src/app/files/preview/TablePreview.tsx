import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { formatNumber } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { c, fonts, radius } from '../../../theme/tokens';
import { contentUrl, type Item } from '../kinds';
import { Fallback } from './Fallback';

const MAX_ROWS = 1000;
const MAX_COLUMNS = 60;

export type Cell = string | number | boolean | Date | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
}

function delimiterOf(text: string, extension: string) {
  if (extension === 'tsv') return '\t';
  const line = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const counts = [';', ',', '\t', '|'].map((char) => [char, line.split(char).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(text: string, extension = 'csv'): Cell[][] {
  const delimiter = delimiterOf(text, extension);
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_ROWS) break;
    } else field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function show(cell: Cell) {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toLocaleString();
  if (typeof cell === 'number') return formatNumber(cell);
  if (typeof cell === 'boolean') return cell ? t('Ja') : t('Nein');
  return String(cell);
}

export function SheetTable({ rows, maxHeight = '100%' }: { rows: Cell[][]; maxHeight?: string | number }) {
  const visible = rows.slice(0, MAX_ROWS);
  const width = Math.min(MAX_COLUMNS, Math.max(0, ...visible.map((row) => row.length)));
  if (visible.length === 0) return <Fallback text={t('Die Tabelle ist leer.')} />;
  const [head, ...body] = visible;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, height: '100%', width: '100%' }}>
      <Box
        sx={{
          overflow: 'auto',
          maxHeight,
          minHeight: 0,
          flex: 1,
          borderRadius: `${radius.md}px`,
          bgcolor: c.surfaceContainerLow,
          border: `1px solid ${c.outlineVariant}`,
        }}
      >
        <Box
          component="table"
          sx={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: '0.875rem',
            minWidth: '100%',
            '& th, & td': {
              px: 1.5,
              py: 0.75,
              borderBottom: `1px solid ${c.outlineVariant}`,
              borderRight: `1px solid ${c.outlineVariant}`,
              whiteSpace: 'nowrap',
              maxWidth: 360,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'left',
            },
            '& th': { position: 'sticky', top: 0, bgcolor: c.surfaceContainerHigh, fontWeight: 700, zIndex: 1 },
            '& td.number': { fontVariantNumeric: 'tabular-nums', textAlign: 'right', fontFamily: fonts.mono, fontSize: '0.8125rem' },
            '& tbody tr:hover td': { bgcolor: c.surfaceContainer },
          }}
        >
          <thead>
            <tr>
              {Array.from({ length: width }, (_, column) => (
                <th key={column} scope="col" title={show(head[column] ?? null)}>
                  {show(head[column] ?? null)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index}>
                {Array.from({ length: width }, (_, column) => {
                  const cell = row[column] ?? null;
                  return (
                    <td key={column} className={typeof cell === 'number' ? 'number' : undefined} title={show(cell)}>
                      {show(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
      {rows.length > MAX_ROWS && (
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t('Die Vorschau zeigt die ersten {count} Zeilen.', { count: formatNumber(MAX_ROWS) })}
        </Typography>
      )}
    </Box>
  );
}

export default function XlsxPreview({ item, base }: { item: Item; base: string }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      const response = await fetch(contentUrl(item, base), { credentials: 'same-origin', signal: abort.signal });
      if (!response.ok) throw new Error(t('Die Datei konnte nicht geladen werden'));
      const { default: readXlsxFile } = await import('read-excel-file/browser');
      const result = await readXlsxFile(await response.arrayBuffer());
      if (!abort.signal.aborted) setSheets(result.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as Cell[][] })));
    })().catch((reason: Error) => {
      if (reason.name !== 'AbortError') setError(t('Die Tabelle lässt sich nicht lesen.'));
    });
    return () => abort.abort();
  }, [item, base]);

  if (error) return <Fallback item={item} text={error} />;
  if (!sheets) return <CircularProgress aria-label={t('Lädt')} />;
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  return (
    <Box sx={{ width: 'min(1200px, 100%)', height: '100%', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
      {sheets.length > 1 && (
        <Tabs value={Math.min(active, sheets.length - 1)} onChange={(_event, value) => setActive(value)} variant="scrollable">
          {sheets.map((entry, index) => (
            <Tab key={entry.name} value={index} label={entry.name} />
          ))}
        </Tabs>
      )}
      {sheet ? <SheetTable rows={sheet.rows} /> : <Fallback item={item} text={t('Die Tabelle ist leer.')} />}
    </Box>
  );
}
