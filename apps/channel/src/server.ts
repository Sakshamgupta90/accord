/** @accord/channel — server entrypoint.
 * Boots CopilotKit runtime with direct Slack adapter and starts persistent HTTP listener.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { CopilotKitIntelligence, CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node';
import { createConfiguredApplication } from '@accord/core';
import { createSlackChannel } from './channel.js';
import { loadChannelConfig } from './config.js';
import { getHealthStatus } from './health.js';
import { redact } from './code-tools.js';
import { TraceHub } from './trace.js';

async function main() {
  const config = loadChannelConfig();
  const app = await createConfiguredApplication();

  const intelligence = new CopilotKitIntelligence({
    apiKey: config.intelligenceApiKey,
    apiUrl: config.intelligenceApiUrl,
    wsUrl: config.intelligenceWsUrl,
  });

  // Live traces for the dashboard. Served only when ACCORD_TRACE_TOKEN is configured.
  const traceToken = process.env.ACCORD_TRACE_TOKEN?.trim() || null;
  const trace = new TraceHub((text) => redact(text, config.knownSecretValues));
  const slackChannel = createSlackChannel(app, config, trace);

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
    if (req.url?.startsWith('/traces')) {
      serveTraces(req, res, trace, traceToken);
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

function authorized(req: IncomingMessage, token: string | null): boolean {
  if (!token) return false;
  const given = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET /traces (snapshot) and GET /traces/stream (server-sent events). Token-protected; 404 when disabled. */
function serveTraces(req: IncomingMessage, res: ServerResponse, hub: TraceHub, token: string | null) {
  if (!token || req.method !== 'GET') {
    res.writeHead(404).end();
    return;
  }
  if (!authorized(req, token)) {
    res.writeHead(401).end();
    return;
  }
  if (req.url === '/traces') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ invocations: hub.snapshot() }));
    return;
  }
  if (req.url !== '/traces/stream') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: 'snapshot', invocations: hub.snapshot() });
  const unsubscribe = hub.subscribe(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
