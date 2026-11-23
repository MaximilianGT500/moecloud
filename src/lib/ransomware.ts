import { lookup } from './lookup.ts';

const EXTENSIONS = lookup(
  Object.fromEntries(
    [
      'locky',
      'zepto',
      'odin',
      'thor',
      'aesir',
      'osiris',
      'zzzzz',
      'cerber',
      'cerber2',
      'cerber3',
      'wncry',
      'wnry',
      'wcry',
      'wncryt',
      'cryptolocker',
      'crypz',
      'cryp1',
      'ezz',
      'exx',
      'vvv',
      'ryk',
      'ryuk',
      'conti',
      'lockbit',
      'djvus',
      'djvuu',
      'udjvu',
      'uudjvu',
      'djvuq',
      'djvur',
      'djvut',
      'tfude',
      'tfudet',
      'tfudeq',
      'promos',
      'promoz',
      'promock',
      'promorad',
      'gero',
      'hese',
      'seto',
      'peta',
      'moka',
      'meds',
      'kvag',
      'domn',
      'karl',
      'nesa',
      'noos',
      'kuub',
      'reco',
      'bora',
      'nols',
      'werd',
      'coot',
      'derp',
      'meka',
      'toec',
      'mosk',
      'lokas',
      'gdcb',
      'krab',
      'nemty',
      'clop',
      'cl0p',
      'ciop',
      'basta',
      'akira',
      'phobos',
      'eking',
      'devos',
      'makop',
      'mallox',
      'babyk',
      'xtbl',
      'crysis',
      'dharma',
    ].map((name) => [name, true] as const)
  )
);

const NOTES = lookup(
  Object.fromEntries(
    [
      'how_to_decrypt.txt',
      'how_to_decrypt.html',
      'how_to_decrypt_files.txt',
      'how_to_decrypt_files.html',
      'help_decrypt.txt',
      'help_decrypt.html',
      'help_decrypt.png',
      'help_your_files.txt',
      'help_your_files.html',
      'help_your_files.png',
      'decrypt_instructions.txt',
      'decrypt_instructions.html',
      'decrypt_instruction.txt',
      'decrypt_instruction.html',
      'decrypt_your_files.txt',
      'decrypt_your_files.html',
      'how_to_restore_files.txt',
      'how_to_restore_files.html',
      'how_to_back_files.html',
      'restore-my-files.txt',
      'readme_for_decrypt.txt',
      'readme-warning.txt',
      'your_files_are_encrypted.txt',
      'your_files_are_encrypted.html',
      '@please_read_me@.txt',
      'ryukreadme.txt',
      'ryukreadme.html',
      '_locky_recover_instructions.txt',
      '_help_instructions.html',
      '_help_instructions.txt',
      '# decrypt my files #.html',
      '# decrypt my files #.txt',
      '# decrypt my files #.vbs',
    ].map((name) => [name, true] as const)
  )
);

export function ransomwareName(name: string) {
  const plain = String(name ?? '')
    .normalize('NFKC')
    .replace(/[.\s]+$/, '')
    .toLowerCase();
  if (!plain) return false;
  if (NOTES[plain] || plain.startsWith('@wanadecryptor@')) return true;
  const dot = plain.lastIndexOf('.');
  if (dot <= 0) return false;
  return Boolean(EXTENSIONS[plain.slice(dot + 1)]);
}
