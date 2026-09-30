/**
 * Periodically drains the Slack semantic-index queue. The Slack bridge only persists sanitized
 * text; this task is the sole path that sends it to the configured embedding provider.
 */
import { schedules } from '@trigger.dev/sdk';
import { createEmbeddingPort, embeddingConfigFromEnvironment, SlackThreadKnowledgeService } from '@accord/store';
import { createPrivacyPort, createSafeLogger } from '@accord/privacy';
import { loadAccordConfig } from '@accord/core';
import { RETRY_POLICY, withRetryPolicy } from './shared.js';

export const SLACK_THREAD_KNOWLEDGE_CRON = '* * * * *';

export const slackThreadKnowledgeTask = schedules.task({
  id: 'accord-index-slack-thread-knowledge',
  cron: SLACK_THREAD_KNOWLEDGE_CRON,
  retry: RETRY_POLICY,
  maxDuration: 120,
  run: async () => {
    const config = loadAccordConfig();
    const privacy = createPrivacyPort({
      teamId: config.slack.teamId,
      channelId: config.slack.channelId,
      repository: { owner: config.github.owner, name: config.github.name },
      datasetVersion: config.dataset.version,
      knownSecretValues: [
        config.slack.botToken, config.slack.appToken, config.model.apiKey, config.github.token,
        config.clickhouse.password, config.intelligence.apiKey, config.trigger.secretKey,
      ],
    });
    const logger = createSafeLogger({ component: 'slack-thread-knowledge-indexer' });
    const service = new SlackThreadKnowledgeService({
      databaseUrl: config.postgres.databaseUrl,
      teamId: config.slack.teamId,
      channelId: config.slack.channelId,
      embedding: createEmbeddingPort(embeddingConfigFromEnvironment()),
      sanitize: (text) => privacy.sanitize(text, 'slack'),
    });
    try {
      return await withRetryPolicy(() => service.indexPending(20));
    } catch (error) {
      // The safe logger redacts known credentials. Throwing keeps Trigger's retry semantics; the
      // queue lease was released before the external provider call and is retryable on next sweep.
      logger.error('slack_semantic_index_failed', { code: 'PROVIDER_ERROR', retryable: true });
      throw error;
    } finally {
      await service.close();
    }
  },
});
