/**
 * MITTAI BANDI — Firebase Realtime Database Integration
 * Powered by GURMITRAA Technologies Pvt. Ltd.
 *
 * This module initialises Firebase and exposes helper functions
 * to write contact & partner enquiry data to the Realtime Database.
 *
 * ⚠️  IMPORTANT: Replace RTDB_URL below with your actual database URL
 *     e.g. "https://mittaibandi-portal-default-rtdb.firebaseio.com"
 *     (found in Firebase Console → Realtime Database)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import {
  getDatabase,
  ref,
  push,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js';

// ── Firebase Configuration ───────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyBbFZMPVsW1zQfd92K4qetcSalQoD8Q708',
  authDomain:        'mittaibandi-portal.firebaseapp.com',
  projectId:         'mittaibandi-portal',
  storageBucket:     'mittaibandi-portal.firebasestorage.app',
  messagingSenderId: '172456443934',
  appId:             '1:172456443934:web:f1812e21f342a2fa886e0f',

  // ▶ PASTE YOUR RTDB URL HERE ◀
  // Example: 'https://mittaibandi-portal-default-rtdb.firebaseio.com'
  databaseURL: 'https://mittaibandi-portal-default-rtdb.asia-southeast1.firebasedatabase.app',
};

// ── Initialise Firebase ──────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ── Helper: Generate a sanitised timestamp label ─────────────────────────────
function _now() {
  return new Date().toISOString();
}

/**
 * Save a contact form submission to RTDB under /contact_submissions.
 *
 * @param {Object} data  - { name, email, subject, message }
 * @returns {Promise<string>} - the new record's key
 */
export async function saveContactSubmission(data) {
  const node = ref(db, 'contact_submissions');
  const result = await push(node, {
    ...data,
    source:    'mittaibandi-web-contact',
    createdAt: _now(),
    timestamp: serverTimestamp(),
  });
  return result.key;
}

/**
 * Save a partner / vendor registration to RTDB under /partner_registrations.
 *
 * @param {Object} data  - { name, email, phone, shopName, city, message, ... }
 * @returns {Promise<string>} - the new record's key
 */
export async function savePartnerRegistration(data) {
  const node = ref(db, 'partner_registrations');
  const result = await push(node, {
    ...data,
    source:    'mittaibandi-web-partner',
    createdAt: _now(),
    timestamp: serverTimestamp(),
  });
  return result.key;
}

// ── Expose on window for non-module scripts ───────────────────────────────────
window.MB_Firebase = {
  saveContactSubmission,
  savePartnerRegistration,
};

console.info('%c[MITTAI BANDI] Firebase RTDB initialised ✓', 'color:#C99D3D;font-weight:600;');
