/**
 * Why does Myfxbook reject the login?
 *
 *   npm run check:myfxbook
 *
 * Prints ONLY what Myfxbook itself answers — its error text, whether a session
 * came back, and the outcome of one community-outlook call. It never prints the
 * email, the password or the session id, so its output is safe to paste.
 *
 * Myfxbook's API login uses the account PASSWORD. An account created through
 * Google or Apple sign-in has no password until one is set in Myfxbook's
 * settings, and two-factor authentication blocks API logins; both produce
 * "Wrong email/password" even when the website login works.
 */

import { MYFXBOOK } from '@/config/sources.config';
import { sessionParam, strictEncode } from '@/lib/connectors/crowd';

async function main() {
  const email = process.env.MYFXBOOK_EMAIL?.trim();
  const password = process.env.MYFXBOOK_PASSWORD?.trim();

  console.log('Myfxbook check');
  console.log('----------------------------------------------------------');
  console.log(`  email set      ${email ? 'yes' : 'NO'}${email && email !== process.env.MYFXBOOK_EMAIL ? ' (had surrounding spaces)' : ''}`);
  console.log(`  password set   ${password ? 'yes' : 'NO'}${password && password !== process.env.MYFXBOOK_PASSWORD ? ' (had surrounding spaces)' : ''}`);
  if (!email || !password) {
    console.log('\nFAIL: set MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD in .env.local.');
    process.exit(1);
  }

  const specials = /[!'()*~]/.test(password);
  console.log(`  password has one of ! ' ( ) * ~   ${specials ? 'yes (sent percent-encoded)' : 'no'}`);

  const loginUrl = `${MYFXBOOK.login}?email=${strictEncode(email)}&password=${strictEncode(password)}`;
  const response = await fetch(loginUrl);
  console.log(`  http           ${response.status} ${response.headers.get('content-type') ?? ''}`);
  const login = (await response.json()) as { error?: boolean; message?: string; session?: string };
  console.log(`  login          ${login.error ? `rejected — "${login.message ?? 'no message'}"` : 'ok'}`);
  console.log(`  session        ${login.session ? 'returned' : 'none'}`);

  if (login.error || !login.session) {
    console.log(
      '\nFAIL: Myfxbook refused the credentials. If the website login works, the usual causes are:\n' +
        '  1. the account signs in with Google/Apple and has no Myfxbook password — set one under Settings;\n' +
        '  2. two-factor authentication is on, which the API login does not support;\n' +
        '  3. the password in .env.local differs from the website one (check for a trailing character).',
    );
    process.exit(1);
  }

  const outlook = (await fetch(`${MYFXBOOK.outlook}?session=${sessionParam(login.session)}`).then((r) => r.json())) as {
    error?: boolean;
    message?: string;
    symbols?: unknown[];
  };
  console.log(
    `  outlook        ${outlook.error ? `rejected — "${outlook.message ?? 'no message'}"` : `ok, ${outlook.symbols?.length ?? 0} symbols`}`,
  );
  console.log('----------------------------------------------------------');
  console.log(outlook.error ? '\nFAIL: login works but the outlook call refuses the session.' : '\nPASS: Myfxbook crowd data is reachable.');
  process.exit(outlook.error ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
