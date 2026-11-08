import { spawn } from 'node:child_process';
import { config } from '../config.ts';

export type Tool = 'ffmpeg' | 'ffprobe' | 'pdftoppm' | 'pdftotext';

export const tools: Record<Tool, boolean> = { ffmpeg: false, ffprobe: false, pdftoppm: false, pdftotext: false };

interface RunOptions {
  timeout?: number;
  maxBytes?: number;
}

export function execute(command: string, args: string[], options: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let size = 0;
    let settled = false;
    const limit = options.maxBytes ?? 32 * 1024 * 1024;
    const finish = (error: Error | null, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${command} hat zu lange gebraucht`));
    }, options.timeout ?? 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        child.kill('SIGKILL');
        finish(new Error(`${command} hat zu viele Daten geliefert`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.length < 32) errors.push(chunk);
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code === 0) finish(null, Buffer.concat(chunks));
      else finish(new Error(Buffer.concat(errors).toString('utf8').trim().split('\n').pop() || `${command} endete mit ${code}`));
    });
  });
}

async function available(tool: Tool) {
  const flag = tool === 'pdftoppm' || tool === 'pdftotext' ? '-v' : '-version';
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(config.tools[tool], [flag], { stdio: 'ignore', windowsHide: true });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('timeout'));
      }, 5000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || code === 99) resolve();
        else reject(new Error(String(code)));
      });
    });
    return true;
  } catch {
    return false;
  }
}

export async function detectTools() {
  const names = Object.keys(tools) as Tool[];
  const results = await Promise.all(names.map(available));
  names.forEach((name, index) => {
    tools[name] = results[index];
  });
  return { ...tools };
}

export async function videoFrame(path: string): Promise<Buffer> {
  const args = (seek: string) => [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    seek,
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    'pipe:1',
  ];
  const first = await execute(config.tools.ffmpeg, args('1'), { timeout: 45_000 }).catch(() => Buffer.alloc(0));
  if (first.length) return first;
  const second = await execute(config.tools.ffmpeg, args('0'), { timeout: 45_000 });
  if (!second.length) throw new Error('Kein Standbild');
  return second;
}

export interface Probe {
  duration: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  created: number | null;
}

export async function probe(path: string): Promise<Probe> {
  const output = await execute(
    config.tools.ffprobe,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format=duration:format_tags=creation_time:stream=codec_type,codec_name,width,height',
      path,
    ],
    { timeout: 30_000, maxBytes: 1024 * 1024 }
  );
  const data = JSON.parse(output.toString('utf8')) as {
    format?: { duration?: string; tags?: { creation_time?: string } };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
  };
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = Number(data.format?.duration);
  const created = data.format?.tags?.creation_time ? Date.parse(data.format.tags.creation_time) : NaN;
  return {
    duration: Number.isFinite(duration) ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec_name ?? audio?.codec_name ?? null,
    created: Number.isFinite(created) && created > 0 ? created : null,
  };
}

export const pdfPage = (path: string) =>
  execute(config.tools.pdftoppm, ['-f', '1', '-l', '1', '-png', '-scale-to', '640', '-singlefile', path], { timeout: 45_000 });

export async function pdfText(path: string, limit = 1024 * 1024) {
  const output = await execute(config.tools.pdftotext, ['-l', '60', '-enc', 'UTF-8', '-q', path, '-'], {
    timeout: 60_000,
    maxBytes: limit * 4,
  });
  return output.toString('utf8').slice(0, limit);
}
