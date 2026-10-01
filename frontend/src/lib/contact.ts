/** Demo request: one organisation email. Shared by the form (instant feedback) and the API route (authority). */

export interface DemoRequest {
  email: string;
  /** Honeypot: humans never see or fill this field. */
  website: string;
}

export const EMAIL_MAX = 200;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Personal mailbox providers: a demo request should come from an organisation domain. */
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'rediffmail.com', 'qq.com', '163.com',
]);

export function normalizeDemoRequest(raw: unknown): DemoRequest {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (key: keyof DemoRequest) => (typeof source[key] === 'string' ? (source[key] as string).trim() : '');
  return { email: text('email').toLowerCase(), website: text('website') };
}

/** Returns an error message, or null when the email is acceptable. */
export function validateDemoRequest(input: DemoRequest): string | null {
  if (!input.email) return 'Please enter your organisation email.';
  if (input.email.length > EMAIL_MAX || !EMAIL.test(input.email)) return 'Please enter a valid email address.';
  const domain = input.email.split('@')[1];
  if (PERSONAL_DOMAINS.has(domain)) return 'Please use your organisation email rather than a personal address.';
  return null;
}
