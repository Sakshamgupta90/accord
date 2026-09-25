import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createGitHubTools } from '../github-tools.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stub(routes: Record<string, unknown>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const path = String(url).replace('https://api.github.com/repos/acme/app', '');
    seen.push(path);
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (!key) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as typeof fetch;
  return seen;
}

const tools = () => createGitHubTools({ githubToken: 't', owner: 'acme', name: 'app', knownSecretValues: ['configured-secret'] }) as any[];

test('list_issues excludes pull requests and redacts titles', async () => {
  stub({ '/issues?': [
    { number: 1, title: 'Leak configured-secret here', state: 'open', user: { login: 'a' }, labels: [], assignees: [], comments: 0, html_url: 'u1' },
    { number: 2, title: 'A PR', state: 'open', user: { login: 'b' }, pull_request: {}, labels: [], assignees: [], html_url: 'u2' },
  ] });
  const result = await tools()[2].handler({ state: 'open', limit: 5 }, {});
  assert.equal(result.length, 1);
  assert.equal(result[0].number, 1);
  assert.equal(result[0].title.includes('configured-secret'), false);
});

test('get_pull_request hides secret-bearing changed files', async () => {
  stub({
    '/pulls/7/files': [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }, { filename: '.env', status: 'added', additions: 3, deletions: 0 }],
    '/pulls/7': { number: 7, title: 'Fix', state: 'open', merged: false, user: { login: 'c' }, head: { ref: 'fix', sha: 'abcdef123' }, base: { ref: 'main' }, body: 'TOKEN=supersecretvalue', html_url: 'p7' },
  });
  const result = await tools()[5].handler({ number: 7 }, {});
  assert.deepEqual(result.changedFiles.map((f: any) => f.path), ['src/a.ts']);
  assert.equal(result.hiddenOrTruncated, 1);
  assert.equal(result.body.includes('supersecretvalue'), false);
});

test('missing items and API failures are reported, not invented', async () => {
  stub({});
  assert.match(await tools()[3].handler({ number: 9 }, {}), /does not exist/);
  globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
  assert.match(await tools()[4].handler({ state: 'open', limit: 3 }, {}), /unavailable/);
});
