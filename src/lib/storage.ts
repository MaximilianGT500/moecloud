import { statfsSync } from 'node:fs';

const SHARED: Record<number, string> = {
  0x6969: 'NFS',
  0x517b: 'SMB',
  0xfe534d42: 'SMB',
  0xff534d42: 'SMB',
  0x65735546: 'FUSE',
  0x01021997: '9p',
  0x00c36400: 'Ceph',
  0x786f4256: 'VirtualBox',
  0x5346414f: 'AFS',
  0x6b414653: 'AFS',
};

export function sharedFileSystem(path: string, type?: number) {
  try {
    return SHARED[(type ?? Number(statfsSync(path).type)) >>> 0] ?? null;
  } catch {
    return null;
  }
}
