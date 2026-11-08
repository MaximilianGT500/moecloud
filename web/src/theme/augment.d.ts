import type { FolderColor, M3Tokens } from './scheme';

interface FileTypePalette {
  image: string;
  video: string;
  audio: string;
  text: string;
  other: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    m3: M3Tokens;
    fileTypes: FileTypePalette;
    folders: Record<FolderColor, string>;
  }
  interface PaletteOptions {
    m3?: M3Tokens;
    fileTypes?: FileTypePalette;
    folders?: Record<FolderColor, string>;
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}

export {};
