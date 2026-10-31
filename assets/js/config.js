/**
 * MITTAI BANDI — Centralized Configuration
 * Powered by GURMITRAA Technologies Pvt. Ltd.
 *
 * IMPORTANT: Update these values when official URLs are available.
 * Do NOT redirect users to placeholder or invented URLs.
 */

const MITTAI_CONFIG = {
  // ── App Download ────────────────────────────────────────
  // Replace with official Google Play Store URL when available
  playStoreUrl: null, // e.g. 'https://play.google.com/store/apps/details?id=com.gurmitraa.mittaibandi'
  appStoreUrl:  null, // iOS App Store (future)

  // ── Social Media ────────────────────────────────────────
  // Replace with official social media profile URLs when available
  social: {
    instagram: null, // e.g. 'https://instagram.com/mittaibandi'
    facebook:  null, // e.g. 'https://facebook.com/mittaibandi'
    youtube:   null, // e.g. 'https://youtube.com/@mittaibandi'
    linkedin:  null, // e.g. 'https://linkedin.com/company/mittaibandi'
  },

  // ── Contact ─────────────────────────────────────────────
  contact: {
    email:   'mittaibandi@gmail.com',
    phone:   '+91 94905 32121',
    address: 'Rajahmundry, Andhra Pradesh, India.',
    company: 'GURMITRAA Technologies Pvt. Ltd.',
  },

  // ── Form Backend ────────────────────────────────────────
  // Set to your form backend endpoint when available (e.g. Formspree, custom API)
  formEndpoint: null, // e.g. 'https://formspree.io/f/yourformid'

  // ── Feature Flags ───────────────────────────────────────
  features: {
    liveOrdering:  false,
    liveTracking:  false,
    paymentActive: false,
  },
};

/**
 * Handle app download button clicks.
 * Shows a coming-soon message if the Play Store URL is not configured.
 */
function handleAppDownload(event) {
  event.preventDefault();
  if (MITTAI_CONFIG.playStoreUrl) {
    window.open(MITTAI_CONFIG.playStoreUrl, '_blank', 'noopener,noreferrer');
  } else {
    showAppComingSoon();
  }
}

/**
 * Display a tasteful coming-soon notification for the app.
 */
function showAppComingSoon(platformName) {
  const existing = document.getElementById('app-coming-soon-toast');
  if (existing) existing.remove();

  const label = platformName ? `on ${platformName}` : '';
  const toast = document.createElement('div');
  toast.id = 'app-coming-soon-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: #14020B;
    color: #FFFFFF;
    padding: 0.9rem 1.85rem;
    border-radius: 9999px;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.875rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    box-shadow: 0 10px 36px rgba(0,0,0,0.45);
    border: 1px solid rgba(201,0,61,0.45);
    z-index: 99999;
    opacity: 0;
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    text-align: center;
    max-width: 90vw;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  `;
  toast.innerHTML = `
    <span style="color:#C9003D; font-size:1.1rem; line-height:1;">♥</span>
    MITTAI BANDI app ${label} is launching soon — stay tuned!
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

/**
 * Handle Play Store download click
 */
function handlePlayStoreDownload(event) {
  event.preventDefault();
  if (MITTAI_CONFIG.playStoreUrl) {
    window.open(MITTAI_CONFIG.playStoreUrl, '_blank', 'noopener,noreferrer');
  } else {
    showAppComingSoon('Google Play');
  }
}

/**
 * Handle Apple App Store download click
 */
function handleAppStoreDownload(event) {
  event.preventDefault();
  if (MITTAI_CONFIG.appStoreUrl) {
    window.open(MITTAI_CONFIG.appStoreUrl, '_blank', 'noopener,noreferrer');
  } else {
    showAppComingSoon('the App Store');
  }
}

/**
 * Initialize all app-download buttons on the page.
 */
function initAppDownloadButtons() {
  document.querySelectorAll('[data-action="download-app"]').forEach(btn => {
    btn.addEventListener('click', handleAppDownload);
  });
  document.querySelectorAll('[data-action="download-play"]').forEach(btn => {
    btn.addEventListener('click', handlePlayStoreDownload);
  });
  document.querySelectorAll('[data-action="download-apple"]').forEach(btn => {
    btn.addEventListener('click', handleAppStoreDownload);
  });
}

/**
 * Initialize social media links. Hides links if URL is not configured.
 */
function initSocialLinks() {
  const links = document.querySelectorAll('[data-social]');
  links.forEach(link => {
    const platform = link.dataset.social;
    const url = MITTAI_CONFIG.social[platform];
    if (url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.addEventListener('click', e => {
        e.preventDefault();
        showAppComingSoon();
      });
    }
  });
}

// Export for use in pages
window.MITTAI_CONFIG = MITTAI_CONFIG;
window.handleAppDownload = handleAppDownload;
window.initAppDownloadButtons = initAppDownloadButtons;
window.initSocialLinks = initSocialLinks;
