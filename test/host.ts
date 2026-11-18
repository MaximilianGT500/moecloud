import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stubs = join(import.meta.dirname, 'fixtures', 'host');

export const IMAGE = 'ghcr.io/maximiliangt500/moecloud';

export function fakeHost(repo = root) {
  const base = mkdtempSync(join(tmpdir(), 'moecloud-host-'));
  const bin = join(base, 'bin');
  const state = join(base, 'state');
  const dir = join(base, 'opt');
  const command = join(base, 'moecloud');
  mkdirSync(bin);
  mkdirSync(join(state, 'registry'), { recursive: true });
  for (const name of readdirSync(stubs)) {
    copyFileSync(join(stubs, name), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    STUB_STATE: state,
    STUB_REPO: repo,
    MOECLOUD_DIR: dir,
    MOECLOUD_BIN: command,
    MOECLOUD_LOG: join(base, 'install.log'),
    MOECLOUD_SITE: 'https://moecloud.test',
    MOECLOUD_REF: '',
  };
  const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
  const lines = (file: string) => read(file).split('\n').filter(Boolean);
  const run = (script: string, ...args: string[]) => {
    const result = spawnSync('bash', [script, ...args], { env, encoding: 'utf8', cwd: base });
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return {
    dir,
    publish: (tag: string, version: string) => writeFileSync(join(state, 'registry', tag), version),
    withdraw: (tag: string) => rmSync(join(state, 'registry', tag), { force: true }),
    announce: (version: string) => writeFileSync(join(state, 'site'), version),
    running: () => read(join(state, 'running')).trim(),
    events: () => lines(join(state, 'events')),
    calls: () => lines(join(state, 'calls')),
    forget: () => {
      rmSync(join(state, 'events'), { force: true });
      rmSync(join(state, 'calls'), { force: true });
    },
    env: () => read(join(dir, '.env')),
    addEnv: (text: string) => writeFileSync(join(dir, '.env'), `${read(join(dir, '.env'))}${text}\n`),
    script: run,
    install: (...args: string[]) => run(join(repo, 'install.sh'), ...args),
    moecloud: (...args: string[]) => run(command, ...args),
    remove: () => rmSync(base, { recursive: true, force: true }),
  };
}
