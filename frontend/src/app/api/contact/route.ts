/** POST /api/contact: validates a demo request and emails it to the Accord team through Resend.
 * Configuration (server-only, never shipped to the browser):
 *   RESEND_API_KEY      required, from resend.com
 *   CONTACT_TO_EMAIL    required, where enquiries are delivered
 *   CONTACT_FROM_EMAIL  optional, a sender on a domain verified in Resend
 *                       (defaults to Resend's shared test sender)
 * Missing configuration is reported as an error: the form never claims a message was sent when it wasn't.
 */
import { NextResponse } from 'next/server';
import { normalizeDemoRequest, validateDemoRequest } from '@/lib/contact';

export const runtime = 'nodejs';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > MAX_PER_WINDOW;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function render(email: string) {
  const domain = email.split('@')[1];
  const text = `New demo request\n\nEmail: ${email}\nOrganisation domain: ${domain}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#18181b">
<h2 style="margin:0 0 12px">New Accord demo request</h2>
<p style="margin:0 0 4px"><span style="color:#71717a">Email:</span> ${escape(email)}</p>
<p style="margin:0"><span style="color:#71717a">Organisation domain:</span> ${escape(domain)}</p>
</div>`;
  return { text, html };
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many messages. Please try again in a few minutes.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const input = normalizeDemoRequest(body);
  // Bots fill the hidden field; accept silently so they learn nothing, but send nothing.
  if (input.website) return NextResponse.json({ ok: true });

  const error = validateDemoRequest(input);
  if (error) return NextResponse.json({ ok: false, error }, { status: 422 });

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!apiKey || !to) {
    console.error('[contact] RESEND_API_KEY or CONTACT_TO_EMAIL is not configured; enquiry not sent.');
    return NextResponse.json(
      { ok: false, error: 'The contact form is not configured yet. Please reach us on GitHub instead.' },
      { status: 503 },
    );
  }

  const { text, html } = render(input.email);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL || 'Accord website <onboarding@resend.dev>',
      to: [to],
      reply_to: input.email,
      subject: `Accord demo request from ${input.email}`,
      text,
      html,
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    console.error('[contact] Resend rejected the message', res?.status, await res?.text().catch(() => ''));
    return NextResponse.json({ ok: false, error: 'We could not send your message right now. Please try again shortly.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
