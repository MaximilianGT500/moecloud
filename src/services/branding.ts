import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, tooLarge } from '../lib/errors.ts';
import { loadSharp } from '../lib/sharp.ts';
import * as settings from './settings.ts';

export const BRANDING = ['logo', 'background'] as const;
export type BrandingKind = (typeof BRANDING)[number];

export const BRANDING_MAX_BYTES = 6 * 1024 * 1024;

const KEYS = { logo: 'site.logo', background: 'login.background' } as const;

export const brandingPath = (kind: BrandingKind) => join(config.paths.site, `${kind}.webp`);

export const brandingStamp = (kind: BrandingKind) => settings.get(KEYS[kind]);

export const brandingUrl = (kind: BrandingKind) => {
  const stamp = brandingStamp(kind);
  return stamp ? `/branding/${kind}?v=${stamp}` : null;
};

export async function setBranding(kind: BrandingKind, image: Buffer) {
  if (image.length === 0) throw badRequest('Wähl ein Bild aus');
  if (image.length > BRANDING_MAX_BYTES) throw tooLarge('Das Bild ist zu groß, höchstens 6 MB');
  const sharp = await loadSharp();
  let output: Buffer;
  try {
    const source = sharp(image, { failOn: 'error', limitInputPixels: 80_000_000, animated: false }).rotate();
    output =
      kind === 'logo'
        ? await source.resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 92, alphaQuality: 100 }).toBuffer()
        : await source
            .resize(2560, 1600, { fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#101014' })
            .webp({ quality: 82 })
            .toBuffer();
  } catch {
    throw badRequest('Das Bild ließ sich nicht lesen. Nimm ein JPEG, PNG oder WebP');
  }
  await mkdir(config.paths.site, { recursive: true });
  await writeFile(brandingPath(kind), output);
  const stamp = randomId(8);
  settings.set(KEYS[kind], stamp);
  return stamp;
}

export async function removeBranding(kind: BrandingKind) {
  settings.set(KEYS[kind], '');
  await rm(brandingPath(kind), { force: true });
}

export async function brandingFile(kind: BrandingKind) {
  const stamp = brandingStamp(kind);
  if (!stamp) return null;
  try {
    const info = await stat(brandingPath(kind));
    return { path: brandingPath(kind), size: info.size, modified: info.mtimeMs, stamp };
  } catch {
    return null;
  }
}
