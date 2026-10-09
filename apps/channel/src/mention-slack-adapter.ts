import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ConversationStore } from '@copilotkit/channels';
import { SlackAdapter } from '@copilotkit/channels/slack';
import type { HistoryEntry } from './recent-context.js';

/** Keep the existing Slack transport; replace only its unbounded agent-history reconstruction. */
export class MentionSlackAdapter extends SlackAdapter {
  private readonly mentionContext = new AsyncLocalStorage<{ conversationKey: string; history: HistoryEntry[] }>();

  withContext<T>(conversationKey: string, history: HistoryEntry[], run: () => Promise<T>): Promise<T> {
    return this.mentionContext.run({ conversationKey, history }, run);
  }

  override get conversationStore(): ConversationStore {
    return {
      seedsInboundTurn: true,
      getOrCreate: async (conversationKey, _replyTarget, makeAgent) => {
        const context = this.mentionContext.getStore();
        if (!context || context.conversationKey !== conversationKey) {
          throw new Error('Accord requires an explicit mention with bounded conversation context.');
        }
        const agent = makeAgent(`slack-${conversationKey}-${randomUUID()}`);
        agent.messages = context.history.map((message) => ({
          id: message.ts,
          role: 'user' as const,
          content: JSON.stringify({ authorId: message.authorId, timestamp: message.ts, text: message.text }),
        }));
        return { agent };
      },
    };
  }
}
