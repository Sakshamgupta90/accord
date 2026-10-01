/** GET /api/traces/stream: relays the Accord bridge's live trace stream to a signed-in dashboard user.
 *   ACCORD_TRACE_URL    the bridge's base URL (e.g. http://localhost:3000)
 *   ACCORD_TRACE_TOKEN  shared secret; must equal ACCORD_TRACE_TOKEN in the bridge environment
 * The token never reaches the browser. When the bridge is unreachable, the stream says so.
 */
import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const status = (state: 'offline' | 'unconfigured', message: string) =>
  new Response(encoder.encode(`data: ${JSON.stringify({ type: 'status', state, message })}\n\n`), {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
  });

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const base = process.env.ACCORD_TRACE_URL;
  const token = process.env.ACCORD_TRACE_TOKEN;
  if (!base || !token) return status('unconfigured', 'Live traces are not configured for this deployment.');

  let upstream: Response;
  try {
    upstream = await fetch(`${base.replace(/\/+$/, '')}/traces/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: request.signal,
      cache: 'no-store',
    });
  } catch {
    return status('offline', 'Accord is not running right now.');
  }
  if (!upstream.ok || !upstream.body) {
    return status('offline', upstream.status === 401 ? 'The trace token does not match the Accord bridge.' : 'Accord is not streaming traces right now.');
  }

  return new Response(upstream.body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
