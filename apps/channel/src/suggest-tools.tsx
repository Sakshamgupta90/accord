/** @accord/channel — ranked change suggestions.
 * The agent reads the repository, works out up to three genuinely different ways to make a
 * requested change, and calls present_change_options. The handler checks every cited file
 * against the pinned repository snapshot before anything is posted, so an invented path is
 * returned to the agent as an error instead of reaching Slack. Suggestions only: nothing is
 * written to GitHub, and a suggestion is never an Accord finding.
 */
import {
  Context, Divider, Field, Fields, Header, Markdown, Message, Section, defineChannelTool,
} from '@copilotkit/channels';
import { z } from 'zod';
import type { RepositorySnapshot } from './code-tools.js';

const LEVEL = z.enum(['low', 'medium', 'high']);

const OptionSchema = z.object({
  rank: z.number().int().min(1).max(3).describe('1 = best fit for this project.'),
  title: z.string().describe('Short name of the approach.'),
  approach: z.string().describe('What would change and how, in 2-4 sentences.'),
  files: z.array(z.object({
    path: z.string().describe('Repository-relative path you read (or a new file inside an existing folder).'),
    isNew: z.boolean().describe('true only if this file would be created.'),
    change: z.string().describe('What changes in this file, one line.'),
  })).min(1).describe('Files the approach touches. Existing files must be ones you found with the tools.'),
  pros: z.array(z.string()).min(1),
  cons: z.array(z.string()).min(1),
  effort: LEVEL,
  risk: LEVEL,
  fitScore: z.number().int().min(1).max(10).describe('How well it fits the existing architecture and AGENTS.md rules.'),
  whyThisRank: z.string().describe('One sentence: why it ranks here relative to the others.'),
});

export const ChangeOptionsSchema = z.object({
  request: z.string().describe('The change that was asked for, restated in one line.'),
  options: z.array(OptionSchema).min(1).max(3),
  recommendation: z.string().describe('One or two sentences recommending the #1 option and when #2 would be better.'),
});

export type ChangeOptions = z.infer<typeof ChangeOptionsSchema>;

const MAX_TEXT = 600;
const MAX_ITEMS = 4;
const MAX_FILES = 6;

const clip = (text: string, limit = MAX_TEXT) => {
  const clean = text.trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
};
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Paths that are neither in the repository nor a new file inside an existing folder. */
export function ungroundedPaths(options: ChangeOptions['options'], files: ReadonlyMap<string, string>): string[] {
  const folders = new Set<string>(['']);
  for (const path of files.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join('/'));
  }
  const bad: string[] = [];
  for (const option of options) {
    for (const file of option.files) {
      const path = file.path.replace(/^\/+/, '');
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const ok = file.isNew ? !files.has(path) && folders.has(folder) : files.has(path);
      if (!ok) bad.push(`${path}${file.isNew ? ' (marked new)' : ''}`);
    }
  }
  return bad;
}

/** Options in rank order with ranks renumbered 1..n, so the card never shows gaps or ties. */
export function orderOptions(options: ChangeOptions['options']): ChangeOptions['options'] {
  return [...options]
    .sort((a, b) => a.rank - b.rank || b.fitScore - a.fitScore)
    .map((option, index) => ({ ...option, rank: index + 1 }));
}

export function ChangeOptionsCard({ input, repo, sha }: { input: ChangeOptions; repo: { owner: string; name: string }; sha: string }) {
  const options = orderOptions(input.options);
  const link = (path: string) => `https://github.com/${repo.owner}/${repo.name}/blob/${sha}/${path}`;
  return (
    <Message accent="#4A154B">
      <Header>{clip(`Suggested approaches: ${input.request}`, 150)}</Header>
      <Context>Suggestion only · ranked for fit, risk, effort, testability and security · read-only, nothing was changed · {repo.owner}/{repo.name} @ {sha.slice(0, 7)}</Context>
      {options.flatMap((option) => [
          <Divider />,
          <Section>
            <Markdown>{`**#${option.rank} · ${clip(option.title, 120)}**${option.rank === 1 ? '  ⭐ Recommended' : ''}`}</Markdown>
          </Section>,
          <Fields>
            <Field label="Fit">{`${option.fitScore}/10`}</Field>
            <Field label="Effort">{cap(option.effort)}</Field>
            <Field label="Risk">{cap(option.risk)}</Field>
          </Fields>,
          <Section>
            <Markdown>{clip(option.approach)}</Markdown>
          </Section>,
          <Section>
            <Markdown>{option.files.slice(0, MAX_FILES).map((file) => {
              const path = file.path.replace(/^\/+/, '');
              return file.isNew ? `• \`${path}\` (new): ${clip(file.change, 160)}` : `• [${path}](${link(path)}): ${clip(file.change, 160)}`;
            }).join('\n')}</Markdown>
          </Section>,
          <Section>
            <Markdown>{[
              ...option.pros.slice(0, MAX_ITEMS).map((pro) => `✅ ${clip(pro, 160)}`),
              ...option.cons.slice(0, MAX_ITEMS).map((con) => `⚠️ ${clip(con, 160)}`),
            ].join('\n')}</Markdown>
          </Section>,
          <Context>{clip(option.whyThisRank, 250)}</Context>
        ])}
      <Divider />
      <Section>
        <Markdown>{`**Recommendation:** ${clip(input.recommendation)}`}</Markdown>
      </Section>
    </Message>
  );
}

export function createSuggestTools(snapshot: RepositorySnapshot) {
  const presentChangeOptions = defineChannelTool({
    name: 'present_change_options',
    description: 'Post up to three ranked ways to make a requested code change as a Slack card. Call once, only after reading the relevant code and AGENTS.md with the repository tools. Every existing file you cite must be a real path you found.',
    parameters: ChangeOptionsSchema,
    async handler(input, { thread }) {
      const { sha, files } = await snapshot.load();
      const bad = ungroundedPaths(input.options, files);
      if (bad.length > 0) {
        return `Not posted. These paths are not in ${snapshot.owner}/${snapshot.name} at ${sha.slice(0, 7)}: ${bad.join(', ')}. Use list_repo_files or search_repo_code to find the real paths (or mark a genuinely new file isNew inside an existing folder), then call present_change_options again.`;
      }
      await thread.post(<ChangeOptionsCard input={input} repo={{ owner: snapshot.owner, name: snapshot.name }} sha={sha} />);
      const titles = orderOptions(input.options).map((option) => `#${option.rank} ${option.title}`).join('; ');
      return `Posted the ranked options card (${titles}). Reply with at most one short sentence; do not repeat the card.`;
    },
  });
  return [presentChangeOptions];
}
