import { LIMITS } from '@accord/contracts';

export const PREVIOUS_MESSAGE_LIMIT = 50;
const SLACK_TS = /^\d+\.\d+$/;
export type HistoryEntry = { ts: string; authorId: string; text: string };
type HistoryMessage = {
  ts?: string; text?: string; user?: string; bot_id?: string; subtype?: string;
};
type HistoryPage = {
  ok?: boolean;
  messages?: HistoryMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
};

function compareTs(a: string, b: string): number {
  const [as = '', af = ''] = a.split('.');
  const [bs = '', bf = ''] = b.split('.');
  if (BigInt(as) !== BigInt(bs)) return BigInt(as) < BigInt(bs) ? -1 : 1;
  return af.padEnd(12, '0').localeCompare(bf.padEnd(12, '0'));
}

/** Read only on a mention. Channel history is newest-first; thread replies are oldest-first. */
export async function recentSlackContext(input: {
  inbound: HistoryEntry;
  botUserId: string;
  isThread: boolean;
  readPage: (cursor?: string) => Promise<HistoryPage>;
  sanitize: (text: string) => string;
}): Promise<{ history: HistoryEntry[]; complete: boolean }> {
  const messages = new Map<string, HistoryMessage>();
  let cursor: string | undefined;
  let complete = false;
  try {
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const page = await input.readPage(cursor);
      if (page.ok !== true || !Array.isArray(page.messages)) throw new Error('history unavailable');
      for (const message of page.messages) {
        if (message.ts && SLACK_TS.test(message.ts) && compareTs(message.ts, input.inbound.ts) < 0) {
          messages.set(message.ts, message);
        }
      }
      const next = page.response_metadata?.next_cursor?.trim();
      const more = Boolean(next) || page.has_more === true;
      if (!more) { complete = true; break; }
      // Channel pages already contain the newest messages. Replies require paging to the end.
      if (!input.isThread && messages.size >= PREVIOUS_MESSAGE_LIMIT) break;
      if (!next || next === cursor) break;
      cursor = next;
    }
  } catch {
    // A partial prefix of oldest-first replies is not the most recent window.
    complete = false;
  }
  const ordered = [...messages.values()].sort((a, b) => compareTs(a.ts!, b.ts!));
  const recent = input.isThread && !complete ? [] : ordered.slice(-PREVIOUS_MESSAGE_LIMIT);
  const history = recent
    .filter((m) => !m.bot_id && m.user && m.user !== input.botUserId
      && (!m.subtype || m.subtype === 'file_share') && m.text?.trim())
    .map((m) => ({ ts: m.ts!, authorId: m.user!, text: input.sanitize(m.text!).slice(0, LIMITS.messageText) }));
  const currentText = input.sanitize(input.inbound.text);
  const current = { ...input.inbound, text: currentText.slice(0, LIMITS.messageText) };
  history.push(current);
  complete = complete && ordered.length <= PREVIOUS_MESSAGE_LIMIT && currentText.length <= LIMITS.messageText;
  let total = history.reduce((sum, m) => sum + m.text.length, 0);
  while (history.length > 1 && total > LIMITS.snapshotCharacters) {
    total -= history.shift()!.text.length;
    complete = false;
  }
  return { history, complete };
}
