import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReadable, redact } from '../code-tools.js';

test('code tools refuse secret-bearing and env-style paths', () => {
  for (const path of ['.env', 'team.env', 'config/prod.env', '.env.example', 'deploy/env.production', 'keys/server.pem', 'node_modules/x/index.js']) {
    assert.equal(isReadable(path), false, path);
  }
  for (const path of ['packages/accord-core/src/authorization.ts', 'README.md', 'apps/channel/src/environment.ts']) {
    assert.equal(isReadable(path), true, path);
  }
});

test('code tools redact configured values, known credential shapes and secret assignments', () => {
  const text = [
    'const a = "configured-secret-value";',
    'INTELLIGENCE_API_KEY=cpk-1234_abcdefghijklmnop',
    'TRIGGER_SECRET_KEY=tr_dev_abcdefghijklmnop',
    'app token xapp-1-AFAKEAPPID-0000000',
    'DB_PASSWORD: hunter2hunter2',
    'const retentionDays = 90;',
  ].join('\n');
  const out = redact(text, ['configured-secret-value']);
  for (const leaked of ['configured-secret-value', 'cpk-1234', 'tr_dev_abc', 'xapp-1-AFAKE', 'hunter2']) {
    assert.equal(out.includes(leaked), false, leaked);
  }
  assert.ok(out.includes('const retentionDays = 90;'));
  assert.equal(out.split('\n').length, 6);
});
