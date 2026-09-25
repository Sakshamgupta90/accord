/** @accord/channel — read-only GitHub activity tools for the Slack agent.
 * Commits, issues and pull requests of the one configured repository. Nothing here writes to
 * GitHub. Every piece of text is redacted before the model sees it, and changed-file lists drop
 * secret-bearing paths. These answers are exploration, never an Accord finding.
 */
import { defineChannelTool } from '@copilotkit/channels';
import { z } from 'zod';
import { isReadable, redact } from './code-tools.js';

export interface GitHubToolConfig {
  githubToken: string;
  owner: string;
  name: string;
  knownSecretValues: readonly string[];
}

const MAX_LIST = 20;
const MAX_BODY_CHARS = 4_000;
const MAX_COMMENTS = 10;
const MAX_COMMENT_CHARS = 1_000;
const MAX_FILES = 50;

export function createGitHubTools(config: GitHubToolConfig) {
  const base = `https://api.github.com/repos/${config.owner}/${config.name}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.githubToken}`,
    'User-Agent': 'Accord-Slack-Agent/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function get(path: string): Promise<any> {
    const res = await fetch(`${base}${path}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API error HTTP ${res.status}`);
    return res.json();
  }

  const text = (value: unknown, limit: number): string => {
    const raw = typeof value === 'string' ? value : '';
    const clean = redact(raw, config.knownSecretValues);
    return clean.length > limit ? `${clean.slice(0, limit)}…[truncated]` : clean;
  };
  const person = (value: any): string | null => value?.login ?? null;
  const files = (list: any[] | undefined) => {
    const visible = (list ?? []).filter((file) => typeof file?.filename === 'string' && isReadable(file.filename));
    return {
      changedFiles: visible.slice(0, MAX_FILES).map((file) => ({
        path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions,
      })),
      hiddenOrTruncated: (list?.length ?? 0) - Math.min(visible.length, MAX_FILES),
    };
  };
  const failure = (what: string) => `GitHub ${what} is unavailable right now. Say so rather than guessing.`;

  const listCommits = defineChannelTool({
    name: 'list_recent_commits',
    description: `List recent commits in ${config.owner}/${config.name}: author, date, message. Optionally only commits touching a path (who changed a file or folder).`,
    parameters: z.object({
      path: z.string().describe('Only commits touching this file or folder, e.g. "packages/accord-core". Empty string for all commits.'),
      branch: z.string().describe('Branch or ref. Empty string for the default branch.'),
      limit: z.number().int().min(1).max(MAX_LIST).describe(`How many commits, 1-${MAX_LIST}.`),
    }),
    async handler({ path, branch, limit }) {
      const query = new URLSearchParams({ per_page: String(limit) });
      if (path.trim()) query.set('path', path.trim().replace(/^\/+/, ''));
      if (branch.trim()) query.set('sha', branch.trim());
      try {
        const data = await get(`/commits?${query}`);
        if (!data) return 'No commits found for that branch or path.';
        return (data as any[]).map((c) => ({
          sha: String(c.sha).slice(0, 7),
          author: person(c.author) ?? c.commit?.author?.name ?? null,
          date: c.commit?.author?.date ?? null,
          message: text(c.commit?.message, 500),
          link: c.html_url,
        }));
      } catch {
        return failure('commit history');
      }
    },
  });

  const getCommit = defineChannelTool({
    name: 'get_commit',
    description: 'Details of one commit: author, date, full message, and the files it changed with line counts.',
    parameters: z.object({
      sha: z.string().min(4).describe('Commit SHA (short or full) or a branch name for its latest commit.'),
    }),
    async handler({ sha }) {
      try {
        const c = await get(`/commits/${encodeURIComponent(sha.trim())}`);
        if (!c) return `No commit ${sha} in ${config.owner}/${config.name}.`;
        return {
          sha: String(c.sha).slice(0, 7),
          author: person(c.author) ?? c.commit?.author?.name ?? null,
          date: c.commit?.author?.date ?? null,
          message: text(c.commit?.message, MAX_BODY_CHARS),
          stats: c.stats ?? null,
          ...files(c.files),
          link: c.html_url,
        };
      } catch {
        return failure('commit details');
      }
    },
  });

  const listIssues = defineChannelTool({
    name: 'list_issues',
    description: `List issues in ${config.owner}/${config.name} (pull requests excluded): number, title, state, author, labels, assignees.`,
    parameters: z.object({
      state: z.enum(['open', 'closed', 'all']).describe('Which issues to list. Use "open" unless asked otherwise.'),
      limit: z.number().int().min(1).max(MAX_LIST).describe(`How many issues, 1-${MAX_LIST}.`),
    }),
    async handler({ state, limit }) {
      try {
        // The issues endpoint also returns pull requests; over-fetch, then drop them.
        const data = (await get(`/issues?state=${state}&per_page=${Math.min(100, limit * 3)}&sort=updated`)) as any[] | null;
        const issues = (data ?? []).filter((i) => !i.pull_request).slice(0, limit);
        if (issues.length === 0) return `There are no ${state === 'all' ? '' : `${state} `}issues in ${config.owner}/${config.name}.`;
        return issues.map((i) => ({
          number: i.number,
          title: text(i.title, 300),
          state: i.state,
          author: person(i.user),
          labels: (i.labels ?? []).map((l: any) => l.name),
          assignees: (i.assignees ?? []).map(person),
          comments: i.comments,
          updatedAt: i.updated_at,
          link: i.html_url,
        }));
      } catch {
        return failure('issues');
      }
    },
  });

  const getIssue = defineChannelTool({
    name: 'get_issue',
    description: 'Read one issue: description and its most recent comments.',
    parameters: z.object({ number: z.number().int().min(1).describe('Issue number.') }),
    async handler({ number }) {
      try {
        const i = await get(`/issues/${number}`);
        if (!i) return `Issue #${number} does not exist in ${config.owner}/${config.name}.`;
        if (i.pull_request) return `#${number} is a pull request; use get_pull_request.`;
        const comments = i.comments > 0 ? ((await get(`/issues/${number}/comments?per_page=100`)) as any[] ?? []) : [];
        return {
          number: i.number,
          title: text(i.title, 300),
          state: i.state,
          author: person(i.user),
          labels: (i.labels ?? []).map((l: any) => l.name),
          assignees: (i.assignees ?? []).map(person),
          createdAt: i.created_at,
          body: text(i.body, MAX_BODY_CHARS),
          latestComments: comments.slice(-MAX_COMMENTS).map((c) => ({ author: person(c.user), at: c.created_at, body: text(c.body, MAX_COMMENT_CHARS) })),
          link: i.html_url,
        };
      } catch {
        return failure('issue details');
      }
    },
  });

  const listPulls = defineChannelTool({
    name: 'list_pull_requests',
    description: `List pull requests in ${config.owner}/${config.name}: number, title, state, author, branches, draft/merged.`,
    parameters: z.object({
      state: z.enum(['open', 'closed', 'all']).describe('Which pull requests to list. Use "open" unless asked otherwise.'),
      limit: z.number().int().min(1).max(MAX_LIST).describe(`How many pull requests, 1-${MAX_LIST}.`),
    }),
    async handler({ state, limit }) {
      try {
        const data = ((await get(`/pulls?state=${state}&per_page=${limit}&sort=updated&direction=desc`)) as any[] | null) ?? [];
        if (data.length === 0) return `There are no ${state === 'all' ? '' : `${state} `}pull requests in ${config.owner}/${config.name}.`;
        return data.map((p) => ({
          number: p.number,
          title: text(p.title, 300),
          state: p.state,
          merged: Boolean(p.merged_at),
          draft: p.draft,
          author: person(p.user),
          from: p.head?.ref,
          into: p.base?.ref,
          updatedAt: p.updated_at,
          link: p.html_url,
        }));
      } catch {
        return failure('pull requests');
      }
    },
  });

  const getPull = defineChannelTool({
    name: 'get_pull_request',
    description: 'Read one pull request: description, status, reviewers, head commit and changed files.',
    parameters: z.object({ number: z.number().int().min(1).describe('Pull request number.') }),
    async handler({ number }) {
      try {
        const p = await get(`/pulls/${number}`);
        if (!p) return `Pull request #${number} does not exist in ${config.owner}/${config.name}.`;
        const changed = ((await get(`/pulls/${number}/files?per_page=100`)) as any[] | null) ?? [];
        return {
          number: p.number,
          title: text(p.title, 300),
          state: p.state,
          merged: p.merged,
          draft: p.draft,
          mergeable: p.mergeable,
          author: person(p.user),
          from: p.head?.ref,
          into: p.base?.ref,
          headCommit: String(p.head?.sha ?? '').slice(0, 7),
          requestedReviewers: (p.requested_reviewers ?? []).map(person),
          commits: p.commits,
          additions: p.additions,
          deletions: p.deletions,
          body: text(p.body, MAX_BODY_CHARS),
          ...files(changed),
          link: p.html_url,
        };
      } catch {
        return failure('pull request details');
      }
    },
  });

  return [listCommits, getCommit, listIssues, getIssue, listPulls, getPull];
}
