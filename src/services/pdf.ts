import { readFile } from 'node:fs/promises';
import { badRequest, HttpError } from '../lib/errors.ts';
import { cleanName, splitName } from '../lib/names.ts';
import { record } from './activity.ts';
import { blobPath, getBlob, typeOf } from './blobs.ts';
import { createDerived, writableFolder } from './derived.ts';
import { ingestBuffer } from './ingest.ts';
import { assertSpace, changed, requireAccess, requireMutable, type NodeRow } from './nodes.ts';
import { assertNotInfected } from './scan.ts';
import type { UserRow } from './users.ts';
import { writeContent } from './versions.ts';

export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_PAGES = 2000;
const MAX_MERGE = 50;

const pdfName = (raw: string) => {
  const name = cleanName(raw);
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
};

export interface PageChoice {
  page: number;
  rotate: 0 | 90 | 180 | 270;
}

function pdfNode(user: UserRow, id: string) {
  const { node } = requireAccess(user, id);
  if (node.type !== 'file' || !node.sha256 || typeOf(node, getBlob(node.sha256)) !== 'application/pdf') {
    throw badRequest('Das geht nur mit PDF-Dateien');
  }
  assertNotInfected(node.sha256);
  if (node.size > MAX_PDF_BYTES) throw badRequest('Die PDF ist zu groß für die Werkzeuge');
  return node;
}

const library = () => import('@pdfme/pdf-lib');

async function open(node: NodeRow) {
  const { EncryptedPDFError, PDFDocument } = await library();
  try {
    const document = await PDFDocument.load(await readFile(blobPath(node.sha256!)), { updateMetadata: false });
    if (document.getPageCount() > MAX_PAGES) throw badRequest('Die PDF hat mehr als {count} Seiten', { count: MAX_PAGES });
    return document;
  } catch (error) {
    if (error instanceof EncryptedPDFError) throw badRequest('Verschlüsselte PDFs kann MoeCloud nicht bearbeiten');
    if (error instanceof HttpError) throw error;
    throw badRequest('„{name}“ lässt sich nicht als PDF lesen', { name: node.name });
  }
}

export async function pdfInfo(user: UserRow, id: string) {
  const document = await open(pdfNode(user, id));
  return document.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width: Math.round(width), height: Math.round(height), rotation: ((page.getRotation().angle % 360) + 360) % 360 };
  });
}

export const pdfPath = (user: UserRow, id: string) => blobPath(pdfNode(user, id).sha256!);

async function store(user: UserRow, node: NodeRow, output: Uint8Array, save: 'copy' | 'version', name: string) {
  const buffer = Buffer.from(output);
  if (save === 'version') {
    requireMutable(user, node.id);
    assertSpace(node.owner_id, buffer.length - node.size, user.id);
    const sha256 = await ingestBuffer(buffer, { userId: user.id, name: node.name, via: 'editor' });
    const updated = writeContent(node, { sha256, size: buffer.length }, user.id);
    record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'edit', name: node.name });
    changed([node.parent_id]);
    return updated;
  }
  return createDerived(user, writableFolder(user, node.parent_id), pdfName(name), buffer);
}

export async function rearrange(user: UserRow, id: string, pages: PageChoice[], save: 'copy' | 'version', name: string, template: string) {
  const node = pdfNode(user, id);
  if (save === 'version') requireMutable(user, node.id);
  const source = await open(node);
  const count = source.getPageCount();
  if (pages.length === 0) throw badRequest('Wähle mindestens eine Seite aus');
  if (pages.some((choice) => choice.page < 1 || choice.page > count)) throw badRequest('Diese Seite gibt es in der PDF nicht');
  const { degrees, PDFDocument } = await library();
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    pages.map((choice) => choice.page - 1)
  );
  copied.forEach((page, index) => {
    const turn = pages[index].rotate;
    if (turn) page.setRotation(degrees((((page.getRotation().angle + turn) % 360) + 360) % 360));
    output.addPage(page);
  });
  output.setTitle(source.getTitle() ?? '');
  return store(user, node, await output.save(), save, name || template.replace('{name}', splitName(node.name)[0]));
}

export async function merge(user: UserRow, ids: string[], name: string) {
  if (ids.length < 2) throw badRequest('Wähle mindestens zwei PDFs aus');
  if (ids.length > MAX_MERGE) throw badRequest('Höchstens {count} PDFs auf einmal', { count: MAX_MERGE });
  const nodes = ids.map((id) => pdfNode(user, id));
  if (nodes.reduce((sum, node) => sum + node.size, 0) > MAX_PDF_BYTES * 2) throw badRequest('Die PDFs sind zusammen zu groß');
  const { PDFDocument } = await library();
  const output = await PDFDocument.create();
  let pages = 0;
  for (const node of nodes) {
    const source = await open(node);
    pages += source.getPageCount();
    if (pages > MAX_PAGES) throw badRequest('Die PDF hätte mehr als {count} Seiten', { count: MAX_PAGES });
    for (const page of await output.copyPages(source, source.getPageIndices())) output.addPage(page);
  }
  return createDerived(user, writableFolder(user, nodes[0].parent_id), pdfName(name), Buffer.from(await output.save()));
}
