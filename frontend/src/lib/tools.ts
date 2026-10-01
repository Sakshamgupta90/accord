/** Tools a user can choose for Accord in the dashboard.
 * `pilot`: backed by Accord's current implementation and set up with design partners.
 * `soon`: on the roadmap; users can select it to register interest, but it cannot connect yet.
 */

export type ToolStatus = 'pilot' | 'soon';
export type ToolCategory = 'Conversations' | 'Email' | 'Code' | 'Data' | 'Docs & planning';

export interface Tool {
  id: string;
  name: string;
  logo: string;
  tile?: 'dark';
  category: ToolCategory;
  status: ToolStatus;
  description: string;
  /** What Accord would add to its knowledge base from this tool. */
  knowledge: string[];
}

export const CATEGORIES: ToolCategory[] = ['Conversations', 'Email', 'Code', 'Data', 'Docs & planning'];

export const TOOLS: Tool[] = [
  {
    id: 'slack', name: 'Slack', logo: 'slack.svg', category: 'Conversations', status: 'pilot',
    description: 'Capture decisions from threads that mention Accord.',
    knowledge: ['Decisions and their versions', 'Who confirmed what, and when'],
  },
  {
    id: 'teams', name: 'Microsoft Teams', logo: 'microsoft-teams.svg', category: 'Conversations', status: 'soon',
    description: 'Capture decisions made in Teams channels and chats.',
    knowledge: ['Decisions and their versions', 'Channel context around each decision'],
  },
  {
    id: 'gmail', name: 'Gmail', logo: 'gmail.svg', category: 'Email', status: 'soon',
    description: 'Pick up decisions agreed over email threads you choose.',
    knowledge: ['Decisions from selected labels or threads', 'Approvals and sign-offs'],
  },
  {
    id: 'outlook', name: 'Outlook', logo: 'microsoft-outlook.svg', category: 'Email', status: 'soon',
    description: 'Pick up decisions from selected Outlook folders.',
    knowledge: ['Decisions from selected folders', 'Approvals and sign-offs'],
  },
  {
    id: 'github', name: 'GitHub', logo: 'github.svg', category: 'Code', status: 'pilot',
    description: 'Read code at a pinned commit, plus commits, issues and pull requests.',
    knowledge: ['Code and file history', 'Issues and pull requests', 'Who changed what'],
  },
  {
    id: 'gitlab', name: 'GitLab', logo: 'gitlab.svg', category: 'Code', status: 'soon',
    description: 'The same grounded code checks for GitLab repositories.',
    knowledge: ['Code and file history', 'Merge requests and issues'],
  },
  {
    id: 'postgresql', name: 'PostgreSQL', logo: 'postgresql.svg', category: 'Data', status: 'pilot',
    description: 'Aggregate impact counts through a restricted read-only view.',
    knowledge: ['Schema of the views you expose', 'Aggregate counts only, never rows'],
  },
  {
    id: 'clickhouse', name: 'ClickHouse', logo: 'clickhouse.svg', tile: 'dark', category: 'Data', status: 'pilot',
    description: 'Impact analysis over analytics data, read-only.',
    knowledge: ['Schema of the views you expose', 'Aggregate counts only, never rows'],
  },
  {
    id: 'notion', name: 'Notion', logo: 'notion.svg', category: 'Docs & planning', status: 'soon',
    description: 'Treat specs and decision logs as sources of intent.',
    knowledge: ['Specs and decision records', 'Linked pages'],
  },
  {
    id: 'linear', name: 'Linear', logo: 'linear.svg', category: 'Docs & planning', status: 'soon',
    description: 'Link decisions to the issues meant to implement them.',
    knowledge: ['Issues and projects', 'Status of implementation work'],
  },
  {
    id: 'drive', name: 'Google Drive', logo: 'drive.svg', category: 'Docs & planning', status: 'soon',
    description: 'Use policy documents in Drive as sources of intent.',
    knowledge: ['Policy and spec documents you select'],
  },
];

export const toolById = (id: string) => TOOLS.find((tool) => tool.id === id);
