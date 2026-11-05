#!/usr/bin/env node
/**
 * MITTAI BANDI — Admin custom-claim manager (TRUSTED ENVIRONMENT ONLY)
 *
 * Grants or revokes the `admin: true` Firebase custom claim using the Firebase Admin SDK.
 * Run this ONLY from Google Cloud Shell or your own machine. It must never be deployed,
 * bundled into the website, or executed in a browser.
 *
 * Credentials (never commit, never place inside the website folder):
 *   - Cloud Shell: uses your Google login automatically (Application Default Credentials).
 *   - Local machine: set GOOGLE_APPLICATION_CREDENTIALS to the absolute path of a service
 *     account key stored OUTSIDE this project, or use `gcloud auth application-default login`.
 *
 * Usage:
 *   node set-admin-claim.mjs grant  mittaibandiportal@gmail.com
 *   node set-admin-claim.mjs revoke someone@example.com
 *   node set-admin-claim.mjs show   mittaibandiportal@gmail.com
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'mittaibandi-portal';
const [, , action, rawEmail, customKeyPath] = process.argv;
const email = (rawEmail || '').trim().toLowerCase();

if (!['grant', 'revoke', 'show'].includes(action) || !email.includes('@')) {
  console.error('Usage: node set-admin-claim.mjs <grant|revoke|show> <email> [optional-service-account-path]');
  process.exit(1);
}

// Credential resolution order:
// 1. Argument passed: node set-admin-claim.mjs grant email path/to/key.json
// 2. GOOGLE_APPLICATION_CREDENTIALS environment variable
// 3. Local service-account.json inside tools/admin-claims/
// 4. Cloud Shell / GCP Application Default Credentials
let credential;
const candidateKeyPath = customKeyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'service-account.json');

if (candidateKeyPath && fs.existsSync(candidateKeyPath)) {
  console.log(`Using Service Account credentials from: ${candidateKeyPath}`);
  const serviceAccount = JSON.parse(fs.readFileSync(candidateKeyPath, 'utf8'));
  credential = cert(serviceAccount);
} else {
  credential = applicationDefault();
}

initializeApp({ credential, projectId: PROJECT_ID });
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

  if (action === 'revoke') {
    // Invalidate existing sessions so the removed claim takes effect immediately.
    await auth.revokeRefreshTokens(user.uid);
  }

  const verify = await auth.getUser(user.uid);
  console.log(`✔ ${action === 'grant' ? 'Granted' : 'Revoked'} admin for ${verify.email} (uid ${verify.uid})`);
  console.log('  customClaims now:', JSON.stringify(verify.customClaims || {}));
  console.log('  The user must sign out and sign in again for the change to apply in the CMS.');
} catch (err) {
  if (err.code === 'auth/user-not-found') {
    console.error(`No Firebase Auth user exists for ${email}. Create it first in Firebase Console → Authentication → Users → Add user.`);
  } else {
    console.error('Failed:', err.code || '', err.message);
  }
  process.exit(1);
}

