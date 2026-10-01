/** Site-wide content. Every claim here matches what the Accord repository actually does. */

export const GITHUB_REPO = 'ShreyanshGoyal/top_secret';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

export const NAV_LINKS = [
  { label: 'Product', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Stack', href: '#stack' },
  { label: 'FAQ', href: '#faq' },
] as const;

export const STEPS = [
  {
    title: 'Capture a decision',
    body: 'Point Accord at a decision in any connected tool. The decision owner confirms it; anyone else can only propose one.',
  },
  {
    title: 'Investigate code and data',
    body: 'Accord reads the policy code at a pinned GitHub commit and counts affected records from a read-only ClickHouse view.',
  },
  {
    title: 'One finding, kept current',
    body: 'A single finding is updated wherever the decision lives, as it changes, until a fix is verified at its pull-request commit.',
  },
] as const;

export const PRINCIPLES = [
  { title: 'Read-only by design', body: 'GitHub access never writes. The data role can read one aggregate view and nothing else.' },
  { title: 'Unknown is not zero', body: 'A missing count stays null and a missing path is “unsupported”, never a silent “no conflict”.' },
  { title: 'Stale work never wins', body: 'Decision version and context revision are compared in one transaction before a result becomes current.' },
  { title: 'Evidence, not assertion', body: 'Every cited file is checked against the repository snapshot before anything reaches your team.' },
] as const;

/**
 * Official logos, served from /public/logos. Sources: svgl.app (official brand SVGs), the
 * Trigger.dev and CopilotKit repositories, and Simple Icons for ClickHouse. `tile: 'dark'` marks
 * logos designed for dark backgrounds; they sit on a dark tile, as in the brand's own app icon.
 */
export const TECHNOLOGIES: ReadonlyArray<{ name: string; role: string; logo: string; tile?: 'dark' }> = [
  { name: 'Google Gemini', role: 'Interprets decisions, runs agent tools', logo: 'gemini.svg' },
  { name: 'CopilotKit', role: 'Agent runtime across team channels', logo: 'copilotkit.svg' },
  { name: 'Trigger.dev', role: 'Durable jobs and reconciliation', logo: 'triggerdev.svg', tile: 'dark' },
  { name: 'PostgreSQL', role: 'Decisions, findings and outbox', logo: 'postgresql.svg' },
  { name: 'ClickHouse', role: 'Read-only impact analysis', logo: 'clickhouse.svg', tile: 'dark' },
  { name: 'GitHub', role: 'Code, commits, issues and PRs', logo: 'github.svg' },
  { name: 'Vercel AI SDK', role: 'Model and tool-calling layer', logo: 'vercel.svg' },
  { name: 'TypeScript', role: 'Strict contracts across packages', logo: 'typescript.svg' },
  { name: 'Node.js', role: 'Bridge and worker runtime', logo: 'nodejs.svg' },
  { name: 'Zod', role: 'Validation at every boundary', logo: 'zod.svg' },
  { name: 'Docker', role: 'Local PostgreSQL and ClickHouse', logo: 'docker.svg' },
];

export const FAQS = [
  {
    q: 'Does Accord change my code or data?',
    a: 'No. GitHub access is read-only, and the database role can only read one aggregate view. Accord suggests changes and verifies fixes you make; it never writes, deletes or opens pull requests itself.',
  },
  {
    q: 'What data does the AI model see?',
    a: 'The decision and its conversation, the code files it reads, and aggregate counts. Secret-bearing files such as .env are never read, credential-shaped text is redacted first, and individual customer records never leave your database.',
  },
  {
    q: 'Which decisions can it check today?',
    a: 'The current release is a focused MVP: data-retention decisions (which plans or organisation types keep records for how many days) against one repository and one dataset. Code, commit, issue and pull-request questions work across the whole repository.',
  },
  {
    q: 'Does it read every conversation?',
    a: 'No. Accord only looks at the tools you choose in your dashboard, and only at decisions it is pointed to. Only the decision owner can make a decision binding.',
  },
  {
    q: 'Which model does it use?',
    a: 'Google Gemini by default, through its OpenAI-compatible API. OpenAI models are supported by configuration. Model output is validated against strict schemas before it can change anything.',
  },
  {
    q: 'How do I get access?',
    a: 'Accord is in private preview with a small group of design-partner teams. Request a demo and we will set up a pilot with your team’s tools and one repository.',
  },
] as const;
