import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fakeHost, IMAGE } from './host.ts';

const root = resolve(import.meta.dirname, '..');
const hosts: ReturnType<typeof fakeHost>[] = [];

const skip =
  process.platform !== 'linux'
    ? 'Die Skripte laufen nur unter Linux'
    : existsSync('/etc/systemd/system/moecloud-update.timer')
      ? 'Auf diesem Rechner laufen die automatischen Updates von MoeCloud'
      : false;

function installed(version: string) {
  const host = fakeHost();
  hosts.push(host);
  host.publish('latest', version);
  const result = host.install('--yes');
  assert.equal(result.status, 0, result.output);
  host.forget();
  return host;
}

after(() => {
  for (const host of hosts) host.remove();
});

describe('Installationsskript', { skip }, () => {
  it('lädt bei einer neuen Installation das Image latest und trägt keine Version ein', () => {
    const host = fakeHost();
    hosts.push(host);
    host.publish('latest', '2.4.0');
    host.announce('2.4.0');
    const result = host.install('--yes');
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(host.events(), [`pull ${IMAGE}:latest`, `up ${IMAGE}:latest`]);
    assert.equal(host.running(), '2.4.0');
    assert.match(host.env(), /^MOECLOUD_INSTALL=script$/m);
    assert.doesNotMatch(host.env(), /MOECLOUD_(VERSION|PIN|TAG)/);
    assert.match(result.output, /setup\?code=abc123/);
  });

  it('aktualisiert auf latest und räumt alte Versionszeilen aus der .env', () => {
    const host = installed('2.3.0');
    host.addEnv('MOECLOUD_VERSION=2.3.0\nMOECLOUD_PIN=0');
    host.publish('latest', '2.4.0');
    host.announce('2.4.0');
    const result = host.moecloud('update');
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(host.events(), ['backup', `pull ${IMAGE}:latest`, `up ${IMAGE}:latest`]);
    assert.match(result.output, /MoeCloud ist jetzt auf 2\.4\.0, vorher 2\.3\.0/);
    assert.doesNotMatch(result.output, /festgehalten|Die Website nennt/);
    assert.doesNotMatch(host.env(), /MOECLOUD_(VERSION|PIN)/);
    assert.match(host.env(), /^MOECLOUD_PORT=3000$/m);
    assert.ok(host.calls().includes('curl http://127.0.0.1:3000/healthz'));
  });

  it('löst eine festgehaltene Version und sagt das dazu', () => {
    const host = installed('2.3.0');
    host.addEnv('MOECLOUD_VERSION=2.3.0\nMOECLOUD_PIN=1');
    host.publish('latest', '2.4.0');
    const result = host.moecloud('update');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Die festgehaltene Version 2\.3\.0 gilt nicht mehr, MoeCloud nimmt das Image latest/);
    assert.equal(host.running(), '2.4.0');
    assert.doesNotMatch(host.env(), /MOECLOUD_(VERSION|PIN)/);
  });

  it('meldet nichts Neues, wenn latest schon läuft', () => {
    const host = installed('2.4.0');
    host.announce('2.4.0');
    host.addEnv('MOECLOUD_TAG="latest"');
    const result = host.moecloud('update');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /MoeCloud 2\.4\.0 ist aktuell/);
    assert.doesNotMatch(result.output, /Die Website nennt|bleibt bei diesem Image/);
    assert.match(host.moecloud('status').output, /Updates\s+von Hand mit sudo moecloud update/);
  });

  it('sagt Bescheid, wenn die Website eine Version nennt, die latest noch nicht enthält', () => {
    const host = installed('2.3.0');
    host.announce('2.4.0');
    const result = host.moecloud('update');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /MoeCloud 2\.3\.0 ist aktuell/);
    assert.match(result.output, /Die Website nennt schon 2\.4\.0, das Image latest enthält noch 2\.3\.0/);
  });

  it('nimmt keine Versionsnummer mehr an und ändert dann nichts', () => {
    const host = installed('2.3.0');
    host.publish('latest', '2.4.0');
    const before = host.env();
    const result = host.moecloud('update', '--version', '2.3.0');
    assert.equal(result.status, 1);
    assert.match(result.output, /MoeCloud läuft immer mit dem Image latest\. Lass --version weg/);
    assert.deepEqual(host.events(), []);
    assert.equal(host.env(), before);
    assert.equal(host.running(), '2.3.0');
    const latest = host.moecloud('update', '--version', 'latest');
    assert.equal(latest.status, 0, latest.output);
    assert.equal(host.running(), '2.4.0');
    assert.doesNotMatch(host.install('--help').output, /--version/);
  });

  it('bleibt bei dem Image aus MOECLOUD_TAG', () => {
    const host = installed('2.3.0');
    host.publish('latest', '2.4.0');
    host.publish('sha-1a2b3c4', '2.3.0');
    host.announce('2.4.0');
    host.addEnv('MOECLOUD_TAG=sha-1a2b3c4');
    const result = host.moecloud('update');
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(host.events(), ['backup', `pull ${IMAGE}:sha-1a2b3c4`, `up ${IMAGE}:sha-1a2b3c4`]);
    assert.match(result.output, /MOECLOUD_TAG=sha-1a2b3c4, MoeCloud bleibt bei diesem Image/);
    assert.doesNotMatch(result.output, /Die Website nennt/);
    assert.match(host.env(), /^MOECLOUD_TAG=sha-1a2b3c4$/m);
    assert.equal(host.running(), '2.3.0');
    assert.match(host.moecloud('status').output, /Updates\s+bleiben beim Image sha-1a2b3c4/);
  });

  it('lässt MoeCloud laufen, wenn es das Image aus MOECLOUD_TAG nicht gibt', () => {
    const host = installed('2.3.0');
    host.addEnv('MOECLOUD_TAG=2.3.0');
    const result = host.moecloud('update');
    assert.equal(result.status, 1);
    assert.match(result.output, /manifest unknown/);
    assert.match(result.output, /Das Image mit dem Tag 2\.3\.0 ließ sich nicht laden\. Prüf MOECLOUD_TAG/);
    assert.match(result.output, /MoeCloud läuft unverändert weiter/);
    assert.deepEqual(host.events(), ['backup', `pull ${IMAGE}:2.3.0`]);
    assert.equal(host.running(), '2.3.0');
  });

  it('erklärt eine Registry, die nicht antwortet', () => {
    const host = installed('2.3.0');
    host.withdraw('latest');
    const result = host.moecloud('update');
    assert.equal(result.status, 1);
    assert.match(result.output, /Die Images ließen sich nicht laden\. Prüf die Verbindung zu ghcr\.io/);
    assert.match(result.output, /MoeCloud läuft unverändert weiter/);
    assert.doesNotMatch(result.output, /Das hat nicht geklappt/);
    assert.equal(host.running(), '2.3.0');
  });
});

