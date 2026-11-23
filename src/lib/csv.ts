const BOM = String.fromCharCode(0xfeff);
const RISKY = new Set(['=', '+', '-', '@', String.fromCharCode(9), String.fromCharCode(13)]);

export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (text && RISKY.has(text[0])) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const csvRow = (values: unknown[]) => values.map(csvCell).join(',');

export const csvDocument = (rows: string[]) => `${BOM}${rows.join('\r\n')}\r\n`;
