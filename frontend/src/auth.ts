/** Sign-in with Google (Gmail and Google Workspace accounts) via Auth.js.
 * Sessions are signed JWT cookies, so no database is needed yet. The provider is enabled only when its
 * credentials are configured, so the sign-in page never offers a button that cannot work.
 *
 *   AUTH_SECRET                          required (generate with `npx auth secret`)
 *   AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET  Google Cloud OAuth client (Web application)
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import type { Provider } from 'next-auth/providers';

export type ProviderId = 'google';

const configured = {
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
} satisfies Record<ProviderId, boolean>;

const providers: Provider[] = [];
if (configured.google) providers.push(Google);

export function isProviderEnabled(id: ProviderId): boolean {
  return configured[id];
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: { signIn: '/signin', error: '/signin' },
  session: { strategy: 'jwt' },
  trustHost: true,
});
