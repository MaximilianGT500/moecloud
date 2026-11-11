import { createServer, type AddressInfo } from 'node:net';

interface Received {
  to: string;
  text: string;
}

const decode = (lines: string[]) =>
  Buffer.from(
    lines
      .join('\r\n')
      .replace(/=\r\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
    'latin1'
  ).toString('utf8');

export async function smtpSink() {
  const inbox: Received[] = [];
  const server = createServer((socket) => {
    let buffer = '';
    let lines: string[] | null = null;
    let to = '';
    socket.setEncoding('latin1');
    socket.on('error', () => undefined);
    socket.write('220 localhost ESMTP\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\r\n'); end >= 0; end = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (lines) {
          if (line !== '.') {
            lines.push(line.startsWith('..') ? line.slice(1) : line);
            continue;
          }
          inbox.push({ to, text: decode(lines) });
          lines = null;
          socket.write('250 OK\r\n');
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'RCPT') to = /<([^>]+)>/.exec(line)?.[1] ?? '';
        if (command === 'DATA') {
          lines = [];
          socket.write('354 Weiter\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    async mailTo(address: string) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const index = inbox.findIndex((mail) => mail.to === address);
        if (index >= 0) return inbox.splice(index, 1)[0].text;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Keine E-Mail an ${address} angekommen`);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
