declare module 'http_ece' {
  import type { ECDH } from 'node:crypto';

  const ece: {
    decrypt(data: Buffer, params: { version: 'aes128gcm'; privateKey: ECDH; authSecret: string }): Buffer;
  };
  export default ece;
}