describe('Befehl moecloud auf dem Server', { skip }, () => {
  it('zeigt im Status die Version, die läuft', () => {
    const host = installed('2.4.0');
    const result = host.moecloud('status');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /^MoeCloud 2\.4\.0$/m);
    assert.match(result.output, /Updates\s+von Hand mit sudo moecloud update/);
    host.moecloud('stop');
    assert.match(host.moecloud('status').output, /^MoeCloud$/m);
  });

  it('startet auch dann latest, wenn in der .env noch eine alte Versionszeile steht', () => {
    const host = installed('2.4.0');
    host.addEnv('MOECLOUD_VERSION=2.3.0\nMOECLOUD_PIN=0');
    host.moecloud('stop');
    const result = host.moecloud('start');
    assert.equal(result.status, 0, result.output);
    assert.equal(host.events().at(-1), `up ${IMAGE}:latest`);
    assert.equal(host.running(), '2.4.0');
  });
});

describe('Zusatzdienste über das Skript', { skip }, () => {
  it('richtet mit --all Virenscan, Office-Vorschau und Collabora ein und lässt die Grunddatei schlank', () => {
    const host = fakeHost();
    hosts.push(host);
    host.publish('latest', '2.4.0');
    const result = host.install('--yes', '--all');
    assert.equal(result.status, 0, result.output);
    assert.match(host.env(), /^COMPOSE_FILE=docker-compose\.yml:docker\/clamav\.yml:docker\/office\.yml:docker\/collabora\.yml$/m);
    assert.ok(existsSync(join(host.dir, 'docker', 'collabora.yml')));
    assert.doesNotMatch(readFileSync(join(host.dir, 'docker-compose.yml'), 'utf8'), /^ {2}(collabora|clamav|office):$/m);
    assert.match(result.output, /Collabora Online läuft mit/);
    const status = host.moecloud('status');
    assert.match(status.output, /Office bearbeiten\s+Collabora Online/);
    assert.match(status.output, /Office-Vorschau\s+LibreOffice/);
  });

  it('nimmt ohne Angabe nichts dazu und schaltet Collabora später ein und aus', () => {
    const host = installed('2.4.0');
    assert.doesNotMatch(host.env(), /COMPOSE_FILE/);
    assert.match(host.moecloud('status').output, /Office bearbeiten\s+nicht eingerichtet/);
    host.addEnv('PUBLIC_URL=https://cloud.example.com');
    const on = host.moecloud('collabora', 'on');
    assert.equal(on.status, 0, on.output);
    assert.match(host.env(), /^COMPOSE_FILE=docker-compose\.yml:docker\/collabora\.yml$/m);
    assert.match(host.env(), /^OFFICE_HTTPS=true$/m);
    assert.ok(host.calls().includes('compose pull collabora'));
    assert.equal(host.moecloud('collabora', 'on').status, 1);
    assert.match(host.moecloud('collabora').output, /Collabora Online läuft in einem eigenen Container/);
    const off = host.moecloud('collabora', 'off');
    assert.equal(off.status, 0, off.output);
    assert.doesNotMatch(host.env(), /COMPOSE_FILE/);
    assert.equal(host.moecloud('collabora', 'off').status, 1);
    assert.equal(host.moecloud('collabora', 'vielleicht').status, 1);
  });

  it('behält bei einem Update, was eingerichtet ist', () => {
    const host = fakeHost();
    hosts.push(host);
    host.publish('latest', '2.4.0');
    assert.equal(host.install('--yes', '--collabora', '--office').status, 0);
    const before = host.env().match(/^COMPOSE_FILE=.*$/m)?.[0];
    assert.equal(before, 'COMPOSE_FILE=docker-compose.yml:docker/office.yml:docker/collabora.yml');
    host.publish('latest', '2.5.0');
    const update = host.moecloud('update');
    assert.equal(update.status, 0, update.output);
    assert.equal(host.env().match(/^COMPOSE_FILE=.*$/m)?.[0], before);
    assert.equal(host.running(), '2.5.0');
  });
});

