import type sharp from 'sharp';

let loading: Promise<typeof sharp> | null = null;

export function loadSharp() {
  loading ??= import('sharp').then(({ default: library }) => {
    library.cache(false);
    library.concurrency(1);
    return library;
  });
  return loading;
}
