import { lookup } from '../lib/lookup.ts';
import { createWriteStream, openAsBlob } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { pathToFileURL } from 'node:url';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { blobPath, tmpPath } from './blobs.ts';
import { execute, tools } from './media.ts';

export const OFFICE_EXTENSIONS = [
  'doc',
  'dot',
  'rtf',
  'odt',
  'ott',
  'ppt',
  'pps',
  'pptx',
  'ppsx',
  'odp',
  'otp',
  'xls',
  'ods',
  'ots',
] as const;
export const OFFICE_LIMIT = 100 * 1024 * 1024;
const TIMEOUT = 120_000;
const FAILURE_PAUSE = 5 * 60_000;
const SERVICE_NAMES: Record<string, string> = lookup({ ppsx: 'pptx' });
const PATTERN = new RegExp(`\\.(${OFFICE_EXTENSIONS.join('|')})$`, 'i');

const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

export const officeReady = () => Boolean(config.officeUrl) || tools.soffice;
export const canConvert = (node: { name: string; size: number; type: string }) =>
  officeReady() && node.type === 'file' && node.size > 0 && node.size <= OFFICE_LIMIT && PATTERN.test(node.name);

export const officePath = (sha: string) => join(config.paths.previews, sha.slice(0, 2), `${sha}.pdf`);

const running = new Map<string, Promise<string>>();
export const officeFailures = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();

async function viaService(sha: string, extension: string, output: string) {
  const form = new FormData();
  form.append('files', await openAsBlob(blobPath(sha)), `dokument.${SERVICE_NAMES[extension] ?? extension}`);
  const response = await fetch(`${config.officeUrl}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Der Dienst für die Umwandlung antwortet mit ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(output));
}

async function viaProgram(sha: string, extension: string, work: string) {
  const input = join(work, `dokument.${extension}`);
  const profile = join(work, 'profil');
  await mkdir(join(profile, 'user'), { recursive: true });
  await writeFile(join(profile, 'user', 'registrymodifications.xcu'), PROFILE);
  await copyFile(blobPath(sha), input);
  await execute(
    config.tools.soffice,
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--nodefault',
      '--nofirststartwizard',
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      input,
    ],
    { timeout: TIMEOUT, group: true, env: { ...process.env, HOME: work } }
  );
}

async function isPdf(path: string) {
  const file = await open(path, 'r').catch(() => null);
  if (!file) return false;
  try {
    const head = Buffer.alloc(5);
    await file.read(head, 0, 5, 0);
    return head.toString('latin1') === '%PDF-';
  } finally {
    await file.close();
  }
}

async function convert(sha: string, extension: string) {
  const target = officePath(sha);
  const work = tmpPath(`office-${randomId(12)}`);
  const output = join(work, 'dokument.pdf');
  try {
    await mkdir(work, { recursive: true });
    if (config.officeUrl) await viaService(sha, extension, output);
    else await viaProgram(sha, extension, work);
    if (!(await isPdf(output))) throw new Error('keine PDF');
    await mkdir(join(config.paths.previews, sha.slice(0, 2)), { recursive: true });
    await rename(output, target).catch(async () => {
      await copyFile(output, target);
    });
    return target;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function officePdf(node: { name: string; size: number; type: string; sha256: string | null }) {
  if (!node.sha256 || !canConvert(node)) throw badRequest('Für diese Datei gibt es keine Vorschau als PDF');
  const sha = node.sha256;
  const target = officePath(sha);
  if (await stat(target).catch(() => null)) return target;
  if (Date.now() - (officeFailures.get(sha) ?? 0) < FAILURE_PAUSE)
    throw badRequest('Das Dokument lässt sich nicht für die Vorschau umwandeln');
  const pending = running.get(sha);
  if (pending) return pending;
  const extension = PATTERN.exec(node.name)![1].toLowerCase();
  const job = (queue = queue.then(
    () => convert(sha, extension),
    () => convert(sha, extension)
  )) as Promise<string>;
  const guarded = job
    .catch((error: Error) => {
      if (officeFailures.size >= 1000) officeFailures.clear();
      officeFailures.set(sha, Date.now());
      log.info({ error: error.message }, 'Das Dokument ließ sich nicht umwandeln');
      throw badRequest('Das Dokument lässt sich nicht für die Vorschau umwandeln');
    })
    .finally(() => running.delete(sha));
  running.set(sha, guarded);
  return guarded;
}

export async function officePrepared(node: { name: string; size: number; type: string; sha256: string | null }) {
  if (!node.sha256 || !canConvert(node)) throw badRequest('Für diese Datei gibt es keine Vorschau als PDF');
  return officePdf(node).then(
    () => true,
    () => false
  );
}
