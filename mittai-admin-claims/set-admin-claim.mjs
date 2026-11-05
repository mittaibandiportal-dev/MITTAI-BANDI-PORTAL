import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'mittaibandi-portal';
const [, , action, rawEmail] = process.argv;
const email = (rawEmail || '').trim().toLowerCase();

if (!['grant', 'revoke', 'show'].includes(action) || !email.includes('@')) {
  console.error('Usage: node set-admin-claim.mjs <grant|revoke|show> <email>');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const auth = getAuth();

try {
  const user = await auth.getUserByEmail(email);
  const current = user.customClaims || {};

  if (action === 'show') {
    console.log(`User ${user.email} (uid ${user.uid})`);
    console.log('  disabled:', user.disabled, '| emailVerified:', user.emailVerified);
    console.log('  customClaims:', JSON.stringify(current));
    process.exit(0);
  }

  if (user.disabled) {
    console.error(`Refusing to change claims: account ${email} is disabled.`);
    process.exit(1);
  }

  const next = { ...current };
  if (action === 'grant') next.admin = true;
  else delete next.admin;

  await auth.setCustomUserClaims(user.uid, next);

  const verify = await auth.getUser(user.uid);
  console.log(`✔ ${action === 'grant' ? 'Granted' : 'Revoked'} admin for ${verify.email} (uid ${verify.uid})`);
  console.log('  customClaims now:', JSON.stringify(verify.customClaims || {}));
} catch (err) {
  console.error('Failed:', err.code || '', err.message);
  process.exit(1);
}
