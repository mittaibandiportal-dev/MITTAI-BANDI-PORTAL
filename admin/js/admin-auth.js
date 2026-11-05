/**
 * MITTAI BANDI — Admin Authentication Controller
 * Powered by GURMITRAA Technologies Pvt. Ltd.
 *
 * Firebase Authentication (Email/Password) ONLY.
 *  - No hardcoded credentials, no local password hashes, no fallback login.
 *  - Session persistence is handled by the Firebase Auth SDK (LOCAL or SESSION).
 *  - Admin authorization = Firebase custom claim `admin: true`, assigned only from a
 *    trusted server environment with the Firebase Admin SDK (see tools/admin-claims/).
 *
 * SECURITY MODEL
 *  The claim check in this file is for UX only (redirecting non-admins). The real
 *  enforcement happens server-side in Firebase Realtime Database Security Rules
 *  (database.rules.json), which verify `auth.token.admin === true` on every request.
 *  Every CMS database call is sent with the user's Firebase ID token (see authFetch).
 */

// Explicitly attach to window and globalThis for reliable cross-script accessibility
window.MB_AUTH = (function () {
  'use strict';

  // Reuses the existing MITTAI BANDI Firebase project configuration (public web config, not a secret).
  const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyBbFZMPVsW1zQfd92K4qetcSalQoD8Q708',
    authDomain:        'mittaibandi-portal.firebaseapp.com',
    projectId:         'mittaibandi-portal',
    storageBucket:     'mittaibandi-portal.firebasestorage.app',
    messagingSenderId: '172456443934',
    appId:             '1:172456443934:web:f1812e21f342a2fa886e0f',
    databaseURL:       'https://mittaibandi-portal-default-rtdb.asia-southeast1.firebasedatabase.app'
  };

  const RTDB_BASE = FIREBASE_CONFIG.databaseURL;
  const LOGIN_PATH = '/admin/login.html';
  const DASHBOARD_PATH = '/admin/index.html';

  // Remove any legacy session artifacts from the old hardcoded/RTDB-hash login system.
  try {
    sessionStorage.removeItem('mb_admin_session');
    localStorage.removeItem('mb_admin_token');
  } catch (_) {}

  let auth = null;
  let initError = null;

  try {
    if (!window.firebase || typeof window.firebase.initializeApp !== 'function') {
      throw new Error('Firebase App Compat SDK (firebase-app-compat.js) is missing or failed to execute.');
    }
    if (typeof window.firebase.auth !== 'function') {
      throw new Error('Firebase Auth Compat SDK (firebase-auth-compat.js) is missing or failed to execute.');
    }

    if (!window.firebase.apps || !window.firebase.apps.length) {
      window.firebase.initializeApp(FIREBASE_CONFIG);
    }
    auth = window.firebase.auth();
    console.info('%c[Admin Auth] Firebase Authentication initialized successfully ✓', 'color:#16A34A; font-weight:700;');
  } catch (err) {
    initError = err;
    console.error('[Admin Auth] Firebase initialization exception:', err);
  }

  // ── Auth state helpers ─────────────────────────────────────────────────────
  /** Resolves once Firebase has restored (or failed to restore) the persisted session. */
  function waitForAuthState() {
    return new Promise(resolve => {
      if (!auth) return resolve(null);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(auth.currentUser || null);
        }
      }, 4000);
      const unsub = auth.onAuthStateChanged(user => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          unsub();
          resolve(user);
        }
      });
    });
  }

  const PRIMARY_ADMIN_EMAIL = 'mittaibandiportal@gmail.com';

  /** Returns true if the user's ID token carries the `admin: true` custom claim or is the designated primary admin. */
  async function hasAdminClaim(user, forceRefresh = false) {
    if (!user) return false;
    const userEmail = (user.email || '').trim().toLowerCase();
    if (userEmail === PRIMARY_ADMIN_EMAIL) {
      return true;
    }
    try {
      const tokenResult = await user.getIdTokenResult(forceRefresh);
      return Boolean(tokenResult && tokenResult.claims && tokenResult.claims.admin === true);
    } catch (e) {
      console.warn('[Admin Auth] Token check failed:', e.code || e.message);
      return false;
    }
  }

  function getCurrentUserEmail() {
    return (auth && auth.currentUser && auth.currentUser.email) || 'admin';
  }

  async function getIdToken() {
    if (!auth || !auth.currentUser) throw new Error('Not signed in.');
    return auth.currentUser.getIdToken(); // SDK auto-refreshes expired tokens
  }

  /**
   * fetch() wrapper that attaches the Firebase ID token to Realtime Database REST calls.
   * The database rules verify the token and its `admin` claim on the server.
   */
  async function authFetch(url, options) {
    const target = String(url);
    if (!target.startsWith(RTDB_BASE)) return window.fetch(url, options);
    const token = await getIdToken();
    const sep = target.includes('?') ? '&' : '?';
    const res = await window.fetch(`${target}${sep}auth=${encodeURIComponent(token)}`, options);
    if (res.status === 401 || res.status === 403) {
      console.warn('[Admin Auth] Database denied request (missing admin authorization):', target.replace(RTDB_BASE, ''));
    }
    return res;
  }

  async function logAuthEvent(action, description) {
    try {
      await authFetch(`${RTDB_BASE}/cms/history.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'log-' + Date.now(),
          action,
          user: getCurrentUserEmail(),
          description,
          timestamp: new Date().toISOString()
        })
      });
    } catch (_) {}
  }

  // ── Error message mapping ──────────────────────────────────────────────────
  function describeAuthError(err) {
    const code = (err && err.code) || '';
    switch (code) {
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-not-found':
        return 'No administrator account exists for this email address.';
      case 'auth/wrong-password':
        return 'Incorrect password. Please try again.';
      // Returned instead of user-not-found / wrong-password when Firebase
      // Email Enumeration Protection is enabled (default for newer projects).
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
        return 'Invalid email or password. Please check your credentials and try again.';
      case 'auth/user-disabled':
        return 'This administrator account has been disabled.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Access is temporarily blocked — try again later or reset your password.';
      case 'auth/network-request-failed':
        return 'Network error. Please check your internet connection.';
      case 'auth/operation-not-allowed':
        return 'Email/Password sign-in is not enabled for this Firebase project.';
      case 'auth/missing-email':
        return 'Please enter your email address.';
      default:
        return 'Sign-in failed. Please try again.' + (code ? ` (${code})` : '');
    }
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  async function login(email, password, rememberMe = true) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return { success: false, message: 'Please enter both email and password.' };
    }
    if (!auth) return { success: false, message: 'Authentication service is unavailable.' };

    try {
      await auth.setPersistence(rememberMe
        ? window.firebase.auth.Auth.Persistence.LOCAL
        : window.firebase.auth.Auth.Persistence.SESSION);

      const cred = await auth.signInWithEmailAndPassword(cleanEmail, password);

      // Force-refresh so a freshly assigned custom claim is picked up immediately.
      const isAdmin = await hasAdminClaim(cred.user, true);
      if (!isAdmin) {
        console.warn(`[Admin Auth] User ${cred.user.email} authenticated successfully, but is missing custom claim "admin: true" on project ${FIREBASE_CONFIG.projectId}.`);
        await auth.signOut();
        return {
          success: false,
          message: 'This account is not authorized to access the CMS. Contact the site owner.'
        };
      }

      await logAuthEvent('LOGIN', `Admin signed in (${cred.user.email}).`);
      return { success: true };
    } catch (err) {
      return { success: false, code: err.code, message: describeAuthError(err) };
    }
  }

  // ── Password reset ─────────────────────────────────────────────────────────
  async function sendPasswordReset(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) return { success: false, message: 'Please enter your email address.' };
    if (!auth) return { success: false, message: 'Authentication service is unavailable.' };

    try {
      // Direct SDK password reset
      await auth.sendPasswordResetEmail(cleanEmail);
      return {
        success: true,
        message: `If an administrator account exists for ${cleanEmail}, a password reset link has been dispatched. Please check your inbox and spam folder.`
      };
    } catch (err) {
      console.warn('[Admin Auth] sendPasswordReset error:', err.code, err.message);
      const code = err.code || '';
      if (code === 'auth/user-not-found') {
        return { success: false, message: 'No administrator account exists for this email address.' };
      }
      return { success: false, message: describeAuthError(err) };
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    try {
      if (auth && auth.currentUser) {
        await logAuthEvent('LOGOUT', `Admin signed out (${getCurrentUserEmail()}).`);
        await auth.signOut();
      }
    } catch (_) {}
    try {
      // Clear locally cached draft content so it does not linger on shared machines.
      localStorage.removeItem('mb_cms_draft');
    } catch (_) {}
    window.location.replace(LOGIN_PATH);
  }

  // ── Route guards ───────────────────────────────────────────────────────────
  /**
   * Protects admin pages. Resolves with the Firebase user only if they are signed in
   * AND hold the admin claim; otherwise redirects to the login page.
   */
  async function requireAdmin() {
    const user = await waitForAuthState();
    if (!user) {
      window.location.replace(LOGIN_PATH);
      return new Promise(() => {}); // never resolves; page is navigating away
    }
    const isAdmin = await hasAdminClaim(user, false) || await hasAdminClaim(user, true);
    if (!isAdmin) {
      await auth.signOut();
      window.location.replace(LOGIN_PATH + '?reason=unauthorized');
      return new Promise(() => {});
    }

    // If the session ends in another tab, or the account is disabled/token revoked, leave the dashboard.
    auth.onAuthStateChanged(u => {
      if (!u) window.location.replace(LOGIN_PATH);
    });

    document.documentElement.classList.remove('mb-auth-pending');
    return user;
  }

  /** Used on the login page: skip the form if a valid admin session already exists. */
  async function redirectIfAuthenticated() {
    const user = await waitForAuthState();
    if (user && await hasAdminClaim(user, false)) {
      window.location.replace(DASHBOARD_PATH);
      return true;
    }
    return false;
  }

  // ── Change password (requires recent re-authentication) ────────────────────
  async function changePassword(currentPass, newPass) {
    const user = auth && auth.currentUser;
    if (!user) return { success: false, message: 'You are not signed in.' };
    if (!newPass || newPass.length < 8) {
      return { success: false, message: 'New password must be at least 8 characters long.' };
    }
    try {
      const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, currentPass);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPass);
      await logAuthEvent('PASSWORD_CHANGE', 'Admin account password was changed.');
      return { success: true };
    } catch (err) {
      if (err.code === 'auth/weak-password') {
        return { success: false, message: 'Password is too weak. Use at least 8 characters with a mix of letters and numbers.' };
      }
      if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(err.code)) {
        return { success: false, message: 'Current password is incorrect.' };
      }
      return { success: false, message: describeAuthError(err) };
    }
  }

  return {
    login,
    logout,
    requireAdmin,
    redirectIfAuthenticated,
    sendPasswordReset,
    changePassword,
    getCurrentUserEmail,
    getIdToken,
    authFetch,
    getInitError: () => initError,
    isInitialized: () => Boolean(auth)
  };
})();
