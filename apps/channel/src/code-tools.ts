/** @accord/channel — read-only repository tools for the Slack agent.
 * Lets the agent answer questions about the configured repository's code. The repository is
 * fetched once as a tarball of the commit that ACCORD_REPO_REF resolves to and held in memory,
 * so every answer cites one pinned commit. Secret-bearing paths are dropped and credentials are
 * redacted before the model sees any text. These answers are exploration, never an Accord finding.
 */
import { defineChannelTool } from '@copilotkit/channels';
import { assertAllowedPath, sanitizeText } from '@accord/privacy';
import { LiveGitHubClient, isPathBlocked } from '@accord/repo-investigator';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';

export interface CodeToolConfig {
  githubToken: string;
  owner: string;
  name: string;
  ref: string;
  knownSecretValues: readonly string[];
}

const MAX_LISTED_PATHS = 200;
const MAX_READ_LINES = 400;
const MAX_READ_CHARS = 30_000;
const MAX_SEARCH_FILES = 15;
const MAX_MATCHES_PER_FILE = 3;
const MAX_TEXT_FILE_BYTES = 200 * 1024;
const SHA_CHECK_MS = 60_000;

// Env-style files hold credentials under names the shared guard does not know (team.env, prod.env).
const ENV_FILE = /(^|\/)[^/]*\.env(\.[^/]*)?$|(^|\/)env\.[^/]+$/i;
// Credential shapes beyond the shared redactor: CopilotKit, Trigger, Slack app, Google keys, and
// any SECRET/TOKEN/KEY/PASSWORD assignment.
const EXTRA_SECRETS: readonly RegExp[] = [
  /cpk-[A-Za-z0-9_-]{10,}/g,
  /tr_(?:dev|prod|stg)_[A-Za-z0-9]{10,}/g,
  /xapp-[A-Za-z0-9-]{10,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /AQ\.[A-Za-z0-9_-]{20,}/g,
];
const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)(\s*[=:]\s*["']?)([^\s"'`,;]{8,})/g;

export function isReadable(path: string): boolean {
  if (isPathBlocked(path) || ENV_FILE.test(path) || path.includes('node_modules/')) return false;
  try {
    assertAllowedPath(path);
    return true;
  } catch {
    return false;
  }
}

export function redact(text: string, known: readonly string[]): string {
  let out = sanitizeText(text, known);
  for (const pattern of EXTRA_SECRETS) out = out.replace(pattern, '[REDACTED_SECRET]');
  return out.replace(SECRET_ASSIGNMENT, (_m, name: string, sep: string) => `${name}${sep}[REDACTED_SECRET]`);
}

/** Text files of a GitHub tarball, keyed by repository-relative path. */
function extractTextFiles(gzipped: Buffer): Map<string, string> {
  const tar = gunzipSync(gzipped);
  const files = new Map<string, string>();
  let offset = 0;
  let paxPath: string | null = null;
  const field = (start: number, length: number) => tar.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  while (offset + 512 <= tar.length) {
    const header = offset;
    if (tar[header] === 0) break;
    const size = Number.parseInt(field(header + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(tar[header + 156] ?? 48);
    const prefix = field(header + 345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(header, 100)}` : field(header, 100));
    const body = tar.subarray(header + 512, header + 512 + size);
    offset = header + 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = match?.[1] ?? null;
      continue;
    }
    paxPath = null;
    if ((type !== '0' && type !== '\0') || size > MAX_TEXT_FILE_BYTES) continue;
    // GitHub prefixes every entry with `<owner>-<repo>-<sha>/`.
    const path = name.split('/').slice(1).join('/');
    if (!path || !isReadable(path) || body.subarray(0, 8192).includes(0)) continue;
    files.set(path, body.toString('utf8'));
  }
  return files;
}

export function createCodeTools(config: CodeToolConfig) {
  const repo = { owner: config.owner, name: config.name };
  const github = new LiveGitHubClient(config.githubToken);
  let checked: { sha: string; at: number } | null = null;
  let snapshot: Promise<{ sha: string; files: Map<string, string> }> | null = null;

  async function load(): Promise<{ sha: string; files: Map<string, string> }> {
    if (!checked || Date.now() - checked.at > SHA_CHECK_MS) {
      checked = { sha: await github.resolveRefToSha(repo, config.ref), at: Date.now() };
    }
    const sha = checked.sha;
    const current = snapshot ? await snapshot.catch(() => null) : null;
    if (current?.sha === sha) return current;
    snapshot = (async () => {
      const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/tarball/${sha}`, {
        headers: { Authorization: `Bearer ${config.githubToken}`, 'User-Agent': 'Accord-Slack-Agent/1.0' },
      });
      if (!res.ok) throw new Error(`GitHub tarball HTTP ${res.status}`);
      const files = extractTextFiles(Buffer.from(await res.arrayBuffer()));
      for (const [path, text] of files) files.set(path, redact(text, config.knownSecretValues));
      return { sha, files };
    })();
    return snapshot;
  }

  const listFiles = defineChannelTool({
    name: 'list_repo_files',
    description: `List file paths in the ${config.owner}/${config.name} repository at the pinned commit. Use to discover where code lives before reading it.`,
    parameters: z.object({
      directory: z.string().describe('Directory to list, e.g. "apps/channel/src". Empty string for the whole repository.'),
      nameContains: z.string().describe('Case-insensitive filter on the path, e.g. "retention". Empty string for no filter.'),
    }),
    async handler({ directory, nameContains }) {
      const { sha, files } = await load();
      const prefix = directory.replace(/^\/+|\/+$/g, '');
      const needle = nameContains.trim().toLowerCase();
      const paths = [...files.keys()].sort().filter((path) =>
        (prefix === '' || path.startsWith(`${prefix}/`)) && (needle === '' || path.toLowerCase().includes(needle)));
      return { commit: sha.slice(0, 7), total: paths.length, truncated: paths.length > MAX_LISTED_PATHS, paths: paths.slice(0, MAX_LISTED_PATHS) };
    },
  });

  const readFile = defineChannelTool({
    name: 'read_repo_file',
    description: `Read a file from ${config.owner}/${config.name} at the pinned commit, with line numbers and a GitHub link. Secret-bearing files are unavailable and credentials are redacted.`,
    parameters: z.object({
      path: z.string().describe('Repository-relative file path, e.g. "packages/accord-core/src/authorization.ts".'),
      startLine: z.number().int().min(1).describe('First line to return (1 for the start of the file).'),
      endLine: z.number().int().min(1).describe(`Last line to return. At most ${MAX_READ_LINES} lines per call.`),
    }),
    async handler({ path, startLine, endLine }) {
      const clean = path.replace(/^\/+/, '');
      if (!isReadable(clean)) return `Refused: ${clean} is not a permitted path for Accord to read.`;
      const { sha, files } = await load();
      const content = files.get(clean);
      if (content === undefined) return `${clean} is not a readable text file at ${sha.slice(0, 7)}. Use list_repo_files or search_repo_code to find the right path.`;
      const lines = content.split('\n');
      const from = Math.min(startLine, lines.length);
      const to = Math.min(Math.max(endLine, from), lines.length, from + MAX_READ_LINES - 1);
      let body = lines.slice(from - 1, to).map((line, index) => `${from + index}: ${line}`).join('\n');
      if (body.length > MAX_READ_CHARS) body = `${body.slice(0, MAX_READ_CHARS)}\n…[truncated]`;
      return {
        path: clean,
        commit: sha.slice(0, 7),
        lines: `${from}-${to} of ${lines.length}`,
        link: `https://github.com/${repo.owner}/${repo.name}/blob/${sha}/${clean}#L${from}-L${to}`,
        content: body,
      };
    },
  });

  const searchCode = defineChannelTool({
    name: 'search_repo_code',
    description: `Search the text of every readable file in ${config.owner}/${config.name} at the pinned commit (case-insensitive, literal). Returns files with matching lines; read them with read_repo_file.`,
    parameters: z.object({
      query: z.string().min(2).describe('Literal text to find, e.g. "retentionDays" or "function authorize".'),
    }),
    async handler({ query }) {
      const { sha, files } = await load();
      const needle = query.toLowerCase();
      const results: Array<{ path: string; matches: string[] }> = [];
      let totalFiles = 0;
      for (const path of [...files.keys()].sort()) {
        const lines = files.get(path)!.split('\n');
        const matches: string[] = [];
        lines.forEach((line, index) => {
          if (matches.length < MAX_MATCHES_PER_FILE && line.toLowerCase().includes(needle)) {
            matches.push(`${index + 1}: ${line.trim().slice(0, 200)}`);
          }
        });
        if (matches.length === 0) continue;
        totalFiles += 1;
        if (results.length < MAX_SEARCH_FILES) results.push({ path, matches });
      }
      return { query, commit: sha.slice(0, 7), totalFiles, truncated: totalFiles > results.length, results };
    },
  });

  return [listFiles, readFile, searchCode];
}