describe('Compose-Dateien', () => {
  const services = (file: string) => [...readFileSync(join(root, file), 'utf8').matchAll(/^ {2}([a-z]+):$/gm)].map((match) => match[1]);

  it('nimmt das Image latest und hört nicht auf MOECLOUD_VERSION', () => {
    for (const file of ['docker-compose.yml', 'compose.yaml']) {
      const compose = readFileSync(join(root, file), 'utf8');
      assert.match(compose, /^ {4}image: ghcr\.io\/maximiliangt500\/moecloud:\$\{MOECLOUD_TAG:-latest\}$/m);
      assert.doesNotMatch(compose, /MOECLOUD_VERSION/);
    }
  });

  it('bringt in compose.yaml alles mit und hält docker-compose.yml schlank, weil ältere Skripte sie bei jedem Update laden', () => {
    assert.deepEqual(
      services('compose.yaml')
        .filter((name) => !['office', 'caddy-data', 'caddy-config'].includes(name))
        .sort(),
      ['caddy', 'clamav', 'collabora', 'moecloud']
    );
    assert.ok(services('compose.yaml').includes('office'));
    assert.deepEqual(
      services('docker-compose.yml').filter((name) => !name.startsWith('caddy-')),
      ['moecloud', 'caddy']
    );
    const full = readFileSync(join(root, 'compose.yaml'), 'utf8');
    assert.match(full, /COLLABORA_INTERNAL_URL: \$\{COLLABORA_INTERNAL_URL:-http:\/\/collabora:9980\}/);
    assert.match(full, /COLLABORA_WOPI_URL: \$\{COLLABORA_WOPI_URL:-http:\/\/moecloud:3000\}/);
    assert.match(full, /aliasgroup1: http:\/\/moecloud:3000/);
    assert.doesNotMatch(full.slice(full.indexOf('  collabora:'), full.indexOf('  office:')), /ports:/);
  });
});
