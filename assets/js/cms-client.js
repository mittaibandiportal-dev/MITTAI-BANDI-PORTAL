/**
 * MITTAI BANDI — Dynamic CMS Client Hydration Engine v1.0
 * Powered by GURMITRAA Technologies Pvt. Ltd.
 *
 * Responsibilities:
 * 1. Read live CMS configuration (from instant localStorage cache or Firebase RTDB).
 * 2. Render and control the configurable Preloader.
 * 3. Dynamically inject theme colors, typography, buttons and global styling.
 * 4. Update SEO meta tags, favicon and Open Graph assets.
 * 5. Hydrate Header, Navigation, Store Badges, and Top Announcement Bar.
 * 6. Dynamically reorder, toggle visibility, and update sections on EVERY page.
 * 7. Hydrate Footer, Social Links, Legal Links and Corporate details.
 * 8. Support real-time postMessage live preview from Admin Dashboard.
 */

(function () {
  'use strict';

  const RTDB_BASE = 'https://mittaibandi-portal-default-rtdb.asia-southeast1.firebasedatabase.app';
  const CACHE_KEY = 'mb_cms_live';
  const DRAFT_KEY = 'mb_cms_draft';

  // ── Determine Current Page Identifier ───────────────────────────────────────
  function getCurrentPageId() {
    const path = window.location.pathname.split('/').pop().toLowerCase() || 'index.html';
    if (path === '' || path === 'index.html') return 'home';
    if (path.includes('about')) return 'about';
    if (path.includes('partner')) return 'partner';
    if (path.includes('contact')) return 'contact';
    if (path.includes('privacy')) return 'privacy';
    if (path.includes('terms')) return 'terms';
    if (path.includes('cancellation') || path.includes('refund')) return 'refund';
    if (path.includes('api')) return 'api';
    if (path.includes('404')) return '404';
    return 'home';
  }

  function isPreviewRequest() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('preview') === 'true' ||
             urlParams.get('preview') === 'draft' ||
             urlParams.get('cms_preview') === '1';
    } catch (e) {
      return false;
    }
  }

  // ── Clean Storage Serializer (Never strips real banner/page images) ─────────
  function buildCleanLiveCache(dataObj) {
    if (!dataObj) return null;
    const copy = JSON.parse(JSON.stringify(dataObj));
    delete copy.media; // Admin-only media catalog is not needed on public client
    if (copy.pages) {
      delete copy.pages['api-policy'];
      delete copy.pages['privacy-policy'];
      delete copy.pages['terms-of-service'];
      delete copy.pages['cancellation-refund'];
    }
    if (Array.isArray(copy.promotionalBanners)) {
      copy.promotionalBanners.forEach(b => {
        if (b.desktopImage && b.desktopImage === b.image && b.image.startsWith('data:')) {
          delete b.desktopImage;
        }
        if (b.mobileImage && b.mobileImage === b.image && b.image.startsWith('data:')) {
          delete b.mobileImage;
        }
      });
    }
    return copy;
  }

  function saveLiveToCache(liveData) {
    if (!liveData) return;
    try {
      localStorage.removeItem('mittai_cms_draft_v1');
      localStorage.removeItem('mittai_cms_live_v1');
      localStorage.removeItem('mb_media_library');
      const cleanCopy = buildCleanLiveCache(liveData);
      const serialized = JSON.stringify(cleanCopy);
      try {
        localStorage.setItem(CACHE_KEY, serialized);
      } catch (qErr) {
        // Evict draft cache on public page so live cache ALWAYS succeeds with 100% real images
        localStorage.removeItem(DRAFT_KEY);
        localStorage.setItem(CACHE_KEY, serialized);
      }
    } catch (e) {
      console.warn('[CMS Client] Cache write warning:', e);
    }
  }

  function isCacheStaleOrCorrupted(cached, defData) {
    if (!cached || typeof cached !== 'object' || !cached.global) return true;
    const cachedPub = cached.meta?.lastPublished || cached.meta?.lastPublishedAt || '';
    const defPub = defData?.meta?.lastPublished || defData?.meta?.lastPublishedAt || '';
    if (defPub && (!cachedPub || cachedPub < defPub)) return true;

    // Detect legacy corrupted slimLive cache where Base64 banner image was overwritten with wedding_sweets.png
    if (Array.isArray(cached.promotionalBanners) && Array.isArray(defData?.promotionalBanners)) {
      for (const defBanner of defData.promotionalBanners) {
        const cb = cached.promotionalBanners.find(x => x && x.id === defBanner.id);
        if (cb && cb.image === 'assets/images/wedding_sweets.png' && defBanner.image !== 'assets/images/wedding_sweets.png') {
          return true;
        }
      }
    }
    return false;
  }

  // ── Load Cached or Default CMS Data ─────────────────────────────────────────
  function getInitialData() {
    const defData = window.MITTAI_DEFAULT_CMS || null;
    try {
      if (isPreviewRequest()) {
        const draftStr = localStorage.getItem(DRAFT_KEY) || localStorage.getItem('mittai_cms_draft_v1');
        if (draftStr) return JSON.parse(draftStr);
      }

      const cachedStr = localStorage.getItem(CACHE_KEY) || localStorage.getItem('mittai_cms_live_v1');
      if (cachedStr) {
        const parsed = JSON.parse(cachedStr);
        if (!isCacheStaleOrCorrupted(parsed, defData)) {
          return parsed;
        }
        // Self-heal stale or corrupted cache immediately
        if (defData) {
          saveLiveToCache(defData);
          return defData;
        }
      } else if (defData) {
        saveLiveToCache(defData);
      }
    } catch (e) {
      console.warn('[CMS Client] Cache read error:', e);
    }
    return defData;
  }

  let cmsData = getInitialData();
  const pageId = getCurrentPageId();
  let isDomHydrated = false;

  // ── Early Anti-Flash Render Gate (Prevents unhydrated static HTML flash) ────
  if (document.readyState === 'loading') {
    document.documentElement.classList.add('mb-cms-hydrating');
    const gateStyle = document.createElement('style');
    gateStyle.id = 'mb-cms-render-gate';
    gateStyle.textContent = 'html.mb-cms-hydrating body > *:not(#mb-preloader) { opacity: 0 !important; }';
    (document.head || document.documentElement).appendChild(gateStyle);
  }
  function releaseRenderGate() {
    document.documentElement.classList.remove('mb-cms-hydrating');
    const gateStyle = document.getElementById('mb-cms-render-gate');
    if (gateStyle) gateStyle.remove();
  }

  // ── Preloader Component (Award-Winning Brand Motion Introduction) ────────────
  let preloaderEl = null;
  let preloaderStartTime = Date.now();
  let preloaderDismissed = false;

  function injectPreloader(config) {
    if (!config || config.enabled === false) return;
    if (document.getElementById('mb-preloader')) return;

    // Check session so preloader only shows on initial visit, never on every page click or state update
    const isSessionSeen = sessionStorage.getItem('mb_preloader_seen');
    const isForcePreview = window.location.search.includes('test_preloader') || 
                           window.location.search.includes('preview=') ||
                           window.location.pathname.includes('/admin');
    if (isSessionSeen && !isForcePreview) return;

    preloaderStartTime = Date.now();
    preloaderDismissed = false;

    preloaderEl = document.createElement('div');
    preloaderEl.id = 'mb-preloader';
    preloaderEl.className = 'mb-preloader';
    preloaderEl.setAttribute('role', 'status');
    preloaderEl.setAttribute('aria-live', 'polite');
    preloaderEl.setAttribute('aria-label', 'Loading MITTAI BANDI');

    const title = (config.title || 'MITTAI BANDI').trim();
    const rawSubtitle = (config.subtitle || "Let's Taste It ❤️").trim();
    let taglineText = rawSubtitle;
    let heartChar = '❤️';
    if (rawSubtitle.includes('❤️') || rawSubtitle.includes('❤')) {
      taglineText = rawSubtitle.replace(/❤️|❤/g, '').trim();
    }
    const logoSrc = config.logo || 'assets/images/logo.png';
    const accentRed = config.accentColor || '#E60046';
    const accentGreen = '#16A34A';

    // Inject inline styles as early fail-safe so animation is 100% styled before external CSS finishes
    const styleTag = document.createElement('style');
    styleTag.id = 'mb-preloader-styles';
    styleTag.textContent = `
      .mb-preloader {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 999999;
        background: radial-gradient(circle at 50% 46%, rgba(230, 0, 70, 0.038) 0%, rgba(22, 163, 74, 0.018) 35%, rgba(255, 255, 255, 0) 65%), #FFFFFF;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        user-select: none;
        -webkit-user-select: none;
        transition: opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1), transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), filter 0.4s ease;
        will-change: opacity, transform;
      }
      .mb-preloader.dismissing {
        opacity: 0 !important;
        transform: scale(1.02) !important;
        filter: blur(2px) !important;
        pointer-events: none !important;
      }
      .mb-preload-center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        position: relative;
        z-index: 2;
        max-width: 480px;
        width: 100%;
      }
      .mb-preload-emblem-wrap {
        width: 140px;
        height: 140px;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: mbEmblemFloat 3.8s ease-in-out infinite alternate 1.35s;
        will-change: transform;
      }
      @keyframes mbEmblemFloat {
        0%   { transform: translateY(0); }
        100% { transform: translateY(-4px); }
      }
      .mb-preload-svg-ring {
        position: absolute;
        inset: -14px;
        width: calc(100% + 28px);
        height: calc(100% + 28px);
        pointer-events: none;
        overflow: visible;
        transform: rotate(-90deg);
      }
      .mb-ring-track {
        stroke: rgba(230, 0, 70, 0.08);
        stroke-width: 2;
      }
      .mb-ring-draw {
        stroke-dasharray: 465;
        stroke-dashoffset: 465;
        animation: mbStrokeDraw 1.25s cubic-bezier(0.16, 1, 0.3, 1) forwards 0.15s;
      }
      @keyframes mbStrokeDraw {
        0%   { stroke-dashoffset: 465; }
        100% { stroke-dashoffset: 0; }
      }
      .mb-ring-pip {
        opacity: 0;
        transform-origin: center;
        animation: mbPipFade 0.6s ease forwards;
      }
      .mb-pip-top { animation-delay: 0.5s; }
      .mb-pip-bottom { animation-delay: 0.85s; }
      @keyframes mbPipFade {
        0%   { opacity: 0; transform: scale(0); }
        100% { opacity: 1; transform: scale(1); }
      }
      .mb-preload-logo-card {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: #FFFFFF;
        position: relative;
        z-index: 2;
        border: 1.5px solid rgba(230, 0, 70, 0.14);
        box-shadow: 0 14px 38px rgba(230, 0, 70, 0.11), 0 4px 14px rgba(0, 0, 0, 0.04);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 6px;
        clip-path: circle(0% at 50% 50%);
        opacity: 0;
        transform: scale(0.88);
        animation: mbLogoReveal 1.05s cubic-bezier(0.16, 1, 0.3, 1) forwards 0.25s;
        will-change: clip-path, transform, opacity;
      }
      @keyframes mbLogoReveal {
        0%   { clip-path: circle(0% at 50% 50%); opacity: 0; transform: scale(0.88); }
        60%  { opacity: 1; }
        100% { clip-path: circle(52% at 50% 50%); opacity: 1; transform: scale(1); }
      }
      .mb-preload-logo-img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
        image-rendering: -webkit-optimize-contrast;
      }
      .mb-preload-halo {
        position: absolute;
        inset: -10px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(230, 0, 70, 0.10) 0%, rgba(22, 163, 74, 0.04) 50%, transparent 70%);
        opacity: 0;
        animation: mbHaloPulse 2.8s ease-in-out infinite 0.8s;
        pointer-events: none;
        z-index: 1;
      }
      @keyframes mbHaloPulse {
        0%, 100% { transform: scale(0.95); opacity: 0.3; }
        50%      { transform: scale(1.08); opacity: 0.7; }
      }
      .mb-preload-brand-info {
        margin-top: 1.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .mb-preload-title {
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        font-size: clamp(1.4rem, 2.8vw, 1.85rem);
        font-weight: 800;
        letter-spacing: 0.20em;
        text-transform: uppercase;
        color: #252525;
        margin: 0;
        line-height: 1.15;
        opacity: 0;
        transform: translateY(12px);
        animation: mbFadeUp 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards 0.45s;
      }
      .mb-preload-tagline {
        font-family: 'Manrope', system-ui, sans-serif;
        font-size: clamp(0.95rem, 1.4vw, 1.0625rem);
        font-weight: 600;
        color: #E60046;
        letter-spacing: 0.04em;
        margin: 0.45rem 0 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        opacity: 0;
        transform: translateY(10px);
        animation: mbFadeUp 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards 0.65s;
      }
      .mb-tagline-heart {
        display: inline-block;
        font-size: 0.9em;
        animation: mbHeartBeat 2.0s ease-in-out infinite 1.2s;
        transform-origin: center;
      }
      @keyframes mbHeartBeat {
        0%, 100% { transform: scale(1); }
        14%      { transform: scale(1.22); }
        28%      { transform: scale(1); }
        42%      { transform: scale(1.18); }
        56%      { transform: scale(1); }
      }
      .mb-preload-flourish {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        margin-top: 0.75rem;
        opacity: 0;
        animation: mbFadeUp 0.8s ease forwards 0.8s;
      }
      .mb-flourish-line {
        width: 28px;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(230, 0, 70, 0.3), transparent);
      }
      .mb-flourish-diamond {
        width: 5px;
        height: 5px;
        background: #16A34A;
        transform: rotate(45deg);
        border-radius: 1px;
      }
      .mb-preload-progress-wrap {
        margin-top: 1.6rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
      }
      .mb-preload-progress-track {
        width: 140px;
        height: 2.5px;
        background: rgba(0, 0, 0, 0.06);
        border-radius: 9999px;
        overflow: hidden;
        position: relative;
      }
      .mb-preload-progress-bar {
        height: 100%;
        width: 0%;
        border-radius: 9999px;
        background: linear-gradient(90deg, #E60046, #FF1A62);
        animation: mbProgressBar 1.4s cubic-bezier(0.65, 0, 0.35, 1) forwards 0.35s;
      }
      @keyframes mbProgressBar {
        0%   { width: 0%; }
        50%  { width: 68%; }
        100% { width: 100%; }
      }
      .mb-preload-badge {
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #16A34A;
        opacity: 0;
        animation: mbFadeUp 0.8s ease forwards 0.95s;
      }
      @keyframes mbFadeUp {
        0%   { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @media (max-width: 480px) {
        .mb-preload-emblem-wrap { width: 120px; height: 120px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .mb-preload-emblem-wrap, .mb-tagline-heart, .mb-preload-halo { animation: none !important; }
        .mb-ring-draw { stroke-dashoffset: 0 !important; animation: none !important; }
        .mb-preload-logo-card { clip-path: circle(52% at 50% 50%) !important; opacity: 1 !important; transform: none !important; animation: none !important; }
        .mb-preload-title, .mb-preload-tagline, .mb-preload-flourish, .mb-preload-progress-wrap, .mb-preload-badge, .mb-ring-pip { opacity: 1 !important; transform: none !important; animation: none !important; }
        .mb-preload-progress-bar { width: 100% !important; animation: none !important; }
      }
    `;
    if (!document.getElementById('mb-preloader-styles')) {
      document.head.appendChild(styleTag);
    }

    preloaderEl.innerHTML = `
      <div class="mb-preload-center">
        <div class="mb-preload-emblem-wrap">
          <svg class="mb-preload-svg-ring" viewBox="0 0 160 160" aria-hidden="true">
            <defs>
              <linearGradient id="mbPreloadGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${accentRed}" />
                <stop offset="65%" stop-color="#FF1A62" />
                <stop offset="100%" stop-color="${accentGreen}" />
              </linearGradient>
            </defs>
            <circle class="mb-ring-track" cx="80" cy="80" r="74" fill="none" />
            <circle class="mb-ring-draw" cx="80" cy="80" r="74" fill="none" stroke="url(#mbPreloadGrad)" />
            <circle class="mb-ring-pip mb-pip-top" cx="80" cy="6" r="3.5" fill="${accentGreen}" />
            <circle class="mb-ring-pip mb-pip-bottom" cx="80" cy="154" r="3.5" fill="${accentRed}" />
          </svg>
          <div class="mb-preload-logo-card">
            <img src="${logoSrc}" alt="${title}" class="mb-preload-logo-img" />
          </div>
          <div class="mb-preload-halo" aria-hidden="true"></div>
        </div>

        <div class="mb-preload-brand-info">
          <h2 class="mb-preload-title">${title}</h2>
          <p class="mb-preload-tagline">
            <span class="mb-tagline-text">${taglineText}</span>
            <span class="mb-tagline-heart" aria-hidden="true">${heartChar}</span>
          </p>
          <div class="mb-preload-flourish" aria-hidden="true">
            <span class="mb-flourish-line"></span>
            <span class="mb-flourish-diamond"></span>
            <span class="mb-flourish-line"></span>
          </div>
        </div>

        <div class="mb-preload-progress-wrap" aria-hidden="true">
          <div class="mb-preload-progress-track">
            <div class="mb-preload-progress-bar"></div>
          </div>
          <span class="mb-preload-badge">TRADITIONAL TASTE</span>
        </div>
      </div>
    `;

    // Tap or click to fast-dismiss for user convenience
    preloaderEl.addEventListener('click', () => dismissPreloader(0));

    document.documentElement.appendChild(preloaderEl);

    // Hard failsafe timeout: never block longer than 2.8s under any network circumstance
    setTimeout(() => {
      if (preloaderEl && !preloaderDismissed) {
        dismissPreloader(0);
      }
    }, 2800);
  }

  function dismissPreloader(minDuration = 1600) {
    if (!preloaderEl || preloaderDismissed) return;
    preloaderDismissed = true;

    try {
      sessionStorage.setItem('mb_preloader_seen', 'true');
    } catch (e) {}

    const elapsed = Date.now() - preloaderStartTime;
    const remaining = Math.max(0, minDuration - elapsed);

    setTimeout(() => {
      if (!preloaderEl) return;
      preloaderEl.classList.add('dismissing');

      setTimeout(() => {
        if (preloaderEl && preloaderEl.parentNode) {
          preloaderEl.parentNode.removeChild(preloaderEl);
          preloaderEl = null;
        }
      }, 550);
    }, remaining);
  }

  // ── Apply Global Styling & Themes ──────────────────────────────────────────
  function applyGlobalTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const primary = theme.colorPrimary || '#E60046';
    const primaryDark = theme.colorPrimaryDark || '#C4003B';
    const green = theme.colorGreen || theme.colorSecondary || '#16A34A';
    
    root.style.setProperty('--color-magenta', primary);
    root.style.setProperty('--color-magenta-dark', primaryDark);
    root.style.setProperty('--color-green', green);
    root.style.setProperty('--color-gold', green);
    // Guarantee light/white foundation — zero dark backgrounds anywhere
    root.style.setProperty('--color-dark', '#FFFFFF');
    root.style.setProperty('--color-dark-mid', '#FFFCFA');
    root.style.setProperty('--color-espresso', '#FFFFFF');
    root.style.setProperty('--color-brown', '#FFFFFF');
    root.style.setProperty('--color-heritage-brown', '#FFFFFF');
    root.style.setProperty('--color-cream', theme.colorCream || '#FFFCFA');
    root.style.setProperty('--color-light', theme.colorLight || '#FFFFFF');
    root.style.setProperty('--color-text-primary', '#252525');
    root.style.setProperty('--color-text-secondary', '#666666');
    root.style.setProperty('--color-text-muted', '#777777');
    root.style.setProperty('--color-text-on-dark', '#252525');
    root.style.setProperty('--color-text-on-dark-sub', '#666666');
    root.style.setProperty('--color-border', '#EEEEEE');
    root.style.setProperty('--color-border-light', '#F3F3F3');
    if (theme.borderRadius) {
      root.style.setProperty('--radius-sm', theme.borderRadius);
      root.style.setProperty('--btn-radius', theme.borderRadius);
    }
  }

  // ── Apply SEO & Browser Tab Metadata ────────────────────────────────────────
  function applySEO(seo, global) {
    if (!seo && !global) return;
    const siteTitle = seo?.title || (global?.siteName ? `${global.siteName} — ${global.tagline}` : null);
    if (siteTitle) document.title = siteTitle;

    // Meta description
    if (seo?.description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.name = 'description';
        document.head.appendChild(metaDesc);
      }
      metaDesc.content = seo.description;
    }

    // Meta keywords
    if (seo?.keywords) {
      let metaKey = document.querySelector('meta[name="keywords"]');
      if (!metaKey) {
        metaKey = document.createElement('meta');
        metaKey.name = 'keywords';
        document.head.appendChild(metaKey);
      }
      metaKey.content = seo.keywords;
    }

    // Favicon & Touch Icon
    const favIconUrl = global?.favicon || seo?.favicon;
    if (favIconUrl) {
      let fav = document.querySelector('link[rel="icon"]');
      if (fav) fav.href = favIconUrl;
      let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = favIconUrl;
    }

    // Open Graph
    if (seo?.title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.content = seo.title;
    }
    if (seo?.description) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.content = seo.description;
    }
    if (seo?.ogImage || global?.logo) {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) ogImg.content = seo?.ogImage || global?.logo;
    }
  }

  // ── Hydrate Top Announcement Bar ───────────────────────────────────────────
  function hydrateAnnouncement(headerConfig) {
    if (!headerConfig) return;
    let bar = document.getElementById('mb-announcement-bar');
    if (!headerConfig.announcementEnabled) {
      if (bar) bar.remove();
      return;
    }

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mb-announcement-bar';
      const nav = document.getElementById('main-nav');
      if (nav && nav.parentNode) {
        nav.parentNode.insertBefore(bar, nav);
      } else {
        document.body.prepend(bar);
      }
    }

    bar.style.cssText = `
      background: ${headerConfig.announcementBg || '#E60046'};
      color: #FFFFFF;
      padding: 0.6rem 1rem;
      font-size: 0.8125rem;
      font-weight: 600;
      text-align: center;
      position: relative;
      z-index: 1001;
      letter-spacing: 0.02em;
    `;

    if (headerConfig.announcementLink) {
      bar.innerHTML = `<a href="${headerConfig.announcementLink}" style="color:#FFFFFF; text-decoration:none; display:inline-flex; align-items:center; gap:0.5rem;">${headerConfig.announcementText} &rarr;</a>`;
    } else {
      bar.textContent = headerConfig.announcementText;
    }
  }

  // ── Hydrate Header & Navigation ────────────────────────────────────────────
  function hydrateHeader(data) {
    if (!data) return;
    const global = data.global || {};
    const header = data.header || global.header || {};

    // Logos
    const logoUrl = header.logoUrl || global.logoUrl || global.logo;
    if (logoUrl) {
      document.querySelectorAll('.nav-logo img').forEach(img => {
        img.src = logoUrl;
      });
    }

    // Logo text
    const brandName = header.brandName || header.navLogoText || global.siteName;
    if (brandName) {
      document.querySelectorAll('.nav-logo-name').forEach(el => {
        el.textContent = brandName;
      });
    }
    const brandSub = header.brandSubtitle || header.navLogoTag;
    if (brandSub) {
      document.querySelectorAll('.nav-logo-tag').forEach(el => {
        el.textContent = brandSub;
      });
    }

    // Store Badges visibility & store links
    const showPlay = header.showPlayStoreBadge !== false && header.showStoreBadges !== false;
    const showApple = header.showAppStoreBadge !== false && header.showStoreBadges !== false;
    const navPlayUrl = global.appLinks?.playStoreUrl || global.playStoreUrl || 'https://play.google.com/store/apps/details?id=com.gurmitraa.mittaibandi';
    const navAppleUrl = global.appLinks?.appStoreUrl || global.appStoreUrl || 'https://apps.apple.com/app/mittai-bandi/id6470000000';

    document.querySelectorAll('.nav-store-badges [data-action="download-play"], .nav-mobile-actions [data-action="download-play"]').forEach(el => {
      el.style.display = showPlay ? '' : 'none';
      if (navPlayUrl) el.href = navPlayUrl;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    });
    document.querySelectorAll('.nav-store-badges [data-action="download-apple"], .nav-mobile-actions [data-action="download-apple"]').forEach(el => {
      el.style.display = showApple ? '' : 'none';
      if (navAppleUrl) el.href = navAppleUrl;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    });

    // Navigation Links
    const rawLinks = Array.isArray(header.links) ? header.links : (Array.isArray(header.navLinks) ? header.navLinks : []);
    const visibleLinks = rawLinks.filter(l => l && l.visible !== false);
    if (visibleLinks.length > 0) {
      const navLinksUl = document.querySelector('.nav-links');
      const currentPath = window.location.pathname.split('/').pop() || 'index.html';
      if (navLinksUl) {
        navLinksUl.innerHTML = visibleLinks.map(link => {
          const href = link.href || link.url || '#';
          const isActive = (currentPath === href || (currentPath === '' && href === 'index.html'));
          return `<li><a href="${href}" class="nav-link ${isActive ? 'active' : ''}" target="${link.target || '_self'}">${link.label}</a></li>`;
        }).join('');
      }

      // Mobile Menu links
      const mobileMenu = document.querySelector('.nav-mobile-menu');
      if (mobileMenu) {
        const mobileActions = mobileMenu.querySelector('.nav-mobile-actions');
        const linksHtml = visibleLinks.map(link => {
          const href = link.href || link.url || '#';
          return `<a href="${href}" class="nav-mobile-link" target="${link.target || '_self'}">${link.label}</a>`;
        }).join('');
        mobileMenu.innerHTML = linksHtml;
        if (mobileActions) mobileMenu.appendChild(mobileActions);
      }
    }

    hydrateAnnouncement(header);
  }

  // ── Global Legal & Policy Documents Visibility Enforcement ────────────────
  function applyGlobalLegalVisibility(data) {
    if (!data) return;

    const isDocActive = (docKey) => {
      if (docKey === 'api') {
        const docAct = data.legalDocuments?.api?.active;
        const pageAct = data.pages?.api?.active;
        const pagePolAct = data.pages?.['api-policy']?.active;
        if (docAct === false || pageAct === false || pagePolAct === false) return false;
        return true;
      }
      if (docKey === 'privacy') {
        return (data.legalDocuments?.privacy?.active !== false) &&
               (data.pages?.privacy?.active !== false);
      }
      if (docKey === 'terms') {
        return (data.legalDocuments?.terms?.active !== false) &&
               (data.pages?.terms?.active !== false);
      }
      if (docKey === 'refund') {
        return (data.legalDocuments?.refund?.active !== false) &&
               (data.pages?.refund?.active !== false) &&
               (data.pages?.['cancellation-refund']?.active !== false);
      }
      return true;
    };

    const docConfigs = [
      { key: 'api', patterns: ['api-policy.html', 'api-policy', 'api_policy'], label: 'API Policy' },
      { key: 'privacy', patterns: ['privacy-policy.html', 'privacy-policy'], label: 'Privacy Policy' },
      { key: 'terms', patterns: ['terms-of-service.html', 'terms-of-service'], label: 'Terms of Service' },
      { key: 'refund', patterns: ['cancellation-refund.html', 'cancellation-refund'], label: 'Cancellation & Refund' }
    ];

    docConfigs.forEach(cfg => {
      const active = isDocActive(cfg.key);

      // 1. Selector-based lookup across the ENTIRE document (handles lists, footer, nav, pills)
      const selector = cfg.patterns.map(p => `a[href*="${p}"]`).join(', ');
      document.querySelectorAll(selector).forEach(a => {
        const li = a.closest('li');
        if (li) li.style.display = active ? '' : 'none';
        a.style.display = active ? '' : 'none';
      });

      // 2. Strict text-matching lookup for policy pills, tabs, and links anywhere in website
      document.querySelectorAll('a, .contact-nav-tab, .legal-nav-tab, .policy-nav-tab').forEach(el => {
        const txt = el.textContent.trim().toLowerCase();
        if (txt === cfg.label.toLowerCase() || (cfg.key === 'refund' && (txt.includes('cancellation') && txt.includes('refund')))) {
          const li = el.closest('li');
          if (li) li.style.display = active ? '' : 'none';
          el.style.display = active ? '' : 'none';
        }
      });

      // 3. If user is viewing the inactive policy page itself directly (e.g. api-policy.html):
      if (!active) {
        const curPath = (window.location.pathname || '').toLowerCase();
        const curFile = curPath.split('/').pop().replace(/\.html$/, '') || '';
        if (curFile === cfg.patterns[0].replace(/\.html$/, '') || curFile === cfg.key) {
          const legalArticle = document.querySelector('article.legal-content, .legal-body, .legal-article, main');
          if (legalArticle && !legalArticle.dataset.unavailableRendered) {
            legalArticle.dataset.unavailableRendered = 'true';
            legalArticle.innerHTML = `
              <div class="container" style="max-width:760px; margin: 4rem auto; text-align:center; padding: 3.5rem 2rem; background:#FFFFFF; border:1.5px solid #EEEEEE; border-radius:20px; box-shadow:0 10px 30px rgba(0,0,0,0.05);">
                <div style="font-size:3rem; margin-bottom:1rem;">📋</div>
                <h2 style="font-size:1.75rem; color:#1F2937; margin-bottom:0.75rem; font-weight:800;">${cfg.label} Unavailable</h2>
                <p style="color:#6B7280; max-width:540px; margin:0 auto 1.75rem; line-height:1.65; font-size:1rem;">This policy document is currently inactive or being updated. Please check back shortly or explore our website.</p>
                <a href="index.html" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.5rem; padding:0.75rem 2rem; border-radius:999px; background:#E60046; color:#FFFFFF; text-decoration:none; font-weight:700; box-shadow:0 4px 14px rgba(230,0,70,0.3);">Return to Homepage</a>
              </div>
            `;
          }
        }
      }
    });
  }

  // Helper to verify if a policy document is active
  function isDocumentActive(data, hrefOrLabel) {
    if (!hrefOrLabel || !data) return true;
    const str = String(hrefOrLabel).toLowerCase();
    if (str.includes('api')) {
      if (data.legalDocuments?.api?.active === false || data.pages?.api?.active === false || data.pages?.['api-policy']?.active === false) return false;
    }
    if (str.includes('privacy')) {
      if (data.legalDocuments?.privacy?.active === false || data.pages?.privacy?.active === false) return false;
    }
    if (str.includes('terms')) {
      if (data.legalDocuments?.terms?.active === false || data.pages?.terms?.active === false) return false;
    }
    if (str.includes('refund') || str.includes('cancellation')) {
      if (data.legalDocuments?.refund?.active === false || data.pages?.refund?.active === false || data.pages?.['cancellation-refund']?.active === false) return false;
    }
    return true;
  }

  // ── Footer Hydration ───────────────────────────────────────────────────────
  function hydrateFooter(data) {
    const global = data.global || {};
    const footer = data.footer || {};

    const brandName = document.querySelector('.site-footer .nav-logo-name');
    if (brandName) brandName.textContent = footer.brandName || global.brandName || 'MITTAI BANDI';

    const brandTag = document.querySelector('.site-footer .nav-logo-tag');
    if (brandTag) brandTag.textContent = footer.brandSubtitle || global.brandTagline || 'Traditional Taste';

    const brandDesc = document.querySelector('.footer-brand-desc');
    if (brandDesc) brandDesc.textContent = footer.brandDescription || footer.brandDesc || '';

    const powered = document.querySelector('.footer-powered');
    if (powered) {
      const pText = footer.poweredByText || (global.companyName ? `Powered by ${global.companyName}` : '');
      if (pText) powered.textContent = pText;
    }

    const copyright = document.querySelector('.footer-copyright, .footer-bottom p:first-child');
    if (copyright) {
      copyright.textContent = footer.copyrightText || footer.copyright;
    }

    // Footer Quick Links
    if (Array.isArray(footer.quickLinks) && footer.quickLinks.length > 0) {
      const qkUl = document.querySelector('.footer-grid > div:nth-child(2) .footer-links');
      if (qkUl) {
        qkUl.innerHTML = footer.quickLinks
          .filter(l => l && l.visible !== false)
          .map(l => `<li><a href="${l.href || l.url || '#'}" class="footer-link">${l.label}</a></li>`)
          .join('');
      }
    }

    // Footer Legal Links
    if (Array.isArray(footer.legalLinks) && footer.legalLinks.length > 0) {
      const legUl = document.querySelector('.footer-grid > div:nth-child(3) .footer-links');
      if (legUl) {
        legUl.innerHTML = footer.legalLinks
          .filter(l => l && l.visible !== false && isDocumentActive(data, l.href || l.label))
          .map(l => `<li><a href="${l.href || l.url || '#'}" class="footer-link">${l.label}</a></li>`)
          .join('');
      }
    }

    const btmSource = Array.isArray(footer.bottomLinks) && footer.bottomLinks.length > 0
      ? footer.bottomLinks
      : footer.legalLinks;
    if (Array.isArray(btmSource) && btmSource.length > 0) {
      const btmLinks = document.querySelector('.footer-bottom-links');
      if (btmLinks) {
        const renderedBottom = btmSource
          .filter(l => l && l.visible !== false && isDocumentActive(data, l.href || l.label))
          .map(l => `<a href="${l.href || l.url || '#'}" class="footer-bottom-link">${l.label}</a>`);

        // Ensure "Contact" and "Admin CMS" remain accessible in the footer bottom bar
        const hasContact = btmSource.some(l => l && /contact\.html$/i.test(l.href || l.url || ''));
        if (!hasContact) {
          renderedBottom.push(`<a href="contact.html" class="footer-bottom-link">Contact</a>`);
        }
        const hasAdmin = btmSource.some(l => l && /admin/i.test(l.href || l.url || ''));
        if (!hasAdmin) {
          renderedBottom.push(`<a href="admin/login.html" class="footer-bottom-link" style="opacity: 0.7;">Admin CMS</a>`);
        }

        btmLinks.innerHTML = renderedBottom.join('');
      }
    }

    // Global Legal & Policy Documents Visibility Enforcement (API Policy, Privacy, Terms, Refund)
    applyGlobalLegalVisibility(data);

    // Store Badges in footer
    if (footer.showAppBadges === false || footer.showStoreBadges === false) {
      document.querySelectorAll('.footer-store-badges').forEach(el => el.style.display = 'none');
    } else {
      document.querySelectorAll('.footer-store-badges').forEach(el => el.style.display = '');
    }

    // Social icons visibility
    if (footer.showSocialIcons === false) {
      document.querySelectorAll('.footer-social').forEach(el => el.style.display = 'none');
    } else {
      document.querySelectorAll('.footer-social').forEach(el => el.style.display = '');
    }

    // Contact info in footer
    const contactCol = document.querySelector('.footer-grid > div:nth-child(4)');
    if (contactCol) {
      const items = contactCol.querySelectorAll('.footer-contact-item');
      const addrText = footer.address || (global.companyName && global.contact?.address ? `${global.companyName}<br />${global.contact.address}` : null);
      const emailText = footer.email || global.contact?.email;
      const phoneText = footer.phone || global.contact?.phone;
      if (items[0] && addrText) {
        items[0].innerHTML = addrText.replace(/,\s*Rajahmundry/, '<br />Rajahmundry');
      }
      if (items[1] && emailText) {
        items[1].innerHTML = `<a href="mailto:${emailText}">${emailText}</a>`;
      }
      if (items[2] && phoneText) {
        const cleanPhone = phoneText.replace(/\s+/g, '');
        items[2].innerHTML = `<a href="tel:${cleanPhone}">${phoneText}</a>`;
      }
    }

    // Social Links
    if (global.social) {
      document.querySelectorAll('[data-social]').forEach(link => {
        const plat = link.dataset.social;
        const url = global.social[plat];
        if (url) {
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.style.display = '';
        }
      });
    }

    // App Download Badges (Global Customer App)
    const playUrl = global.appLinks?.playStoreUrl || global.playStoreUrl;
    const appleUrl = global.appLinks?.appStoreUrl || global.appStoreUrl;
    if (window.MITTAI_CONFIG) {
      if (playUrl) window.MITTAI_CONFIG.playStoreUrl = playUrl;
      if (appleUrl) window.MITTAI_CONFIG.appStoreUrl = appleUrl;
      if (global.social) window.MITTAI_CONFIG.social = global.social;
      if (global.contact) window.MITTAI_CONFIG.contact = global.contact;
    }
    if (playUrl) {
      document.querySelectorAll('[data-action="download-play"]:not([data-custom-app])').forEach(btn => {
        btn.href = playUrl;
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
      });
    }
    if (appleUrl) {
      document.querySelectorAll('[data-action="download-apple"]:not([data-custom-app])').forEach(btn => {
        btn.href = appleUrl;
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
      });
    }
  }

  // ── Section Reordering & Visibility Engine ─────────────────────────────────
  function reorderAndToggleSections(pageData) {
    if (!pageData) return;
    const sections = pageData.sections || {};

    // 1. Apply visibility toggles (visible / active / enabled) on all sections
    Object.keys(sections).forEach(secId => {
      const secConf = sections[secId];
      if (!secConf) return;
      const el = document.getElementById(secId) || document.querySelector(`[data-section="${secId}"]`) || document.querySelector(`.${secId}`);
      if (el) {
        const isHidden = secConf.visible === false || secConf.active === false || secConf.enabled === false;
        el.style.display = isHidden ? 'none' : '';
      }
    });

    if (!Array.isArray(pageData.sectionOrder) || pageData.sectionOrder.length < 2) return;
    const sectionOrder = pageData.sectionOrder;

    // 2. Safe DOM Reordering (Crucial: Keep footer ALWAYS at the bottom!)
    const footerEl = document.querySelector('footer');
    const firstSec = document.getElementById(sectionOrder[0]);
    const parent = firstSec ? firstSec.parentElement : (document.querySelector('main') || document.body);
    if (!parent) return;

    const domSections = sectionOrder
      .map(id => document.getElementById(id) || document.querySelector(`[data-section="${id}"]`))
      .filter(el => el && el.parentElement === parent);

    if (domSections.length < 2) return;

    let alreadyInOrder = true;
    for (let i = 0; i < domSections.length - 1; i++) {
      const pos = domSections[i].compareDocumentPosition(domSections[i + 1]);
      if (!(pos & 4)) {
        alreadyInOrder = false;
        break;
      }
    }

    if (alreadyInOrder) {
      if (footerEl && footerEl.parentElement === parent) {
        const lastSec = domSections[domSections.length - 1];
        if (lastSec && (footerEl.compareDocumentPosition(lastSec) & 4)) {
          lastSec.after(footerEl);
        }
      }
      return;
    }

    if (footerEl && footerEl.parentElement === parent) {
      domSections.forEach(secEl => parent.insertBefore(secEl, footerEl));
    } else {
      domSections.forEach(secEl => parent.appendChild(secEl));
      if (footerEl && footerEl.parentElement === parent) parent.appendChild(footerEl);
    }

    if (footerEl && footerEl.parentElement === parent) {
      const scripts = Array.from(parent.querySelectorAll('script')).filter(s => s.parentElement === parent);
      if (scripts.length > 0) {
        parent.insertBefore(footerEl, scripts[0]);
      } else {
        parent.appendChild(footerEl);
      }
    }
  }

  // ── Helper: Update button label safely without destroying child SVG icons ──
  function setButtonLabelAndHref(btn, btnConf) {
    if (!btn || !btnConf) return;
    btn.style.display = btnConf.visible === false ? 'none' : '';
    const text = btnConf.label || btnConf.text;
    const href = btnConf.href || btnConf.link || btnConf.url;
    if (text) {
      const labelSpan = btn.querySelector('.btn-label');
      if (labelSpan) {
        labelSpan.textContent = text;
      } else {
        const textNode = Array.from(btn.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
        if (textNode) {
          textNode.nodeValue = text + ' ';
        } else {
          btn.textContent = text;
        }
      }
    }
    if (href) btn.href = href;
  }

  // ── Helper: Extract YouTube ID from any format ─────────────────────────────
  function extractYouTubeId(urlOrId) {
    if (!urlOrId) return '';
    const str = String(urlOrId).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
    const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/i);
    return match ? match[1] : '';
  }

  // ── Setup Website Hero YouTube Video with Responsive Switching & Fallback ──
  let _heroYtPlayer = null;
  let _heroCurrentVideoId = null;
  let _heroCurrentIsMobile = null;
  let _heroFailTimer = null;

  function setupWebsiteHeroYouTube(heroData) {
    const ytWrap = document.getElementById('hero-yt-wrap');
    if (!ytWrap) return;

    if (!heroData || typeof heroData !== 'object') {
      ytWrap.style.display = 'none';
      ytWrap.classList.remove('yt-playing');
      return;
    }

    const showVideo = heroData.showVideo !== false;
    const isMobile = window.innerWidth <= 768;

    // Pick responsive target video URL based on viewport:
    // Mobile viewport (<=768px): mobile URL -> mobile video ID -> desktop URL -> fallback
    // Desktop viewport (>768px): desktop URL -> desktop video ID -> fallback -> mobile URL
    let targetRawUrl = '';
    if (isMobile) {
      targetRawUrl = (heroData.mobileYoutubeUrl && heroData.mobileYoutubeUrl.trim())
        || (heroData.mobileVideoId && heroData.mobileVideoId.trim())
        || (heroData.desktopYoutubeUrl && heroData.desktopYoutubeUrl.trim())
        || (heroData.desktopVideoId && heroData.desktopVideoId.trim())
        || heroData.youtubeUrl || heroData.videoUrl || heroData.videoId || '';
    } else {
      targetRawUrl = (heroData.desktopYoutubeUrl && heroData.desktopYoutubeUrl.trim())
        || (heroData.desktopVideoId && heroData.desktopVideoId.trim())
        || heroData.youtubeUrl || heroData.videoUrl || heroData.videoId
        || (heroData.mobileYoutubeUrl && heroData.mobileYoutubeUrl.trim())
        || (heroData.mobileVideoId && heroData.mobileVideoId.trim()) || '';
    }

    // Filter out obsolete legacy fallback ID if encountered
    if (typeof targetRawUrl === 'string' && targetRawUrl.includes('ZU5BKMTEI9E')) {
      targetRawUrl = (isMobile ? (heroData.mobileYoutubeUrl || heroData.desktopYoutubeUrl) : (heroData.desktopYoutubeUrl || heroData.mobileYoutubeUrl)) || '';
    }

    const videoId = extractYouTubeId(targetRawUrl);

    if (!showVideo || !videoId) {
      ytWrap.style.display = 'none';
      ytWrap.classList.remove('yt-playing');
      if (_heroFailTimer) { clearTimeout(_heroFailTimer); _heroFailTimer = null; }
      if (_heroYtPlayer) {
        try {
          if (typeof _heroYtPlayer.destroy === 'function') _heroYtPlayer.destroy();
          else if (typeof _heroYtPlayer.pauseVideo === 'function') _heroYtPlayer.pauseVideo();
        } catch (_) {}
        _heroYtPlayer = null;
      }
      _heroCurrentVideoId = null;
      _heroCurrentIsMobile = null;
      return;
    }

    // Apply responsive geometry classes: mode-mobile for 9:16 portrait, mode-desktop for 16:9 landscape
    ytWrap.style.display = 'block';
    ytWrap.classList.remove('mode-desktop', 'mode-mobile');
    ytWrap.classList.add(isMobile ? 'mode-mobile' : 'mode-desktop');

    // If already playing the EXACT same video in the same mode, avoid unnecessary player reloads
    if (_heroYtPlayer && _heroCurrentVideoId === videoId && _heroCurrentIsMobile === isMobile) {
      return;
    }

    _heroCurrentVideoId = videoId;
    _heroCurrentIsMobile = isMobile;

    // Reset inner container cleanly so YouTube iframe API mounts to a fresh div node
    if (_heroFailTimer) { clearTimeout(_heroFailTimer); _heroFailTimer = null; }
    ytWrap.classList.remove('yt-playing');
    if (_heroYtPlayer) {
      try {
        if (typeof _heroYtPlayer.destroy === 'function') {
          _heroYtPlayer.destroy();
        }
      } catch (_) {}
      _heroYtPlayer = null;
    }
    ytWrap.innerHTML = '<div id="hero-yt-player"></div>';

    const initPlayer = () => {
      // Safety timeout: if YouTube playback does not begin within 4.5s, keep fallback poster visible
      _heroFailTimer = setTimeout(() => {
        console.warn('[Hero Video] YouTube playback took >4.5s; maintaining fallback poster image.');
        ytWrap.classList.remove('yt-playing');
      }, 4500);

      try {
        _heroYtPlayer = new window.YT.Player('hero-yt-player', {
          videoId: videoId,
          playerVars: {
            autoplay: 1,
            mute: 1,
            loop: 1,
            playlist: videoId,
            controls: 0,
            showinfo: 0,
            rel: 0,
            modestbranding: 1,
            disablekb: 1,
            iv_load_policy: 3,
            playsinline: 1,
            origin: window.location.origin
          },
          events: {
            onReady: function (e) {
              try {
                e.target.mute();
                e.target.playVideo();
              } catch (_) {}
            },
            onStateChange: function (e) {
              if (window.YT && e.data === window.YT.PlayerState.PLAYING) {
                if (_heroFailTimer) { clearTimeout(_heroFailTimer); _heroFailTimer = null; }
                ytWrap.classList.add('yt-playing');
              }
              if (window.YT && e.data === window.YT.PlayerState.ENDED) {
                try { e.target.playVideo(); } catch (_) {}
              }
            },
            onError: function (err) {
              if (_heroFailTimer) { clearTimeout(_heroFailTimer); _heroFailTimer = null; }
              console.warn('[Hero Video] YouTube Player Error code:', err.data, '— Showing responsive fallback poster.');
              ytWrap.classList.remove('yt-playing');
            }
          }
        });
      } catch (err) {
        if (_heroFailTimer) { clearTimeout(_heroFailTimer); _heroFailTimer = null; }
        console.warn('[Hero Video] Could not initialize YouTube player:', err);
        ytWrap.classList.remove('yt-playing');
      }
    };

    if (window.YT && typeof window.YT.Player === 'function') {
      initPlayer();
    } else {
      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prevReady === 'function') prevReady();
        initPlayer();
      };
      if (!document.getElementById('yt-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        const firstScript = document.getElementsByTagName('script')[0];
        if (firstScript && firstScript.parentNode) {
          firstScript.parentNode.insertBefore(tag, firstScript);
        } else {
          document.head.appendChild(tag);
        }
      }
    }
  }

  // Viewport breakpoint listener: dynamically switch between Desktop (16:9) and Mobile (9:16)
  if (typeof window !== 'undefined' && !window._heroBreakpointAttached) {
    window._heroBreakpointAttached = true;
    const mql = window.matchMedia('(max-width: 768px)');
    const handleBreakpointSwitch = () => {
      const hero = cmsData?.pages?.home?.sections?.hero;
      if (hero) setupWebsiteHeroYouTube(hero);
    };
    if (mql.addEventListener) {
      mql.addEventListener('change', handleBreakpointSwitch);
    } else if (mql.addListener) {
      mql.addListener(handleBreakpointSwitch);
    }
  }

  // Real-time synchronization across browser tabs when CMS publishes
  if (typeof window !== 'undefined' && !window._cmsStorageListenerAttached) {
    window._cmsStorageListenerAttached = true;
    window.addEventListener('storage', (e) => {
      if (e.key === LIVE_KEY && e.newValue) {
        try {
          const updatedLive = JSON.parse(e.newValue);
          if (updatedLive && typeof updatedLive === 'object') {
            cmsData = updatedLive;
            if (isDomHydrated) {
              hydrateEverything(updatedLive);
            }
          }
        } catch (_) {}
      }
    });
  }

  // ── Page-Specific Section Content Hydration ────────────────────────────────
  function hydratePageContent(pageKey, pageData, data) {
    data = data || cmsData || {};
    if (!pageData && !cmsData?.legalDocuments?.[pageKey]) return;
    const sec = (pageData && pageData.sections) ? pageData.sections : {};

    // ──────────────────────────────────────────────────────────────────────────
    // HOME PAGE HYDRATION
    // ──────────────────────────────────────────────────────────────────────────
    if (pageKey === 'home') {
      // 1. Hero
      if (sec.hero) {
        const heroEl = document.getElementById('hero');
        if (heroEl) {
          const isHeroActive = sec.hero.visible !== false && sec.hero.active !== false;
          heroEl.style.display = isHeroActive ? '' : 'none';

          const eyebrow = heroEl.querySelector('.hero-eyebrow span');
          if (eyebrow && sec.hero.eyebrow) eyebrow.textContent = sec.hero.eyebrow;

          const heading = heroEl.querySelector('.hero-heading');
          if (heading && (sec.hero.heading || sec.hero.title)) {
            heading.textContent = sec.hero.heading || sec.hero.title;
          }

          const tagline = heroEl.querySelector('.hero-tagline');
          if (tagline && (sec.hero.tagline || sec.hero.subtitle)) {
            tagline.textContent = sec.hero.tagline || sec.hero.subtitle;
          }

          const sub = heroEl.querySelector('.hero-subheading');
          const subText = sec.hero.subheading || sec.hero.description;
          if (sub && subText) sub.textContent = subText;

          // Text Alignment (left, center, right)
          const contentBox = heroEl.querySelector('.hero-content');
          if (contentBox) {
            contentBox.classList.remove('align-left', 'align-center', 'align-right');
            const align = sec.hero.textAlignment || 'left';
            contentBox.classList.add(`align-${align}`);
          }

          // Responsive Fallback Poster Images (Desktop 16:9 & Mobile 9:16)
          const desktopImg = sec.hero.desktopImage || sec.hero.image || sec.hero.bgImage || 'assets/images/artisan_making_sweets.png';
          const mobileImg = sec.hero.mobileImage || desktopImg;
          const fallbackEnabled = sec.hero.fallbackImageEnabled !== false;
          const imgPos = sec.hero.imagePosition || 'center center';

          const sourceMob = heroEl.querySelector('#hero-source-mobile');
          if (sourceMob) sourceMob.srcset = mobileImg;
          const sourceDesk = heroEl.querySelector('#hero-source-desktop');
          if (sourceDesk) sourceDesk.srcset = desktopImg;

          const bgImgEl = heroEl.querySelector('#hero-bg-img, .hero-bg-img');
          if (bgImgEl) {
            const isMob = window.innerWidth <= 768;
            bgImgEl.src = isMob ? mobileImg : desktopImg;
            bgImgEl.style.objectPosition = imgPos;
            bgImgEl.style.display = fallbackEnabled ? 'block' : 'none';
          }

          const media = heroEl.querySelector('.hero-media');
          if (media) {
            media.style.backgroundImage = fallbackEnabled ? `url('${window.innerWidth <= 768 ? mobileImg : desktopImg}')` : 'none';
            media.style.backgroundPosition = imgPos;
          }

          // YouTube Hero Background Video & Failure Fallback
          setupWebsiteHeroYouTube(sec.hero);

          // Buttons
          const btn1 = heroEl.querySelector('.hero-actions .btn-primary');
          if (btn1 && sec.hero.btnPrimary) setButtonLabelAndHref(btn1, sec.hero.btnPrimary);

          const btn2 = heroEl.querySelector('.hero-actions .btn-secondary');
          if (btn2 && sec.hero.btnSecondary) setButtonLabelAndHref(btn2, sec.hero.btnSecondary);

          const scrollSpan = heroEl.querySelector('.hero-scroll span');
          if (scrollSpan && sec.hero.scrollText) scrollSpan.textContent = sec.hero.scrollText;
        }
      }

      // 2. Marquee
      if (sec.marquee && Array.isArray(sec.marquee.items) && sec.marquee.items.length) {
        const marqueeInner = document.querySelector('.marquee-inner');
        if (marqueeInner) {
          const doubleItems = [...sec.marquee.items, ...sec.marquee.items];
          marqueeInner.innerHTML = doubleItems.map(item => {
            return `<span class="marquee-item"><span class="marquee-dot"></span> ${escapeHtml(item)}</span>`;
          }).join('');
        }
      }

      // 3. Brand Intro
      if (sec['brand-intro']) {
        const bi = document.getElementById('brand-intro');
        if (bi) {
          const eye = bi.querySelector('.eyebrow');
          if (eye && sec['brand-intro'].eyebrow) eye.textContent = sec['brand-intro'].eyebrow;

          const h2 = bi.querySelector('.display-lg, h2');
          if (h2 && sec['brand-intro'].heading) h2.textContent = sec['brand-intro'].heading;

          const pLg = bi.querySelector('.body-lg');
          const lead = sec['brand-intro'].leadText || sec['brand-intro'].subheading;
          if (pLg && lead) pLg.textContent = lead;

          const pBase = bi.querySelector('.body-base');
          const body = sec['brand-intro'].bodyText || sec['brand-intro'].description;
          if (pBase && body) pBase.textContent = body;

          const img = bi.querySelector('.brand-intro-img');
          if (img && sec['brand-intro'].image) {
            img.src = sec['brand-intro'].image;
            if (sec['brand-intro'].imageAlt) img.alt = sec['brand-intro'].imageAlt;
          }

          const btn = bi.querySelector('.btn-outline, .btn');
          if (btn && sec['brand-intro'].button) setButtonLabelAndHref(btn, sec['brand-intro'].button);
        }
      }

      // 4. Categories
      if (sec.categories) {
        const catSec = document.getElementById('categories');
        if (catSec) {
          const eye = catSec.querySelector('.eyebrow');
          if (eye && sec.categories.eyebrow) eye.textContent = sec.categories.eyebrow;

          const h2 = catSec.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec.categories.heading) h2.textContent = sec.categories.heading;

          const p = catSec.querySelector('.section-header-center p, .section-header p');
          const sub = sec.categories.subheading || sec.categories.description;
          if (p && sub) p.textContent = sub;

          const catList = sec.categories.cards || sec.categories.items;
          if (Array.isArray(catList)) {
            const cards = catSec.querySelectorAll('.category-card');
            catList.forEach((item, idx) => {
              const card = cards[idx];
              if (!card) return;
              card.style.display = item.visible === false ? 'none' : '';
              if (item.href) card.href = item.href;

              const tagEl = card.querySelector('.category-tag, .badge');
              if (tagEl && (item.badge || item.tag)) tagEl.textContent = item.badge || item.tag;

              const title = card.querySelector('.category-card-title, .category-title, h3');
              if (title && item.title) title.textContent = item.title;

              const desc = card.querySelector('.category-card-desc, .category-desc, p');
              if (desc && (item.description || item.desc)) desc.textContent = item.description || item.desc;

              const img = card.querySelector('.category-card-img img, .category-img, img');
              if (img && item.image) img.src = item.image;
            });
          }
        }
      }

      // 5. Regional
      if (sec.regional) {
        const reg = document.getElementById('regional');
        if (reg) {
          const eye = reg.querySelector('.eyebrow');
          if (eye && sec.regional.eyebrow) eye.textContent = sec.regional.eyebrow;

          const h2 = reg.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec.regional.heading) h2.textContent = sec.regional.heading;

          const p = reg.querySelector('.section-header-center p, .regional-intro');
          const sub = sec.regional.subheading || sec.regional.description;
          if (p && sub) p.textContent = sub;

          const regList = sec.regional.cards || sec.regional.items;
          if (Array.isArray(regList)) {
            const cards = reg.querySelectorAll('.regional-card');
            regList.forEach((item, idx) => {
              const card = cards[idx];
              if (!card) return;
              const regTag = card.querySelector('.regional-tag, .eyebrow');
              if (regTag && item.region) regTag.textContent = item.region;
              const h3 = card.querySelector('h3');
              if (h3 && item.title) h3.textContent = item.title;
              const desc = card.querySelector('p');
              if (desc && (item.description || item.desc)) desc.textContent = item.description || item.desc;
              const img = card.querySelector('img');
              if (img && item.image) img.src = item.image;
            });
          }
        }
      }

      // 6. Features
      if (sec.features) {
        const feat = document.getElementById('features');
        if (feat) {
          const eye = feat.querySelector('.eyebrow');
          if (eye && sec.features.eyebrow) eye.textContent = sec.features.eyebrow;

          const h2 = feat.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec.features.heading) h2.textContent = sec.features.heading;

          const p = feat.querySelector('.section-header-center p, .section-header p');
          const sub = sec.features.subheading || sec.features.description;
          if (p && sub) p.textContent = sub;

          const featList = sec.features.cards || sec.features.items;
          if (Array.isArray(featList)) {
            const cards = feat.querySelectorAll('.feature-card');
            featList.forEach((item, idx) => {
              const card = cards[idx];
              if (!card) return;
              const h3 = card.querySelector('.feature-title, h3');
              if (h3 && item.title) h3.textContent = item.title;
              const desc = card.querySelector('.feature-desc, p');
              if (desc && (item.description || item.desc)) desc.textContent = item.description || item.desc;
            });
          }
        }
      }

      // 7. Community (Customer & Vendor Benefits Dual Panels)
      if (sec.community) {
        const comm = document.getElementById('community');
        if (comm) {
          const eye = comm.querySelector('.eyebrow');
          if (eye && sec.community.eyebrow) eye.textContent = sec.community.eyebrow;

          const h2 = comm.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec.community.heading) h2.textContent = sec.community.heading;

          const custPanel = comm.querySelector('.dual-panel--customer');
          if (custPanel) {
            const cTitle = custPanel.querySelector('.dual-panel-title');
            if (cTitle && sec.community.customerTitle) cTitle.textContent = sec.community.customerTitle;
            if (Array.isArray(sec.community.customerItems)) {
              const lis = custPanel.querySelectorAll('.dual-panel-list li span:last-child');
              sec.community.customerItems.forEach((txt, i) => {
                if (lis[i] && txt) lis[i].textContent = txt;
              });
            }
            const cBtn = custPanel.querySelector('.btn');
            if (cBtn && (sec.community.customerBtnLabel || sec.community.customerBtnHref)) {
              setButtonLabelAndHref(cBtn, { label: sec.community.customerBtnLabel, href: sec.community.customerBtnHref });
            }
          }

          const vendPanel = comm.querySelector('.dual-panel--vendor');
          if (vendPanel) {
            const vTitle = vendPanel.querySelector('.dual-panel-title');
            if (vTitle && sec.community.vendorTitle) vTitle.textContent = sec.community.vendorTitle;
            if (Array.isArray(sec.community.vendorItems)) {
              const lis = vendPanel.querySelectorAll('.dual-panel-list li span:last-child');
              sec.community.vendorItems.forEach((txt, i) => {
                if (lis[i] && txt) lis[i].textContent = txt;
              });
            }
            const vBtn = vendPanel.querySelector('.btn');
            if (vBtn && (sec.community.vendorBtnLabel || sec.community.vendorBtnHref)) {
              setButtonLabelAndHref(vBtn, { label: sec.community.vendorBtnLabel, href: sec.community.vendorBtnHref });
            }
          }
        }
      }

      // 8. Our Commitment (#vision on Home)
      if (sec.vision) {
        const vis = document.getElementById('vision');
        if (vis) {
          const eye = vis.querySelector('.eyebrow');
          if (eye && sec.vision.eyebrow) eye.textContent = sec.vision.eyebrow;

          const h2 = vis.querySelector('.display-xl, h2');
          if (h2 && (sec.vision.heading || sec.vision.quote)) {
            h2.textContent = sec.vision.heading || sec.vision.quote;
          }

          const p = vis.querySelector('.heritage-content p');
          if (p && sec.vision.description) p.textContent = sec.vision.description;

          if (sec.vision.bgImage) {
            const bgImg = vis.querySelector('.heritage-bg img');
            if (bgImg) {
              bgImg.src = sec.vision.bgImage;
              bgImg.style.opacity = '1';
            }
          }

          const btn = vis.querySelector('.heritage-content .btn');
          if (btn && sec.vision.button) setButtonLabelAndHref(btn, sec.vision.button);
        }
      }

      // 9. App Showcase
      if (sec.app) {
        const appSec = document.getElementById('app');
        if (appSec) {
          const eye = appSec.querySelector('.eyebrow');
          if (eye && sec.app.eyebrow) eye.textContent = sec.app.eyebrow;

          const h2 = appSec.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec.app.heading) h2.textContent = sec.app.heading;

          const p = appSec.querySelector('.body-lg');
          const sub = sec.app.subheading || sec.app.description;
          if (p && sub) p.textContent = sub;

          if (Array.isArray(sec.app.features)) {
            const lis = appSec.querySelectorAll('.app-features-list li');
            sec.app.features.forEach((f, idx) => {
              const li = lis[idx];
              if (!li || !f) return;
              const textNode = Array.from(li.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
              if (textNode) textNode.nodeValue = '\n              ' + f + '\n            ';
            });
          }

          const mockHero = appSec.querySelector('.phone-app-hero img');
          if (mockHero && sec.app.mockupHeroImage) mockHero.src = sec.app.mockupHeroImage;

          const mockCards = appSec.querySelectorAll('.phone-app-card img');
          if (mockCards[0] && sec.app.mockupCard1Image) mockCards[0].src = sec.app.mockupCard1Image;
          if (mockCards[1] && sec.app.mockupCard2Image) mockCards[1].src = sec.app.mockupCard2Image;
        }
      }

      // 10. How It Works
      if (sec['how-it-works']) {
        const hiw = document.getElementById('how-it-works');
        if (hiw) {
          const eye = hiw.querySelector('.eyebrow');
          if (eye && sec['how-it-works'].eyebrow) eye.textContent = sec['how-it-works'].eyebrow;

          const h2 = hiw.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec['how-it-works'].heading) h2.textContent = sec['how-it-works'].heading;

          const p = hiw.querySelector('.section-header-center p');
          if (p && sec['how-it-works'].subheading) p.textContent = sec['how-it-works'].subheading;

          if (Array.isArray(sec['how-it-works'].steps)) {
            const cards = hiw.querySelectorAll('.step-card');
            sec['how-it-works'].steps.forEach((st, idx) => {
              const card = cards[idx];
              if (!card) return;
              const num = card.querySelector('.step-number');
              if (num && st.number) num.textContent = st.number;
              const h3 = card.querySelector('h3');
              if (h3 && st.title) h3.textContent = st.title;
              const desc = card.querySelector('p');
              if (desc && st.description) desc.textContent = st.description;
            });
          }
        }
      }

      // 11. Download Banner
      if (sec.download) {
        const dl = document.getElementById('download');
        if (dl) {
          if (sec.download.bgImage) {
            const img = dl.querySelector('.download-banner-full-img, .download-banner-bg, img');
            if (img) img.src = sec.download.bgImage;
          }
        }
      }

      // 12. Company Info
      if (sec['company-info']) {
        const ci = document.getElementById('company-info');
        if (ci) {
          const eye = ci.querySelector('.eyebrow');
          if (eye && sec['company-info'].eyebrow) eye.textContent = sec['company-info'].eyebrow;
          const h2 = ci.querySelector('.display-md, h2');
          if (h2 && sec['company-info'].heading) h2.textContent = sec['company-info'].heading;
          const p = ci.querySelector('.body-base, p');
          if (p && sec['company-info'].description) p.textContent = sec['company-info'].description;
        }
      }

      // 13. FAQ
      if (sec.faq) {
        const faqSec = document.getElementById('faq');
        if (faqSec) {
          const eye = faqSec.querySelector('.eyebrow');
          if (eye && sec.faq.eyebrow) eye.textContent = sec.faq.eyebrow;

          const h2 = faqSec.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec.faq.heading) h2.textContent = sec.faq.heading;

          const p = faqSec.querySelector('.section-header-center p');
          if (p && sec.faq.subheading) p.textContent = sec.faq.subheading;

          if (Array.isArray(sec.faq.items) && sec.faq.items.length) {
            const faqGrid = faqSec.querySelector('.faq-grid, .faq-list');
            if (faqGrid) {
              faqGrid.innerHTML = sec.faq.items.map((item, idx) => {
                const qText = item.question || item.q || '';
                const aText = item.answer || item.a || '';
                return `
                  <div class="faq-item ${idx === 0 ? 'open' : ''}">
                    <button class="faq-question" type="button" aria-expanded="${idx === 0 ? 'true' : 'false'}">
                      <span>${escapeHtml(qText)}</span>
                      <span class="icon faq-question-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                      </span>
                    </button>
                    <div class="faq-answer">
                      <div class="faq-answer-inner">${escapeHtml(aText)}</div>
                    </div>
                  </div>
                `;
              }).join('');

              faqGrid.querySelectorAll('.faq-question').forEach(btn => {
                btn.addEventListener('click', function () {
                  const item = btn.closest('.faq-item');
                  const isOpen = item.classList.contains('open');
                  faqGrid.querySelectorAll('.faq-item.open').forEach(el => {
                    el.classList.remove('open');
                    el.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
                  });
                  if (!isOpen) {
                    item.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                  }
                });
              });
            }
          }
        }
      }

      // 14. Contact
      if (sec.contact) {
        const cont = document.getElementById('contact');
        if (cont) {
          const eye = cont.querySelector('.eyebrow');
          if (eye && sec.contact.eyebrow) eye.textContent = sec.contact.eyebrow;

          const h2 = cont.querySelector('.display-xl, .display-lg, h2');
          if (h2 && sec.contact.heading) h2.textContent = sec.contact.heading;

          const p = cont.querySelector('.section-header-center p, .body-lg');
          const sub = sec.contact.subheading || sec.contact.description;
          if (p && sub) p.textContent = sub;
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ABOUT US PAGE HYDRATION
    // ──────────────────────────────────────────────────────────────────────────
    else if (pageKey === 'about') {
      if (sec['about-hero']) {
        const hero = document.getElementById('about-hero') || document.querySelector('.about-hero');
        if (hero) {
          const eye = hero.querySelector('.eyebrow');
          if (eye && sec['about-hero'].eyebrow) eye.textContent = sec['about-hero'].eyebrow;

          const h1 = hero.querySelector('h1');
          if (h1 && sec['about-hero'].heading) h1.textContent = sec['about-hero'].heading;

          const sub = hero.querySelector('.body-xl, .body-lg, .hero-subheading');
          const subText = sec['about-hero'].description || sec['about-hero'].subheading;
          if (sub && subText) sub.textContent = subText;

          const bg = hero.querySelector('.about-hero-bg img, .page-hero-bg-img, img');
          if (bg && sec['about-hero'].bgImage) {
            bg.src = sec['about-hero'].bgImage;
            bg.style.opacity = '1';
          }
        }
      }

      if (sec.story) {
        const story = document.getElementById('story');
        if (story) {
          const eye = story.querySelector('.eyebrow');
          if (eye && sec.story.eyebrow) eye.textContent = sec.story.eyebrow;

          const h2 = story.querySelector('h2');
          if (h2 && sec.story.heading) h2.textContent = sec.story.heading;

          const lead = story.querySelector('.story-lead, .story-text .body-lg');
          if (lead && (sec.story.lead || sec.story.leadText)) lead.textContent = sec.story.lead || sec.story.leadText;

          const p1 = story.querySelector('.story-p1');
          if (p1 && (sec.story.paragraph1 || sec.story.p1)) p1.textContent = sec.story.paragraph1 || sec.story.p1;

          const p2 = story.querySelector('.story-p2');
          if (p2 && (sec.story.paragraph2 || sec.story.p2)) p2.textContent = sec.story.paragraph2 || sec.story.p2;

          const p3 = story.querySelector('.story-p3');
          if (p3 && (sec.story.paragraph3 || sec.story.p3)) p3.textContent = sec.story.paragraph3 || sec.story.p3;

          const quoteEl = story.querySelector('.story-quote-text, .story-quote-card blockquote');
          if (quoteEl && sec.story.quote) quoteEl.textContent = sec.story.quote;

          const citeEl = story.querySelector('.story-quote-cite, .story-quote-card cite');
          if (citeEl && sec.story.quoteCite) citeEl.textContent = sec.story.quoteCite;

          const img = story.querySelector('.story-img, .story-img-wrap img');
          if (img && sec.story.image) img.src = sec.story.image;
        }
      }

      if (sec.vision) {
        const vis = document.getElementById('vision');
        if (vis) {
          const eye = vis.querySelector('.vision-eyebrow, .eyebrow');
          if (eye && sec.vision.eyebrow) eye.textContent = sec.vision.eyebrow;

          const h2 = vis.querySelector('.vision-heading, .display-lg, .display-xl, h2');
          if (h2 && sec.vision.heading) {
            h2.innerHTML = sec.vision.heading.includes('<') ? sec.vision.heading : escapeHtml(sec.vision.heading);
          }

          const vp1 = vis.querySelector('.vision-p1');
          if (vp1 && (sec.vision.paragraph1 || sec.vision.p1)) vp1.textContent = sec.vision.paragraph1 || sec.vision.p1;

          const vp2 = vis.querySelector('.vision-p2');
          if (vp2 && (sec.vision.paragraph2 || sec.vision.p2)) vp2.textContent = sec.vision.paragraph2 || sec.vision.p2;

          const quoteText = vis.querySelector('.vision-quote-text');
          if (quoteText && sec.vision.quote) quoteText.textContent = `“${sec.vision.quote.replace(/^["“]|["”]$/g, '')}”`;

          const quoteCite = vis.querySelector('.vision-quote-cite');
          if (quoteCite && sec.vision.quoteCite) quoteCite.textContent = `— ${sec.vision.quoteCite.replace(/^[—–-]\s*/, '')}`;

          const badgeText = vis.querySelector('.vision-badge-text');
          if (badgeText && sec.vision.badgeText) badgeText.textContent = sec.vision.badgeText;

          const visImg = vis.querySelector('.vision-img, img');
          const imgSrc = sec.vision.image || sec.vision.bgImage;
          if (visImg && imgSrc) {
            visImg.src = imgSrc;
            visImg.style.opacity = '1';
          }
        }
      }

      if (sec.mission) {
        const mis = document.getElementById('mission');
        if (mis) {
          const eye = mis.querySelector('.eyebrow');
          if (eye && sec.mission.eyebrow) eye.textContent = sec.mission.eyebrow;

          const h2 = mis.querySelector('.display-lg, h2');
          if (h2 && sec.mission.heading) h2.textContent = sec.mission.heading;

          const p = mis.querySelector('.section-header-center p');
          if (p && sec.mission.subheading) p.textContent = sec.mission.subheading;

          const mItems = sec.mission.cards || sec.mission.pillars;
          if (Array.isArray(mItems)) {
            const cards = mis.querySelectorAll('.mission-pillar, .mission-card');
            mItems.forEach((pil, idx) => {
              const card = cards[idx];
              if (!card) return;
              const h3 = card.querySelector('h3');
              if (h3 && pil.title) h3.textContent = pil.title;
              const desc = card.querySelector('p');
              if (desc && pil.description) desc.textContent = pil.description;
            });
          }
        }
      }

      if (sec['what-we-do']) {
        const wwd = document.getElementById('what-we-do');
        if (wwd) {
          const eye = wwd.querySelector('.eyebrow');
          if (eye && sec['what-we-do'].eyebrow) eye.textContent = sec['what-we-do'].eyebrow;
          const h2 = wwd.querySelector('.display-lg, h2');
          if (h2 && sec['what-we-do'].heading) h2.textContent = sec['what-we-do'].heading;
          const p = wwd.querySelector('.section-header-center p, .section-header p');
          if (p && (sec['what-we-do'].subheading || sec['what-we-do'].description)) {
            p.textContent = sec['what-we-do'].subheading || sec['what-we-do'].description;
          }
          const wItems = sec['what-we-do'].cards || sec['what-we-do'].items;
          if (Array.isArray(wItems)) {
            const cards = wwd.querySelectorAll('.wwd-card, .feature-card, .card');
            wItems.forEach((item, idx) => {
              const card = cards[idx];
              if (!card) return;
              const h3 = card.querySelector('h3');
              if (h3 && item.title) h3.textContent = item.title;
              const desc = card.querySelector('p');
              if (desc && item.description) desc.textContent = item.description;
            });
          }
        }
      }

      if (sec.values) {
        const valSec = document.getElementById('values');
        if (valSec) {
          const eye = valSec.querySelector('.eyebrow');
          if (eye && sec.values.eyebrow) eye.textContent = sec.values.eyebrow;
          const h2 = valSec.querySelector('.display-lg, h2');
          if (h2 && sec.values.heading) h2.textContent = sec.values.heading;
          const p = valSec.querySelector('.section-header-center p, .section-header p');
          if (p && (sec.values.subheading || sec.values.description)) {
            p.textContent = sec.values.subheading || sec.values.description;
          }
          const vItems = sec.values.cards || sec.values.items;
          if (Array.isArray(vItems)) {
            const cards = valSec.querySelectorAll('.value-card, .card');
            vItems.forEach((item, idx) => {
              const card = cards[idx];
              if (!card) return;
              const h3 = card.querySelector('h3');
              if (h3 && item.title) h3.textContent = item.title;
              const desc = card.querySelector('p');
              if (desc && item.description) desc.textContent = item.description;
            });
          }
        }
      }

      if (sec.company) {
        const comp = document.getElementById('company');
        if (comp) {
          const eye = comp.querySelector('.eyebrow');
          if (eye && sec.company.eyebrow) eye.textContent = sec.company.eyebrow;
          const h2 = comp.querySelector('.display-lg, h2');
          if (h2 && sec.company.heading) h2.textContent = sec.company.heading;
          const desc = comp.querySelector('.gurmitraa-content .body-lg');
          if (desc && sec.company.description) desc.textContent = sec.company.description;
        }
      }

      if (sec['about-final-cta']) {
        const cta = document.getElementById('about-final-cta') || document.querySelector('.about-final-cta');
        if (cta) {
          const h2 = cta.querySelector('h2');
          if (h2 && sec['about-final-cta'].heading) h2.textContent = sec['about-final-cta'].heading;

          const p = cta.querySelector('p.body-lg, p');
          const sub = sec['about-final-cta'].description || sec['about-final-cta'].subheading || sec['about-final-cta'].desc;
          if (p && sub) p.textContent = sub;

          const btn1 = cta.querySelector('.btn-primary');
          if (btn1 && sec['about-final-cta'].btnPrimary) setButtonLabelAndHref(btn1, sec['about-final-cta'].btnPrimary);
          const btn2 = cta.querySelector('.btn-secondary, .btn-outline');
          if (btn2 && sec['about-final-cta'].btnSecondary) setButtonLabelAndHref(btn2, sec['about-final-cta'].btnSecondary);
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PARTNER PAGE HYDRATION
    // ──────────────────────────────────────────────────────────────────────────
    else if (pageKey === 'partner') {
      if (sec['partner-hero']) {
        const ph = document.getElementById('partner-hero') || document.querySelector('.partner-hero');
        if (ph) {
          const eye = ph.querySelector('.eyebrow');
          if (eye && sec['partner-hero'].eyebrow) eye.textContent = sec['partner-hero'].eyebrow;

          const h1 = ph.querySelector('h1');
          if (h1 && sec['partner-hero'].heading) h1.textContent = sec['partner-hero'].heading;

          const sub = ph.querySelector('.partner-hero-sub, .partner-hero-text .body-lg');
          const subTxt = sec['partner-hero'].description || sec['partner-hero'].subheading;
          if (sub && subTxt) sub.textContent = subTxt;

          const bg = ph.querySelector('.partner-hero-bg img, img');
          if (bg && sec['partner-hero'].bgImage) {
            bg.src = sec['partner-hero'].bgImage;
            bg.style.opacity = '1';
          }

          const btn1 = document.getElementById('partner-hero-btn-primary') || ph.querySelector('.partner-hero-actions .btn-primary');
          if (btn1 && sec['partner-hero'].btnPrimary) setButtonLabelAndHref(btn1, sec['partner-hero'].btnPrimary);

          const btn2 = document.getElementById('partner-hero-btn-secondary') || ph.querySelector('.partner-hero-actions .btn-secondary');
          if (btn2 && sec['partner-hero'].btnSecondary) setButtonLabelAndHref(btn2, sec['partner-hero'].btnSecondary);
        }
      }

      // Section 1: Vendor / Sweet Maker Partnership (Android + iOS)
      if (sec['vendor-partnership']) {
        const vp = document.getElementById('vendor-partnership');
        const vConf = sec['vendor-partnership'];
        if (vp) {
          const isVisible = vConf.enabled !== false && vConf.visible !== false && vConf.active !== false;
          vp.style.display = isVisible ? '' : 'none';

          const eyeEl = vp.querySelector('.eyebrow');
          if (eyeEl && vConf.eyebrow) eyeEl.textContent = vConf.eyebrow;

          const titleEl = document.getElementById('vendor-partnership-title') || vp.querySelector('.partner-split-title, h2');
          if (titleEl && vConf.heading) titleEl.textContent = vConf.heading;

          const descEl = document.getElementById('vendor-partnership-desc') || vp.querySelector('.partner-split-desc');
          if (descEl && vConf.description) descEl.textContent = vConf.description;

          const imgEl = document.getElementById('vendor-partnership-img') || vp.querySelector('.partner-split-img, img');
          if (imgEl && vConf.image) imgEl.src = vConf.image;

          if (Array.isArray(vConf.features) && vConf.features.length > 0) {
            const featList = document.getElementById('vendor-partnership-features') || vp.querySelector('.partner-feature-list');
            if (featList) {
              featList.innerHTML = vConf.features.map(f => `
                <li>
                  <span class="partner-feature-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>
                  <span>${escapeHtml(f)}</span>
                </li>
              `).join('');
            }
          }

          const playBtn = document.getElementById('vendor-play-btn') || vp.querySelector('[data-play-store]');
          const playUrl = vConf.googlePlayUrl || vConf.playStoreUrl || cmsData?.global?.vendorPlayStoreUrl || cmsData?.global?.playStoreUrl;
          if (playBtn && playUrl) {
            playBtn.href = playUrl;
            playBtn.setAttribute('data-custom-url', playUrl);
          }
          const playLabel = document.getElementById('vendor-play-label');
          if (playLabel && vConf.playStoreLabel) playLabel.textContent = vConf.playStoreLabel;

          const appleBtn = document.getElementById('vendor-apple-btn') || vp.querySelector('[data-app-store]');
          const appleUrl = vConf.appStoreUrl || cmsData?.global?.vendorAppStoreUrl || cmsData?.global?.appStoreUrl;
          if (appleBtn && appleUrl) {
            appleBtn.href = appleUrl;
            appleBtn.setAttribute('data-custom-url', appleUrl);
          }
          const appleLabel = document.getElementById('vendor-apple-label');
          if (appleLabel && vConf.appStoreLabel) appleLabel.textContent = vConf.appStoreLabel;

          const regBtn = document.getElementById('vendor-register-btn') || vp.querySelector('.partner-register-btn');
          const regUrl = vConf.registerBtnUrl || vConf.ctaHref;
          const regTxt = vConf.registerBtnText || vConf.ctaLabel;
          if (regBtn && regUrl) regBtn.href = regUrl;
          const regLabel = document.getElementById('vendor-register-label');
          if (regLabel && regTxt) regLabel.textContent = regTxt;
          else if (regBtn && regTxt) setButtonLabelAndHref(regBtn, { text: regTxt, href: regUrl });
        }
      }

      // Section 2: Delivery Partner (ANDROID ONLY — NO iOS)
      if (sec['delivery-partnership']) {
        const dp = document.getElementById('delivery-partnership');
        const dConf = sec['delivery-partnership'];
        if (dp) {
          const isVisible = dConf.enabled !== false && dConf.visible !== false && dConf.active !== false;
          dp.style.display = isVisible ? '' : 'none';

          const eyeEl = dp.querySelector('.eyebrow');
          if (eyeEl && dConf.eyebrow) eyeEl.textContent = dConf.eyebrow;

          const titleEl = document.getElementById('delivery-partnership-title') || dp.querySelector('.partner-split-title, h2');
          if (titleEl && dConf.heading) titleEl.textContent = dConf.heading;

          const descEl = document.getElementById('delivery-partnership-desc') || dp.querySelector('.partner-split-desc');
          if (descEl && dConf.description) descEl.textContent = dConf.description;

          const imgEl = document.getElementById('delivery-partnership-img') || dp.querySelector('.partner-split-img, img');
          if (imgEl && dConf.image) imgEl.src = dConf.image;

          if (Array.isArray(dConf.features) && dConf.features.length > 0) {
            const featList = document.getElementById('delivery-partnership-features') || dp.querySelector('.partner-feature-list');
            if (featList) {
              featList.innerHTML = dConf.features.map(f => `
                <li>
                  <span class="partner-feature-check partner-feature-check--green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>
                  <span>${escapeHtml(f)}</span>
                </li>
              `).join('');
            }
          }

          const playBtn = document.getElementById('delivery-play-btn') || dp.querySelector('[data-play-store]');
          const playUrl = dConf.googlePlayUrl || dConf.playStoreUrl || cmsData?.global?.deliveryPlayStoreUrl || cmsData?.global?.playStoreUrl;
          if (playBtn && playUrl) {
            playBtn.href = playUrl;
            playBtn.setAttribute('data-custom-url', playUrl);
          }
          const playLabel = document.getElementById('delivery-play-label') || dp.querySelector('#delivery-play-btn .store-btn-main');
          const androidTxt = dConf.androidAppText || dConf.playStoreLabel;
          if (playLabel && androidTxt) playLabel.textContent = androidTxt;

          // Guarantee ANDROID ONLY: never allow an iOS button inside #delivery-partnership
          dp.querySelectorAll('[data-app-store], .apple-store-btn, .partner-store-btn--apple, [data-custom-app="delivery-apple"]').forEach(el => el.remove());

          const regBtn = document.getElementById('delivery-register-btn') || dp.querySelector('.partner-register-btn');
          const regUrl = dConf.registerBtnUrl || dConf.ctaHref;
          const regTxt = dConf.registerBtnText || dConf.ctaLabel;
          if (regBtn && regUrl) regBtn.href = regUrl;
          const regLabel = document.getElementById('delivery-register-label');
          if (regLabel && regTxt) regLabel.textContent = regTxt;
          else if (regBtn && regTxt) setButtonLabelAndHref(regBtn, { text: regTxt, href: regUrl });
        }
      }

      if (sec['why-partner']) {
        const wp = document.getElementById('why-partner');
        if (wp) {
          const eye = wp.querySelector('.eyebrow');
          if (eye && sec['why-partner'].eyebrow) eye.textContent = sec['why-partner'].eyebrow;

          const h2 = wp.querySelector('.display-lg, h2');
          if (h2 && sec['why-partner'].heading) h2.textContent = sec['why-partner'].heading;

          const sub = wp.querySelector('.section-header .body-lg');
          if (sub && (sec['why-partner'].subheading || sec['why-partner'].description)) {
            sub.textContent = sec['why-partner'].subheading || sec['why-partner'].description;
          }

          const wpItems = sec['why-partner'].cards || sec['why-partner'].items;
          if (Array.isArray(wpItems)) {
            const cards = wp.querySelectorAll('.why-card');
            wpItems.forEach((item, idx) => {
              const card = cards[idx];
              if (!card) return;
              const h3 = card.querySelector('h3');
              if (h3 && item.title) h3.textContent = item.title;
              const p = card.querySelector('p');
              if (p && item.description) p.textContent = item.description;
            });
          }
        }
      }

      if (sec['how-it-works']) {
        const hiw = document.getElementById('how-it-works');
        if (hiw) {
          const eye = hiw.querySelector('.eyebrow');
          if (eye && sec['how-it-works'].eyebrow) eye.textContent = sec['how-it-works'].eyebrow;
          const h2 = hiw.querySelector('.display-lg, h2');
          if (h2 && sec['how-it-works'].heading) h2.textContent = sec['how-it-works'].heading;
          if (Array.isArray(sec['how-it-works'].steps)) {
            const steps = hiw.querySelectorAll('.partnership-step');
            sec['how-it-works'].steps.forEach((st, idx) => {
              const step = steps[idx];
              if (!step) return;
              const num = step.querySelector('.pstep-num');
              if (num && st.number) num.textContent = st.number;
              const h3 = step.querySelector('h3');
              if (h3 && st.title) h3.textContent = st.title;
              const p = step.querySelector('p');
              if (p && st.description) p.textContent = st.description;
            });
          }
        }
      }

      if (sec['who-can']) {
        const wc = document.getElementById('who-can') || document.querySelector('.who-can-section');
        if (wc) {
          const eye = wc.querySelector('.eyebrow');
          if (eye && sec['who-can'].eyebrow) eye.textContent = sec['who-can'].eyebrow;
          const h2 = wc.querySelector('.display-lg, h2');
          if (h2 && sec['who-can'].heading) h2.textContent = sec['who-can'].heading;
          const sub = wc.querySelector('.section-header .body-lg');
          if (sub && (sec['who-can'].subheading || sec['who-can'].description)) {
            sub.textContent = sec['who-can'].subheading || sec['who-can'].description;
          }
          const wcItems = sec['who-can'].cards || sec['who-can'].items;
          if (Array.isArray(wcItems)) {
            const cards = wc.querySelectorAll('.who-card');
            wcItems.forEach((item, idx) => {
              const card = cards[idx];
              if (!card) return;
              const h3 = card.querySelector('h3');
              if (h3 && item.title) h3.textContent = item.title;
              const p = card.querySelector('p');
              if (p && item.description) p.textContent = item.description;
            });
          }
        }
      }

      if (sec['partner-form']) {
        const pf = document.getElementById('partner-form');
        if (pf) {
          const eye = pf.querySelector('.eyebrow');
          if (eye && sec['partner-form'].eyebrow) eye.textContent = sec['partner-form'].eyebrow;

          const h2 = pf.querySelector('.display-md, .display-lg, h2');
          if (h2 && sec['partner-form'].heading) h2.textContent = sec['partner-form'].heading;

          const desc = pf.querySelector('.partner-form-left .body-base');
          if (desc && sec['partner-form'].description) desc.textContent = sec['partner-form'].description;
        }
      }

      if (sec['partner-final-cta']) {
        const pfc = document.getElementById('partner-final-cta') || document.querySelector('.partner-final-cta');
        if (pfc) {
          const h2 = pfc.querySelector('h2');
          if (h2 && sec['partner-final-cta'].heading) h2.textContent = sec['partner-final-cta'].heading;
          const p = pfc.querySelector('p.body-lg, p');
          if (p && sec['partner-final-cta'].subheading) p.textContent = sec['partner-final-cta'].subheading;
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // CONTACT US PAGE HYDRATION
    // ──────────────────────────────────────────────────────────────────────────
    else if (pageKey === 'contact') {
      const cPage = pageData || data.pages?.contact || cmsData?.pages?.contact || {};
      const cSec = cPage.sections || sec || {};

      // 1. Contact Hero
      const heroSec = cSec['contact-hero'] || cSec.hero;
      if (heroSec) {
        const ch = document.querySelector('.contact-hero');
        if (ch) {
          if (heroSec.visible === false) {
            ch.style.display = 'none';
          } else {
            ch.style.display = '';
            const h1 = ch.querySelector('h1');
            if (h1 && heroSec.heading) {
              if (heroSec.heading.includes('<')) h1.innerHTML = heroSec.heading;
              else h1.innerHTML = heroSec.heading.replace(/help\.?/i, '<em>$&</em>');
            }
            const sub = ch.querySelector('.contact-hero-sub, p');
            if (sub && (heroSec.subheading || heroSec.description)) {
              sub.textContent = heroSec.subheading || heroSec.description;
            }
          }
        }
      }

      // 2. Direct Assistance Channels (6 Support Cards)
      const chanSec = cSec.channels;
      if (chanSec) {
        const headEl = document.getElementById('channels') || document.querySelector('.contact-section-head');
        if (headEl) {
          if (chanSec.visible === false) {
            headEl.style.display = 'none';
          } else {
            headEl.style.display = '';
            const eye = headEl.querySelector('.eyebrow');
            if (eye && chanSec.eyebrow) eye.textContent = chanSec.eyebrow;
            const h2 = headEl.querySelector('h2');
            if (h2 && chanSec.heading) h2.textContent = chanSec.heading;
            const p = headEl.querySelector('p:not(.eyebrow)');
            if (p && chanSec.subheading) p.textContent = chanSec.subheading;
          }
        }
        const gridEl = document.querySelector('.contact-channels-grid');
        if (gridEl && chanSec.visible === false) {
          gridEl.style.display = 'none';
        } else if (gridEl) {
          gridEl.style.display = '';
        }

        const channelItems = chanSec.items || chanSec.cards;
        if (Array.isArray(channelItems)) {
          const cards = document.querySelectorAll('.contact-card');
          channelItems.forEach((c, idx) => {
            const el = cards[idx];
            if (!el || !c) return;

            // Badge
            let badgeEl = el.querySelector('.contact-card-badge');
            if (c.badge && c.badge.trim()) {
              if (!badgeEl) {
                badgeEl = document.createElement('span');
                badgeEl.className = 'contact-card-badge';
                el.insertBefore(badgeEl, el.firstChild);
              }
              badgeEl.textContent = c.badge;
              badgeEl.style.display = '';
            } else if (badgeEl) {
              badgeEl.style.display = 'none';
            }

            // Title
            const h3 = el.querySelector('h3');
            if (h3 && c.title) h3.textContent = c.title;

            // Description
            const p = el.querySelector('p');
            if (p && (c.description || c.desc)) p.textContent = c.description || c.desc;

            // Action
            const action = el.querySelector('.contact-card-action');
            if (action) {
              const actText = c.actionText || c.action || c.email || c.phone;
              const actUrl = c.actionUrl || (actText && actText.includes('@') ? `mailto:${actText}` : (actText && actText.startsWith('+') ? `tel:${actText.replace(/\s+/g, '')}` : (c.email ? `mailto:${c.email}` : '')));
              const span = action.querySelector('span');
              if (span && actText) span.textContent = actText;
              if (actUrl) action.href = actUrl;
            }
          });
        }
      }

      // 3. Dual Support Panels (Orders & Vendors)
      const dualSec = cSec.supportPanels;
      if (dualSec) {
        const dualGrid = document.querySelector('.support-dual-grid');
        if (dualGrid) {
          if (dualSec.visible === false) {
            dualGrid.style.display = 'none';
          } else {
            dualGrid.style.display = '';
            const panels = dualGrid.querySelectorAll('.support-panel');

            // Panel 1: Order Help
            if (panels[0] && dualSec.orderHelp) {
              const o = dualSec.orderHelp;
              const badge = panels[0].querySelector('.support-panel-header span');
              if (badge && o.badge) badge.textContent = o.badge;
              const h3 = panels[0].querySelector('.support-panel-header h3');
              if (h3 && o.title) h3.textContent = o.title;
              const ps = panels[0].querySelectorAll('p');
              if (ps[0] && o.p1) ps[0].innerHTML = o.p1;
              if (ps[1] && o.p2) ps[1].innerHTML = o.p2;
              const tip = panels[0].querySelector('.support-highlight-box');
              if (tip && o.tip) tip.innerHTML = o.tip;
            }

            // Panel 2: Vendor Onboarding
            if (panels[1] && dualSec.vendorOnboarding) {
              const v = dualSec.vendorOnboarding;
              const badge = panels[1].querySelector('.support-panel-header span');
              if (badge && v.badge) badge.textContent = v.badge;
              const h3 = panels[1].querySelector('.support-panel-header h3');
              if (h3 && v.title) h3.textContent = v.title;
              const ps = panels[1].querySelectorAll('p');
              if (ps[0] && v.p1) ps[0].innerHTML = v.p1;
              if (ps[1] && v.p2) ps[1].innerHTML = v.p2;
              const btn = panels[1].querySelector('.support-panel-cta a');
              if (btn) {
                if (v.btnText) {
                  const svg = btn.querySelector('svg');
                  btn.innerHTML = `${escapeHtml(v.btnText)} `;
                  if (svg) btn.appendChild(svg);
                }
                if (v.btnLink) btn.href = v.btnLink;
              }
            }
          }
        }
      }

      // 4. Food Safety Advisory
      const safetySec = cSec.foodSafety;
      if (safetySec) {
        const safetyPanel = document.querySelector('.support-panel[style*="border-left"]');
        if (safetyPanel) {
          if (safetySec.visible === false) {
            safetyPanel.style.display = 'none';
          } else {
            safetyPanel.style.display = '';
            const badge = safetyPanel.querySelector('.support-panel-header span');
            if (badge && safetySec.badge) badge.textContent = safetySec.badge;
            const h3 = safetyPanel.querySelector('.support-panel-header h3');
            if (h3 && safetySec.title) h3.textContent = safetySec.title;
            const p = safetyPanel.querySelector('p');
            if (p && safetySec.description) p.innerHTML = safetySec.description;
            const adv = safetyPanel.querySelector('.support-highlight-box');
            if (adv && safetySec.advisory) adv.innerHTML = safetySec.advisory;
          }
        }
      }

      // 5. Complaint Escalation Section
      const escSec = cSec.escalation;
      if (escSec) {
        const escWrap = document.querySelector('.escalation-section');
        if (escWrap) {
          if (escSec.visible === false) {
            escWrap.style.display = 'none';
          } else {
            escWrap.style.display = '';
            const eye = escWrap.querySelector('.eyebrow');
            if (eye && escSec.eyebrow) eye.textContent = escSec.eyebrow;
            const h2 = escWrap.querySelector('h2');
            if (h2 && escSec.heading) h2.textContent = escSec.heading;
            const sub = escWrap.querySelector('.contact-section-head p:not(.eyebrow)');
            if (sub && escSec.subheading) sub.textContent = escSec.subheading;

            if (Array.isArray(escSec.steps)) {
              const stepEls = escWrap.querySelectorAll('.escalation-step');
              escSec.steps.forEach((st, sIdx) => {
                const sEl = stepEls[sIdx];
                if (!sEl || !st) return;
                const b = sEl.querySelector('.escalation-step-badge');
                if (b && st.step) b.textContent = st.step;
                const h4 = sEl.querySelector('h4');
                if (h4 && st.title) h4.textContent = st.title;
                const p = sEl.querySelector('p');
                if (p && st.description) p.innerHTML = st.description;
              });
            }
          }
        }
      }

      // 6. Grievance Officer Card (#grievance)
      const grievDoc = cSec.grievance || data.legalDocuments?.grievance || cmsData?.legalDocuments?.grievance;
      if (grievDoc) {
        const gCard = document.getElementById('grievance');
        if (gCard) {
          const isGrievActive = grievDoc.active !== false && grievDoc.enabled !== false && grievDoc.visible !== false;
          gCard.style.display = isGrievActive ? '' : 'none';
          const h3 = gCard.querySelector('h3');
          if (h3 && grievDoc.title) {
            const svg = h3.querySelector('svg');
            h3.innerHTML = '';
            if (svg) h3.appendChild(svg);
            h3.appendChild(document.createTextNode(' ' + grievDoc.title));
          }
          const intro = gCard.querySelector('.info-card-intro');
          if (intro && grievDoc.intro) intro.textContent = grievDoc.intro;

          const rows = gCard.querySelectorAll('.info-row .info-value');
          if (rows[0] && grievDoc.officerName) {
            rows[0].innerHTML = `<strong>${escapeHtml(grievDoc.officerName)}</strong>${grievDoc.designation ? ` [${escapeHtml(grievDoc.designation)}]` : ''}`;
          }
          if (rows[1] && grievDoc.companyName) {
            const note = grievDoc.companyNote || '(Parent company of MITTAI BANDI)';
            rows[1].innerHTML = `${escapeHtml(grievDoc.companyName)}<br /><small style="color:#8A747F;">${escapeHtml(note)}</small>`;
          }
          if (rows[2] && grievDoc.address) {
            rows[2].textContent = grievDoc.address;
          }
          const emailVal = grievDoc.email || grievDoc.officerEmail;
          if (rows[3] && emailVal) {
            rows[3].innerHTML = `<a href="mailto:${escapeHtml(emailVal)}">${escapeHtml(emailVal)}</a>`;
          }
          const phoneVal = grievDoc.phone || grievDoc.officerPhone;
          if (rows[4] && phoneVal) {
            const cleanPh = phoneVal.replace(/\s+/g, '');
            rows[4].innerHTML = `<a href="tel:${escapeHtml(cleanPh)}">${escapeHtml(phoneVal)}</a>`;
          }
          if (rows[5] && grievDoc.hours) {
            rows[5].textContent = grievDoc.hours;
          }
        }
      }

      // 7. Registered Office Card (Corporate Details + FSSAI NUMBER)
      const corpDoc = cSec.corporate || data.global?.corporate || cmsData?.global?.corporate;
      if (corpDoc) {
        const corpCard = document.querySelector('.info-card:not(#grievance)');
        if (corpCard) {
          const isCorpActive = corpDoc.active !== false && corpDoc.enabled !== false && corpDoc.visible !== false;
          corpCard.style.display = isCorpActive ? '' : 'none';
          const h3 = corpCard.querySelector('h3');
          if (h3 && corpDoc.title) {
            const svg = h3.querySelector('svg');
            corpCard.querySelector('h3').innerHTML = '';
            if (svg) h3.appendChild(svg);
            h3.appendChild(document.createTextNode(' ' + corpDoc.title));
          }
          const intro = corpCard.querySelector('.info-card-intro');
          if (intro && corpDoc.intro) intro.textContent = corpDoc.intro;

          corpCard.querySelectorAll('.info-row').forEach(row => {
            const lbl = row.querySelector('.info-label')?.textContent.trim().toLowerCase() || '';
            const val = row.querySelector('.info-value');
            if (!val) return;

            if (lbl.includes('entity') && corpDoc.entityName) {
              const note = corpDoc.parentNote || '(Parent company of MITTAI BANDI)';
              val.innerHTML = `<strong>${escapeHtml(corpDoc.entityName)}</strong><br /><small style="color:#8A747F;">${escapeHtml(note)}</small>`;
            } else if (lbl.includes('cin') && corpDoc.cin) {
              val.innerHTML = `<code id="corporate-cin-val">${escapeHtml(corpDoc.cin)}</code>`;
            } else if (lbl.includes('fssai')) {
              const fssaiVal = corpDoc.fssai || corpDoc.fssaiNumber || '10125018000861';
              val.innerHTML = `<code id="corporate-fssai-val">${escapeHtml(fssaiVal)}</code>`;
            } else if (lbl.includes('address') && corpDoc.address) {
              val.textContent = corpDoc.address;
            } else if (lbl.includes('website')) {
              const url = corpDoc.websiteUrl || 'https://www.mittaibandi.com';
              const lblText = corpDoc.websiteLabel || 'www.mittaibandi.com';
              val.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lblText)}</a>`;
            } else if (lbl.includes('contact') && corpDoc.email) {
              val.innerHTML = `<a href="mailto:${escapeHtml(corpDoc.email)}">${escapeHtml(corpDoc.email)}</a>`;
            }
          });

          const noteEl = corpCard.querySelector('.info-note');
          if (noteEl && corpDoc.notice) {
            noteEl.innerHTML = corpDoc.notice;
          }
        }
      }

      // 8. Security Warning Box
      const secAlert = cSec.securityAlert;
      if (secAlert) {
        const alertBox = document.querySelector('.security-alert-box');
        if (alertBox) {
          if (secAlert.visible === false) {
            alertBox.style.display = 'none';
          } else {
            alertBox.style.display = '';
            const h3 = alertBox.querySelector('h3');
            if (h3 && secAlert.title) h3.textContent = secAlert.title;
            const p = alertBox.querySelector('p');
            if (p && secAlert.message) p.innerHTML = secAlert.message;
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // LEGAL / POLICY PAGES HYDRATION (Privacy, Terms, Refund, API)
    // ──────────────────────────────────────────────────────────────────────────
    else if (['privacy', 'terms', 'refund', 'api'].includes(pageKey)) {
      const legalDoc = cmsData?.legalDocuments?.[pageKey] || {};
      const heroSec = pageData?.sections?.hero || pageData || {};
      const legalHero = document.querySelector('.legal-hero');
      const legalArticle = document.querySelector('article.legal-content, .legal-body');

      if (legalDoc.active === false || heroSec.active === false) {
        if (legalHero) {
          const sub = legalHero.querySelector('p');
          if (sub) sub.textContent = 'This policy document is currently inactive.';
          const badge = legalHero.querySelector('.legal-meta-badge');
          if (badge) badge.style.display = 'none';
        }
        if (legalArticle) {
          legalArticle.innerHTML = `
            <div class="legal-callout" style="text-align:center; padding: 3.5rem 1.5rem; background:#FFFFFF; border:1.5px solid #EEEEEE; border-radius:18px; box-shadow:0 8px 24px rgba(0,0,0,0.04); margin: 2rem 0;">
              <div style="font-size:2.5rem; margin-bottom:1rem;">📄</div>
              <h2 style="font-size:1.5rem; color:#252525; margin-bottom:0.75rem; font-weight:700;">Policy Document Unavailable</h2>
              <p style="color:#666666; max-width:520px; margin:0 auto 1.5rem; line-height:1.6;">This policy document is currently inactive or being updated. Please check back shortly or return to our homepage.</p>
              <a href="index.html" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.5rem; padding:0.75rem 1.75rem; border-radius:50px; background:#E60046; color:#FFFFFF; text-decoration:none; font-weight:600;">Return to Home</a>
            </div>
          `;
        }
        return;
      }

      if (legalHero) {
        const effDate = legalDoc.effectiveDate || heroSec.effectiveDate || pageData?.effectiveDate;
        if (effDate) {
          const badge = legalHero.querySelector('.legal-meta-badge');
          if (badge) {
            badge.textContent = effDate.toLowerCase().includes('updated') || effDate.toLowerCase().includes('effective')
              ? effDate
              : `Last Updated: ${effDate}`;
          }
        }
        const headingText = legalDoc.heading || legalDoc.title || heroSec.heading || pageData?.heading;
        if (headingText) {
          const h1 = legalHero.querySelector('h1');
          if (h1) h1.textContent = headingText;
        }
        const subText = legalDoc.subtitle || heroSec.subheading || pageData?.subtitle;
        if (subText) {
          const p = legalHero.querySelector('p');
          if (p) p.textContent = subText;
        }
      }

      const fullHtml = legalDoc.content || pageData?.content || heroSec.contentHtml;
      if (legalArticle && fullHtml && fullHtml.trim().length > 20) {
        legalArticle.innerHTML = fullHtml;
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 404 PAGE HYDRATION
    // ──────────────────────────────────────────────────────────────────────────
    else if (pageKey === '404' && pageData) {
      const h = pageData.sections?.hero || pageData;
      const code = document.querySelector('.error-code');
      if (code && h.errorCode) code.textContent = h.errorCode;

      const title = document.querySelector('.error-title');
      if (title && (h.heading || h.title)) title.textContent = h.heading || h.title;

      const desc = document.querySelector('.error-desc');
      if (desc && (h.description || h.subheading)) desc.textContent = h.description || h.subheading;

      const btn1 = document.querySelector('.error-btn-primary');
      if (btn1 && h.btnPrimary) {
        setButtonLabelAndHref(btn1, h.btnPrimary);
      } else if (btn1 && h.btnHomeText) {
        btn1.textContent = h.btnHomeText;
      }

      const btn2 = document.querySelector('.error-btn-secondary');
      if (btn2 && h.btnSecondary) {
        setButtonLabelAndHref(btn2, h.btnSecondary);
      } else if (btn2 && h.btnCategoriesText) {
        btn2.textContent = h.btnCategoriesText;
      }
    }
  }

  // ── Helper: Escape HTML strings ───────────────────────────────────────────
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Promotional Banners Carousel Hydration & Controller ───────────────────
  let _promoTimer = null;
  function hydratePromotionalBanners(promoConfig) {
    const section = document.getElementById('promo-carousel-section');
    if (!section) return; // Not on homepage

    const track = document.getElementById('promo-carousel-track');
    const dotsWrap = document.getElementById('promo-carousel-dots');
    const prevBtn = document.getElementById('promo-carousel-prev');
    const nextBtn = document.getElementById('promo-carousel-next');
    const viewport = document.getElementById('promo-carousel-viewport');
    if (!track) return;

    const settings = (promoConfig && !Array.isArray(promoConfig) && promoConfig.settings)
      ? promoConfig.settings
      : { enabled: true, autoSlide: true, intervalMs: 4500, pauseOnHover: true, showArrows: true, showDots: true };

    if (settings.enabled === false) {
      section.style.display = 'none';
      if (_promoTimer) {
        clearInterval(_promoTimer);
        _promoTimer = null;
      }
      return;
    }

    let bannerList = [];
    if (Array.isArray(promoConfig)) {
      bannerList = promoConfig;
    } else if (promoConfig && Array.isArray(promoConfig.items)) {
      bannerList = promoConfig.items;
    } else if (promoConfig && typeof promoConfig === 'object') {
      bannerList = Object.values(promoConfig).filter(b => b && typeof b === 'object' && (b.title || b.heading || b.campaignName || b.image));
    }
    const now = new Date();

    // Filter active & valid scheduled banners
    const activeBanners = bannerList.filter(item => {
      if (!item || item.active === false) return false;
      if (item.startDate) {
        const s = new Date(item.startDate);
        if (!isNaN(s) && now < s) return false;
      }
      if (item.endDate) {
        const e = new Date(item.endDate);
        if (!isNaN(e) && now > e) return false;
      }
      return true;
    }).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    // Empty state handling: gracefully hide section without empty whitespace
    if (activeBanners.length === 0) {
      section.style.display = 'none';
      if (_promoTimer) {
        clearInterval(_promoTimer);
        _promoTimer = null;
      }
      return;
    }

    section.style.display = '';
    const isMobile = window.innerWidth <= 768;

    // Prevent unnecessary carousel re-render & flicker if banner data is identical
    const bannerSig = JSON.stringify({
      isMobile,
      items: activeBanners.map(b => [
        b.id, b.badge, b.subtitle, b.heading, b.title, b.description,
        b.image, b.mobileImage, b.ctaPrimaryText, b.btnPrimary?.text,
        b.ctaPrimaryUrl, b.btnPrimary?.url, b.ctaSecondaryText,
        b.btnSecondary?.text, b.ctaSecondaryUrl, b.btnSecondary?.url,
        b.btnSecondary?.visible, b.order
      ])
    });
    if (track.dataset.bannerSig === bannerSig && track.children.length === activeBanners.length) {
      return;
    }
    track.dataset.bannerSig = bannerSig;

    // Render slides into track
    track.innerHTML = activeBanners.map((banner, index) => {
      const badge = banner.badge || banner.subtitle || 'PROMOTION';
      const title = banner.heading || banner.title || '';
      const desc = banner.description || '';
      const img = (isMobile && banner.mobileImage) ? banner.mobileImage : (banner.image || 'assets/images/wedding_sweets.png');
      const pText = banner.ctaPrimaryText || banner.btnPrimary?.text || 'Explore Collection';
      const pUrl = banner.ctaPrimaryUrl || banner.btnPrimary?.url || 'index.html#categories';
      const sText = banner.ctaSecondaryText || banner.btnSecondary?.text || '';
      const sUrl = banner.ctaSecondaryUrl || banner.btnSecondary?.url || '#';
      const hasSec = Boolean(sText && (banner.btnSecondary?.visible !== false));

      return `
        <article class="promo-banner-slide ${index === 0 ? 'active' : ''}" data-banner-id="${escapeHtml(banner.id || index)}" role="group" aria-roledescription="slide" aria-label="${index + 1} of ${activeBanners.length}">
          <div class="promo-banner-card">
            <div class="promo-banner-content">
              <div class="promo-banner-badge-wrap">
                <span class="promo-banner-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
                  ${escapeHtml(badge)}
                </span>
              </div>
              <h2 class="promo-banner-title">${escapeHtml(title)}</h2>
              <p class="promo-banner-description">${escapeHtml(desc)}</p>
              <div class="promo-banner-actions">
                <a href="${escapeHtml(pUrl)}" class="btn btn-primary promo-btn-primary">
                  ${escapeHtml(pText)}
                </a>
                ${hasSec ? `
                  <a href="${escapeHtml(sUrl)}" class="btn btn-outline promo-btn-secondary">
                    ${escapeHtml(sText)}
                  </a>
                ` : ''}
              </div>
            </div>
            <div class="promo-banner-media">
              <div class="promo-banner-img-wrap">
                <img src="${escapeHtml(img)}" alt="${escapeHtml(banner.title || title)}" class="promo-banner-img" loading="${index === 0 ? 'eager' : 'lazy'}" />
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Render pagination dots
    if (dotsWrap) {
      if (activeBanners.length > 1 && settings.showDots !== false) {
        dotsWrap.style.display = 'flex';
        dotsWrap.innerHTML = activeBanners.map((_, i) => `
          <button class="promo-carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}" role="tab" aria-selected="${i === 0}" aria-label="Go to banner ${i + 1}"></button>
        `).join('');
      } else {
        dotsWrap.style.display = 'none';
        dotsWrap.innerHTML = '';
      }
    }

    // Toggle navigation arrows visibility based on banner count
    if (prevBtn && nextBtn) {
      const showArrows = activeBanners.length > 1 && settings.showArrows !== false;
      prevBtn.style.display = showArrows ? 'flex' : 'none';
      nextBtn.style.display = showArrows ? 'flex' : 'none';
    }

    // Carousel Controller State
    let currentIndex = 0;
    const totalSlides = activeBanners.length;

    function goToSlide(newIndex) {
      if (totalSlides <= 1) return;
      currentIndex = (newIndex + totalSlides) % totalSlides;
      track.style.transform = `translateX(-${currentIndex * 100}%)`;

      const slides = track.querySelectorAll('.promo-banner-slide');
      slides.forEach((slide, idx) => {
        slide.classList.toggle('active', idx === currentIndex);
      });

      if (dotsWrap) {
        const dots = dotsWrap.querySelectorAll('.promo-carousel-dot');
        dots.forEach((dot, idx) => {
          dot.classList.toggle('active', idx === currentIndex);
          dot.setAttribute('aria-selected', idx === currentIndex ? 'true' : 'false');
        });
      }
    }

    function startAutoplay() {
      if (totalSlides <= 1 || settings.autoSlide === false) return;
      stopAutoplay();
      _promoTimer = setInterval(() => {
        goToSlide(currentIndex + 1);
      }, Number(settings.intervalMs) || 4500);
    }

    function stopAutoplay() {
      if (_promoTimer) {
        clearInterval(_promoTimer);
        _promoTimer = null;
      }
    }

    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.preventDefault();
        goToSlide(currentIndex - 1);
        startAutoplay();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.preventDefault();
        goToSlide(currentIndex + 1);
        startAutoplay();
      };
    }

    if (dotsWrap) {
      dotsWrap.onclick = (e) => {
        const dot = e.target.closest('.promo-carousel-dot');
        if (dot && dot.dataset.index !== undefined) {
          e.preventDefault();
          goToSlide(parseInt(dot.dataset.index, 10));
          startAutoplay();
        }
      };
    }

    if (viewport) {
      if (settings.pauseOnHover !== false) {
        viewport.onmouseenter = stopAutoplay;
        viewport.onmouseleave = startAutoplay;
      }

      let touchStartX = 0;
      let touchEndX = 0;
      viewport.ontouchstart = (e) => {
        touchStartX = e.touches[0].clientX;
        stopAutoplay();
      };
      viewport.ontouchend = (e) => {
        touchEndX = e.changedTouches[0].clientX;
        const diff = touchStartX - touchEndX;
        if (diff > 45) {
          goToSlide(currentIndex + 1);
        } else if (diff < -45) {
          goToSlide(currentIndex - 1);
        }
        startAutoplay();
      };

      viewport.onkeydown = (e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          goToSlide(currentIndex - 1);
          startAutoplay();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          goToSlide(currentIndex + 1);
          startAutoplay();
        }
      };
    }

    goToSlide(0);
    startAutoplay();
  }

  // ── Full Page Hydration Routine ────────────────────────────────────────────
  function hydrateEverything(data) {
    if (!data) return;
    cmsData = data;

    // 1. Global Branding, Header & Footer
    applyGlobalTheme(data.theme || data.global?.theme);
    hydrateHeader(data);
    hydrateFooter(data);

    // 2. Page Specific
    const pageData = data.pages ? data.pages[pageId] : null;
    if (pageData) {
      applySEO(pageData.seo, data.global);
      reorderAndToggleSections(pageData);
      hydratePageContent(pageId, pageData, data);
    } else {
      applySEO(null, data.global);
    }

    // Hide inactive legal document tabs across any legal pages
    ['api', 'privacy', 'terms', 'refund'].forEach(docKey => {
      let isAct = true;
      if (docKey === 'api') isAct = data.legalDocuments?.api?.active !== false && data.pages?.api?.active !== false;
      if (docKey === 'privacy') isAct = data.legalDocuments?.privacy?.active !== false && data.pages?.privacy?.active !== false;
      if (docKey === 'terms') isAct = data.legalDocuments?.terms?.active !== false && data.pages?.terms?.active !== false;
      if (docKey === 'refund') isAct = data.legalDocuments?.refund?.active !== false && data.pages?.refund?.active !== false;

      if (!isAct) {
        const searchSlug = docKey === 'refund' ? 'cancellation' : (docKey + '-policy');
        document.querySelectorAll(`.legal-nav-tabs a[href*="${docKey}"], .legal-nav-tabs a[href*="${searchSlug}"], .legal-nav-tab[href*="${docKey}"], .legal-nav-tab[href*="${searchSlug}"]`).forEach(tab => {
          tab.style.display = 'none';
        });
      }
    });

    // 3. Promotional Banners (Homepage only)
    if (pageId === 'home') {
      const promoSource = data.promotionalBanners || window.MITTAI_DEFAULT_CMS?.promotionalBanners || [];
      hydratePromotionalBanners(promoSource);
    }
  }

  // ── Fetch Live Data from Firebase RTDB (Starts immediately in <head>) ────────
  async function fetchLiveCMS() {
    // When running in Preview mode, never overwrite draft preview with live RTDB data
    if (isPreviewRequest()) {
      try {
        const localDraft = localStorage.getItem(DRAFT_KEY) || localStorage.getItem('mittai_cms_draft_v1');
        if (localDraft) {
          const parsedDraft = JSON.parse(localDraft);
          cmsData = parsedDraft;
          if (isDomHydrated) hydrateEverything(parsedDraft);
          return parsedDraft;
        }
        const draftRes = await fetch(`${RTDB_BASE}/cms/draft.json`, { cache: 'no-store' });
        if (draftRes.ok) {
          const draftData = await draftRes.json();
          if (draftData && typeof draftData === 'object' && draftData.global) {
            cmsData = draftData;
            if (isDomHydrated) hydrateEverything(draftData);
            return draftData;
          }
        }
      } catch (e) {}
      return cmsData;
    }

    try {
      // 1. Fast lightweight metadata check (200 bytes) to validate local cache version
      const currentPub = cmsData?.meta?.lastPublished || cmsData?.meta?.lastPublishedAt || '';
      const currentVer = cmsData?.meta?.version || '';
      if (currentPub && currentVer) {
        const metaRes = await fetch(`${RTDB_BASE}/cms/live/meta.json`, { cache: 'no-store' });
        if (metaRes.ok) {
          const remoteMeta = await metaRes.json();
          const remotePub = remoteMeta?.lastPublished || remoteMeta?.lastPublishedAt || '';
          const remoteVer = remoteMeta?.version || '';
          if (remotePub && remotePub === currentPub && remoteVer === currentVer) {
            // Local cmsData is 100% identical to the latest published Firebase version!
            // Skip downloading full live.json and skip redundant DOM re-hydration.
            console.info('%c[MITTAI BANDI CMS] Cache verified current (v' + currentVer + ') [OK]', 'color:#168B32; font-weight:700;');
            return cmsData;
          }
        }
      }

      // 2. Newer version exists (or cold cache): fetch full authoritative live.json
      const response = await fetch(`${RTDB_BASE}/cms/live.json`, { cache: 'no-store' });
      if (response.ok) {
        const liveData = await response.json();
        if (liveData && typeof liveData === 'object' && liveData.global) {
          saveLiveToCache(liveData);
          cmsData = liveData;
          if (isDomHydrated) {
            hydrateEverything(liveData);
          }
          console.info('%c[MITTAI BANDI CMS] Live data synchronized from Firebase [OK]', 'color:#168B32; font-weight:700;');
          return liveData;
        }
      }
    } catch (err) {
      console.warn('[MITTAI BANDI CMS] Live fetch skipped (using cached/default):', err);
    }
    return cmsData;
  }

  // Start Firebase check immediately in <head> in parallel with HTML parsing
  const liveSyncPromise = fetchLiveCMS();

  // ── Initialize Execution ───────────────────────────────────────────────────
  const preloaderConf = cmsData?.preloader || cmsData?.global?.preloader;
  if (preloaderConf?.enabled !== false) {
    injectPreloader(preloaderConf);
  }

  if (cmsData?.theme || cmsData?.global?.theme) {
    applyGlobalTheme(cmsData.theme || cmsData.global?.theme);
  }

  async function onDomReady() {
    try {
      // Hydrate immediately with current cmsData while render gate is active
      hydrateEverything(cmsData);
      isDomHydrated = true;

      // Wait briefly (max 220ms) if liveSyncPromise is still in flight so brand-new cross-device publishes render before first paint
      await Promise.race([
        liveSyncPromise,
        new Promise(resolve => setTimeout(resolve, 220))
      ]);
    } catch (err) {
      console.error('[MITTAI BANDI CMS] Hydration error caught:', err);
    } finally {
      releaseRenderGate();
      liveSyncPromise.finally(() => {
        dismissPreloader(preloaderConf?.durationMs || preloaderConf?.minDuration || 1600);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
  } else {
    onDomReady();
  }

  // 4. Live Preview Bridge for Admin Dashboard iframe
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'MB_CMS_PREVIEW') {
      const draft = event.data.cmsData;
      if (draft) {
        console.info('[MITTAI BANDI CMS] Live preview payload received via postMessage');
        hydrateEverything(draft);
      }
    }
  });

  // Expose on window for diagnostics & testing
  window.MB_CMS = {
    getData: () => cmsData,
    hydrate: hydrateEverything,
    fetchLive: fetchLiveCMS
  };
})();

