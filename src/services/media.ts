import { spawn } from 'node:child_process';
import { config } from '../config.ts';

export type Tool = 'ffmpeg' | 'ffprobe' | 'pdftoppm' | 'pdftotext';

export const tools: Record<Tool, boolean> = { ffmpeg: false, ffprobe: false, pdftoppm: false, pdftotext: false };

interface RunOptions {
  timeout?: number;
  maxBytes?: number;
}

interface Result {
  output: Buffer;
  log: string;
}

export const execute = (command: string, args: string[], options: RunOptions = {}) =>
  launch(command, args, options).then((result) => result.output);

function launch(command: string, args: string[], options: RunOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let size = 0;
    let logged = 0;
    let settled = false;
    const limit = options.maxBytes ?? 32 * 1024 * 1024;
    const finish = (error: Error | null, result?: Result) => {
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
      if (logged < 256 * 1024) errors.push(chunk);
      logged += chunk.length;
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      const log = Buffer.concat(errors).toString('utf8');
      if (code === 0) finish(null, { output: Buffer.concat(chunks), log });
      else finish(new Error(log.trim().split('\n').pop() || `${command} endete mit ${code}`));
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

const still = (decoder: string) => ['-f', 'image2', '-pattern_type', 'none', '-c:v', decoder];

const FRAME_INPUT: Record<string, string[]> = {
  'image/bmp': still('bmp'),
  'image/vnd.adobe.photoshop': still('psd'),
  'image/jp2': still('jpeg2000'),
  'image/jpx': still('jpeg2000'),
  'image/x-jp2-codestream': still('jpeg2000'),
  'image/x-tga': still('targa'),
  'image/vnd.ms-dds': still('dds'),
  'image/qoi': still('qoi'),
  'image/vnd.zbrush.pcx': still('pcx'),
  'image/x-portable-pixmap': still('ppm'),
  'image/x-portable-graymap': still('ppm'),
  'image/x-portable-bitmap': still('ppm'),
  'image/x-portable-anymap': still('ppm'),
  'image/sgi': still('sgi'),
  'image/vnd.microsoft.icon': ['-f', 'ico'],
  'image/x-icon': ['-f', 'ico'],
  'image/jxl': [],
};

export const canFrame = (type: string | null) => Object.hasOwn(FRAME_INPUT, type ?? '');

export async function imageFrame(path: string, type: string, edge: number) {
  const result = await launch(
    config.tools.ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-loglevel',
      'info',
      ...FRAME_INPUT[type],
      '-i',
      path,
      '-frames:v',
      '1',
      '-vf',
      `showinfo,scale=w='min(iw,${edge})':h='min(ih,${edge})':force_original_aspect_ratio=decrease`,
      '-compression_level',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      'pipe:1',
    ],
    { timeout: 60_000, maxBytes: 128 * 1024 * 1024 }
  );
  if (!result.output.length) throw new Error('Kein Bild');
  const size = / s:(\d+)x(\d+) /.exec(result.log);
  return { data: result.output, width: size ? Number(size[1]) : null, height: size ? Number(size[2]) : null };
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

export const pdfPage = (path: string, page = 1, size = 640) =>
  execute(config.tools.pdftoppm, ['-f', String(page), '-l', String(page), '-png', '-scale-to', String(size), '-singlefile', path], {
    timeout: 45_000,
  });

export async function pdfText(path: string, limit = 1024 * 1024) {
  const output = await execute(config.tools.pdftotext, ['-l', '60', '-enc', 'UTF-8', '-q', path, '-'], {
    timeout: 60_000,
    maxBytes: limit * 4,
  });
  return output.toString('utf8').slice(0, limit);
}
