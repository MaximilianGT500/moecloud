import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'moecloud-test-'));
process.env.TEST_FEED_PORT = String(40_000 + Math.floor(Math.random() * 20_000));
process.env.UPDATE_CHECK_URL = `http://127.0.0.1:${process.env.TEST_FEED_PORT}/version.json`;
process.env.METRICS_TOKEN = '';
