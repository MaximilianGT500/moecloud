export type ScanFilter = 'color' | 'gray' | 'document';
export type Rotation = 0 | 90 | 180 | 270;

export interface ScanPage {
  id: string;
  source: CanvasImageSource & { width: number; height: number };
  rotation: Rotation;
}

const A4 = { short: 595.28, long: 841.89 };

export function drawPage(page: ScanPage, filter: ScanFilter, maxEdge: number) {
  const turned = page.rotation === 90 || page.rotation === 270;
  const width = turned ? page.source.height : page.source.width;
  const height = turned ? page.source.width : page.source.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: filter !== 'color' })!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((page.rotation * Math.PI) / 180);
  const drawWidth = page.source.width * scale;
  const drawHeight = page.source.height * scale;
  context.drawImage(page.source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (filter !== 'color') applyFilter(context, canvas.width, canvas.height, filter);
  return canvas;
}

function applyFilter(context: CanvasRenderingContext2D, width: number, height: number, filter: ScanFilter) {
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const light = new Uint8ClampedArray(width * height);
  const histogram = new Uint32Array(256);
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel++) {
    const value = Math.round(0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]);
    light[pixel] = value;
    histogram[value]++;
  }
  let low = 0;
  let high = 255;
  if (filter === 'document') {
    const total = width * height;
    let seen = 0;
    for (let value = 0; value < 256; value++) {
      seen += histogram[value];
      if (seen >= total * 0.02) {
        low = value;
        break;
      }
    }
    seen = 0;
    for (let value = 255; value >= 0; value--) {
      seen += histogram[value];
      if (seen >= total * 0.3) {
        high = value;
        break;
      }
    }
    if (high - low < 32) high = Math.min(255, low + 32);
  }
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel++) {
    let value = light[pixel];
    if (filter === 'document') {
      value = ((value - low) * 255) / (high - low);
      value = value >= 235 ? 255 : value <= 0 ? 0 : 255 * Math.pow(value / 255, 1.4);
    }
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error('jpeg'))),
      'image/jpeg',
      quality
    )
  );

const ascii = (text: string) => new TextEncoder().encode(text);

export async function buildPdf(pages: ScanPage[], filter: ScanFilter, title: string) {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array) => {
    parts.push(part);
    length += part.length;
  };
  const object = (id: number, body: Uint8Array[] | string) => {
    offsets[id] = length;
    push(ascii(`${id} 0 obj\n`));
    if (typeof body === 'string') push(ascii(body));
    else for (const part of body) push(part);
    push(ascii('\nendobj\n'));
  };
  push(ascii('%PDF-1.4\n%âãÏÓ\n'));
  const pageIds = pages.map((_page, index) => 4 + index * 3);
  const safeTitle = title.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, '');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, `<< /Title (${safeTitle}) /Producer (MoeCloud) >>`);
  for (const [index, page] of pages.entries()) {
    const canvas = drawPage(page, filter, 2200);
    const jpeg = await toJpeg(canvas, filter === 'document' ? 0.8 : 0.85);
    const wide = canvas.width > canvas.height;
    const [pageWidth, pageHeight] = wide ? [A4.long, A4.short] : [A4.short, A4.long];
    const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const drawWidth = canvas.width * scale;
    const drawHeight = canvas.height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const id = pageIds[index];
    const content = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`
    );
    object(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(id + 2, [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
      ),
      jpeg,
      ascii('\nendstream'),
    ]);
  }
  const count = 4 + pages.length * 3;
  const start = length;
  const table = [`xref\n0 ${count}\n0000000000 65535 f \n`];
  for (let id = 1; id < count; id++) table.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(ascii(`${table.join('')}trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${start}\n%%EOF\n`));
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
