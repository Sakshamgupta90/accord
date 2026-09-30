/** @accord/channel — server entrypoint.
 * Boots CopilotKit runtime with direct Slack adapter and starts persistent HTTP listener.
 */
import { createServer } from 'node:http';
import { CopilotKitIntelligence, CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node';
import { createConfiguredApplication } from '@accord/core';
import { createSlackChannel } from './channel.js';
import { loadChannelConfig } from './config.js';
import { getHealthStatus } from './health.js';

async function main() {
  const config = loadChannelConfig();
  const app = await createConfiguredApplication();

  const intelligence = new CopilotKitIntelligence({
    apiKey: config.intelligenceApiKey,
    apiUrl: config.intelligenceApiUrl,
    wsUrl: config.intelligenceWsUrl,
  });

  const slackChannel = createSlackChannel(app, config);

  const runtime = new CopilotRuntime({
    agents: {},
    intelligence,
    channels: [slackChannel.channel],
  });

  let teardown: (() => Promise<void>) | undefined;
  const shutdown = async () => {
    console.log('\n  Shutting down Accord Slack bridge...');
    await teardown?.();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  const listener = createCopilotNodeListener({ runtime, basePath: '/api/copilotkit' });
  const channels = listener.channels;

  const server = createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const health = await getHealthStatus(app, () => channels.status());
      res.writeHead(health.status === 'healthy' ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }
    listener(req, res);
  });

  teardown = async () => {
    await channels.stop();
    await slackChannel.close();
    if (server.listening) server.close();
  };

  await channels.ready({ timeoutMs: 30_000 });

  const status = channels.status();
  if (status.overall !== 'online') {
    console.error(`\n  Channel is not online: ${JSON.stringify(status)}\n`);
    await teardown();
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log(`\n  ✓ Accord Slack Channel "${config.channelCode}" online — listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal error starting Accord channel server:', err);
  process.exit(1);
});
