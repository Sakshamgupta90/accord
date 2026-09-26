import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToIR } from '@copilotkit/channels/ui';
import { renderSlackMessage } from '@copilotkit/channels/slack';
import { ChangeOptionsCard, orderOptions, ungroundedPaths, type ChangeOptions } from '../suggest-tools.js';

const files = new Map<string, string>([
  ['AGENTS.md', ''],
  ['apps/channel/src/server.ts', ''],
  ['apps/channel/src/config.ts', ''],
  ['packages/accord-core/src/coordinator.ts', ''],
]);

function option(rank: number, fitScore: number, paths: Array<[string, boolean]>): ChangeOptions['options'][number] {
  return {
    rank, title: `Option ${rank}`, approach: 'Do the thing in the established way.',
    files: paths.map(([path, isNew]) => ({ path, isNew, change: 'adjust' })),
    pros: ['fits the pattern'], cons: ['more files'], effort: 'medium', risk: 'low', fitScore, whyThisRank: 'Because.',
  };
}

test('only real files, or new files inside an existing folder, count as grounded', () => {
  const bad = ungroundedPaths([
    option(1, 9, [['apps/channel/src/server.ts', false], ['apps/channel/src/rate-limit.ts', true]]),
    option(2, 7, [['apps/channel/src/invented.ts', false], ['nowhere/new.ts', true], ['apps/channel/src/config.ts', true]]),
  ], files);
  assert.deepEqual(bad, ['apps/channel/src/invented.ts', 'nowhere/new.ts (marked new)', 'apps/channel/src/config.ts (marked new)']);
});

test('options are ordered by rank and renumbered without gaps', () => {
  const ordered = orderOptions([option(3, 5, [['AGENTS.md', false]]), option(1, 9, [['AGENTS.md', false]])]);
  assert.deepEqual(ordered.map((o) => [o.rank, o.fitScore]), [[1, 9], [2, 5]]);
});

test('the ranked card renders valid, bounded Slack blocks with the recommendation first', () => {
  const long = 'x'.repeat(5000);
  const input: ChangeOptions = {
    request: 'Add rate limiting to the Slack bridge',
    options: [
      option(2, 6, [['apps/channel/src/config.ts', false]]),
      { ...option(1, 9, [['apps/channel/src/server.ts', false], ['apps/channel/src/rate-limit.ts', true]]), approach: long },
      option(3, 4, [['packages/accord-core/src/coordinator.ts', false]]),
    ],
    recommendation: 'Use option 1.',
  };
  const { blocks, accent } = renderSlackMessage(renderToIR(<ChangeOptionsCard input={input} repo={{ owner: 'acme', name: 'app' }} sha={'a'.repeat(40)} />));
  assert.equal(accent, '#4A154B');
  assert.ok(blocks.length <= 50, `blocks: ${blocks.length}`);
  const text = JSON.stringify(blocks);
  assert.ok(text.indexOf('#1 · Option 1') < text.indexOf('#2 · Option 2'));
  assert.ok(text.includes('Recommended'));
  assert.ok(text.includes(`https://github.com/acme/app/blob/${'a'.repeat(40)}/apps/channel/src/server.ts`));
  assert.ok(text.includes('rate-limit.ts') && text.includes('(new)'));
  for (const block of blocks as Array<{ text?: { text?: string } }>) {
    assert.ok((block.text?.text?.length ?? 0) <= 3000);
  }
});
