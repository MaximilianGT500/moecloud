declare module 'libheif-js/wasm-bundle.js' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    has_alpha_channel(): boolean;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void
    ): void;
    free(): void;
  }

  export class HeifDecoder {
    decode(data: Uint8Array): HeifImage[];
  }

  const libheif: { HeifDecoder: typeof HeifDecoder };
  export default libheif;
}
