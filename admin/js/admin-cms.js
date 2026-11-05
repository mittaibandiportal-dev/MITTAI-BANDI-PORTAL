/**
 * MITTAI BANDI  -  Centralized CMS Core Controller
 * Powered by GURMITRAA Technologies Pvt. Ltd.
 */

window.MB_CMS_ADMIN = (function () {
  'use strict';

  const RTDB_BASE = 'https://mittaibandi-portal-default-rtdb.asia-southeast1.firebasedatabase.app';
  const LIVE_URL = `${RTDB_BASE}/cms/live.json`;
  const DRAFT_URL = `${RTDB_BASE}/cms/draft.json`;
  const MEDIA_URL = `${RTDB_BASE}/cms/media.json`;
  const HISTORY_URL = `${RTDB_BASE}/cms/history.json`;

  // All Realtime Database calls in this module are routed through MB_AUTH.authFetch, which
  // attaches the signed-in admin's Firebase ID token. Database Security Rules verify the
  // token's `admin` custom claim server-side; requests without it are rejected.
  const fetch = (url, options) => {
    if (!window.MB_AUTH || typeof window.MB_AUTH.authFetch !== 'function') {
      return Promise.reject(new Error('Admin authentication is not initialized.'));
    }
    return window.MB_AUTH.authFetch(url, options);
  };

  // Application State
  let liveData = null;
  let draftData = null;
  let isDirty = false;
  let activeModule = 'dashboard';
  let activePageKey = 'home';
  let mediaLibrary = [];
  let formSubmissions = [];
  let auditLogs = [];
  let activeImagePickerCallback = null;

  // ── Toast Utility ──────────────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    let container = document.querySelector('.admin-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'admin-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `admin-toast ${type}`;
    const iconName = type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info';
    toast.innerHTML = `<span class="toast-icon-wrap"><i data-lucide="${iconName}"></i></span><span>${message}</span>`;
    container.appendChild(toast);

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 350);
    }, 3800);
  }

  // ── Audit History Logging ──────────────────────────────────────────────────
  async function logActivity(action, description) {
    const entry = {
      id: 'log-' + Date.now(),
      action,
      description,
      user: 'admin',
      timestamp: new Date().toISOString()
    };

    try {
      await fetch(HISTORY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      auditLogs.unshift(entry);
    } catch (e) {
      console.warn('[CMS Admin] Log post skipped:', e);
    }
  }

  // ── Database Initialization & Sync ─────────────────────────────────────────
  // ── Safe LocalStorage Persistence (Prevents QuotaExceededError & preserves all real images) ───
  function buildLeanStorageCopy(dataObj) {
    if (!dataObj) return null;
    const copy = JSON.parse(JSON.stringify(dataObj));
    // Omit admin media library history from localStorage copy (saves ~500KB+ while keeping all page/banner images)
    delete copy.media;
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

  function safeSaveLocal(type, dataObj) {
    if (!dataObj) return;
    const key = type === 'live' ? 'mb_cms_live' : 'mb_cms_draft';

    // Remove legacy duplicate keys that previously consumed 3x-4x of the 5MB localStorage quota
    try {
      localStorage.removeItem('mittai_cms_draft_v1');
      localStorage.removeItem('mittai_cms_live_v1');
      localStorage.removeItem('mb_media_library');
    } catch (e) {}

    const leanCopy = buildLeanStorageCopy(dataObj);
    const serialized = JSON.stringify(leanCopy);

    try {
      localStorage.setItem(key, serialized);
    } catch (e) {
      // If mb_cms_draft + mb_cms_live exceed 5MB, prioritize mb_cms_live so the public website never flashes old data
      try {
        if (type === 'live') {
          localStorage.removeItem('mb_cms_draft');
          localStorage.setItem(key, serialized);
        } else {
          // For draft, if live + draft exceed quota, draft remains in memory & Firebase RTDB
          localStorage.setItem(key, serialized);
        }
      } catch (e2) {
        // Full payload remains in memory (draftData/liveData) and syncs directly to Firebase RTDB
      }
    }
  }

  let autoDraftSaveTimer = null;
  function scheduleBackgroundDraftSync() {
    if (autoDraftSaveTimer) clearTimeout(autoDraftSaveTimer);
    autoDraftSaveTimer = setTimeout(async () => {
      if (!draftData) return;
      try {
        draftData.meta = draftData.meta || {};
        draftData.meta.lastDraftSaved = new Date().toISOString();
        draftData.media = mediaLibrary;
        await fetch(DRAFT_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draftData)
        });
      } catch (e) {
        console.warn('[CMS Admin] Background draft sync skipped:', e);
      }
    }, 900);
  }

  async function loadAllData() {
    try {
      // 1. Fetch Draft & Live in parallel
      const [draftRes, liveRes] = await Promise.all([
        fetch(DRAFT_URL).catch(() => null),
        fetch(LIVE_URL).catch(() => null)
      ]);

      if (draftRes && draftRes.ok) {
        draftData = await draftRes.json();
      }
      if (liveRes && liveRes.ok) {
        liveData = await liveRes.json();
      }

      // If draft or live is missing, fallback to window.MITTAI_DEFAULT_CMS
      const defCMS = window.MITTAI_DEFAULT_CMS || {};
      if (!draftData || !draftData.global) {
        draftData = JSON.parse(JSON.stringify(defCMS));
      }
      if (!liveData || !liveData.global) {
        liveData = JSON.parse(JSON.stringify(draftData));
      }

      // Normalize and synchronize schema across all CMS modules & live website
      function ensureCompleteSchema(target) {
        if (!target) return;
        target.global = Object.assign({}, JSON.parse(JSON.stringify(defCMS.global || {})), target.global || {});
        const g = target.global;

        // Sync Global Brand, Contact, Social & App Links aliases
        g.siteName = g.siteName || g.brandName || 'MITTAI BANDI';
        g.brandName = g.brandName || g.siteName || 'MITTAI BANDI';
        g.tagline = g.tagline || 'Traditional Taste';
        g.companyName = g.companyName || 'GURMITRAA Technologies Pvt. Ltd.';
        g.logo = g.logo || g.logoUrl || 'assets/images/logo.png';
        g.logoUrl = g.logoUrl || g.logo || 'assets/images/logo.png';
        g.logoAlt = g.logoAlt || g.officialLogoUrl || 'assets/images/logo-official.jpg';
        g.favicon = g.favicon || g.faviconUrl || 'assets/images/logo.png';
        g.faviconUrl = g.faviconUrl || g.favicon || 'assets/images/logo.png';

        g.contact = Object.assign({}, defCMS.global?.contact || {}, g.contact || {});
        g.contact.email = g.contact.email || g.email || 'mittaibandi@gmail.com';
        g.contact.phone = g.contact.phone || g.phone || '+91 94905 32121';
        g.contact.whatsapp = g.contact.whatsapp || g.whatsappNumber || '919490532121';
        g.contact.address = g.contact.address || g.address || 'GURMITRAA Technologies Pvt. Ltd., Rajahmundry, Andhra Pradesh, India';
        g.email = g.contact.email;
        g.phone = g.contact.phone;
        g.whatsappNumber = g.contact.whatsapp;
        g.address = g.contact.address;

        g.social = Object.assign({}, defCMS.global?.socialLinks || {}, g.socialLinks || {}, g.social || {});
        g.socialLinks = Object.assign({}, g.social);

        g.appLinks = Object.assign({}, defCMS.global?.appLinks || {}, g.appLinks || {});
        g.playStoreUrl = g.playStoreUrl || g.appLinks.playStoreUrl || 'https://play.google.com/store';
        g.appStoreUrl = g.appStoreUrl || g.appLinks.appStoreUrl || '#';
        g.appLinks.playStoreUrl = g.playStoreUrl;
        g.appLinks.appStoreUrl = g.appStoreUrl;

        // Sync Preloader (top-level and global.preloader)
        const mergedPreloader = Object.assign(
          {},
          JSON.parse(JSON.stringify(defCMS.preloader || {})),
          target.preloader || {},
          g.preloader || {}
        );
        mergedPreloader.title = mergedPreloader.title || mergedPreloader.brandTitle || 'MITTAI BANDI';
        mergedPreloader.brandTitle = mergedPreloader.title;
        mergedPreloader.subtitle = mergedPreloader.subtitle || mergedPreloader.tagline || "Let's Taste It ❤️";
        mergedPreloader.tagline = mergedPreloader.subtitle;
        mergedPreloader.logo = mergedPreloader.logo || mergedPreloader.logoUrl || 'assets/images/logo-official.jpg';
        mergedPreloader.logoUrl = mergedPreloader.logo;
        mergedPreloader.minDuration = mergedPreloader.minDuration || mergedPreloader.durationMs || 2600;
        mergedPreloader.durationMs = mergedPreloader.minDuration;
        mergedPreloader.accentColor = mergedPreloader.accentColor || mergedPreloader.accentRed || '#E60046';
        mergedPreloader.accentRed = mergedPreloader.accentColor;
        target.preloader = mergedPreloader;
        g.preloader = mergedPreloader;

        // Sync Theme (top-level and global.theme)
        const mergedTheme = Object.assign(
          {},
          JSON.parse(JSON.stringify(defCMS.theme || {})),
          target.theme || {},
          g.theme || {}
        );
        mergedTheme.colorPrimary = mergedTheme.colorPrimary || mergedTheme.primaryRed || '#E60046';
        mergedTheme.primaryRed = mergedTheme.colorPrimary;
        mergedTheme.colorPrimaryDark = mergedTheme.colorPrimaryDark || mergedTheme.primaryRedDark || '#C9003D';
        mergedTheme.primaryRedDark = mergedTheme.colorPrimaryDark;
        mergedTheme.colorSecondary = mergedTheme.colorSecondary || mergedTheme.accentGreen || '#16A34A';
        mergedTheme.accentGreen = mergedTheme.colorSecondary;
        mergedTheme.colorCream = mergedTheme.colorCream || mergedTheme.bgCream || '#FFFCFA';
        mergedTheme.bgCream = mergedTheme.colorCream;
        mergedTheme.colorLight = mergedTheme.colorLight || mergedTheme.bgWhite || '#FFFFFF';
        mergedTheme.bgWhite = mergedTheme.colorLight;
        mergedTheme.colorDark = (mergedTheme.colorDark && mergedTheme.colorDark !== '#14020B' && mergedTheme.colorDark !== '#16020D')
          ? mergedTheme.colorDark
          : (mergedTheme.textMain || '#252525');
        mergedTheme.textMain = mergedTheme.colorDark;
        target.theme = mergedTheme;
        g.theme = mergedTheme;

        // Sync Header & Navigation (top-level and global.header)
        const mergedHeader = Object.assign(
          {},
          JSON.parse(JSON.stringify(defCMS.header || {})),
          target.header || {},
          g.header || {}
        );
        mergedHeader.navLogoText = mergedHeader.navLogoText || mergedHeader.brandName || 'MITTAI BANDI';
        mergedHeader.brandName = mergedHeader.navLogoText;
        mergedHeader.navLogoTag = mergedHeader.navLogoTag || mergedHeader.brandSubtitle || 'Traditional Taste';
        mergedHeader.brandSubtitle = mergedHeader.navLogoTag;
        const rawNavLinks = (Array.isArray(mergedHeader.navLinks) && mergedHeader.navLinks.length)
          ? mergedHeader.navLinks
          : (Array.isArray(mergedHeader.links) && mergedHeader.links.length ? mergedHeader.links : (defCMS.header?.links || []));
        mergedHeader.navLinks = rawNavLinks.map((l, idx) => ({
          id: l.id || `nav-${idx + 1}`,
          label: l.label || 'Link',
          url: l.url || l.href || '#',
          href: l.href || l.url || '#',
          visible: l.visible !== false,
          order: l.order || (idx + 1)
        }));
        mergedHeader.links = mergedHeader.navLinks;
        target.header = mergedHeader;
        g.header = mergedHeader;

        // Sync Footer (top-level and global.footer)
        const mergedFooter = Object.assign(
          {},
          JSON.parse(JSON.stringify(defCMS.footer || {})),
          target.footer || {},
          g.footer || {}
        );
        mergedFooter.brandDesc = mergedFooter.brandDesc || mergedFooter.brandDescription || defCMS.footer?.brandDescription || '';
        mergedFooter.brandDescription = mergedFooter.brandDesc;
        mergedFooter.copyright = mergedFooter.copyright || mergedFooter.copyrightText || defCMS.footer?.copyrightText || '';
        mergedFooter.copyrightText = mergedFooter.copyright;
        mergedFooter.quickLinks = (mergedFooter.quickLinks || defCMS.footer?.quickLinks || []).map((l, idx) => ({
          id: l.id || `fl-${idx + 1}`,
          label: l.label || 'Link',
          url: l.url || l.href || '#',
          href: l.href || l.url || '#',
          visible: l.visible !== false
        }));
        mergedFooter.legalLinks = (mergedFooter.legalLinks || defCMS.footer?.legalLinks || []).map((l, idx) => ({
          id: l.id || `ll-${idx + 1}`,
          label: l.label || 'Policy',
          url: l.url || l.href || '#',
          href: l.href || l.url || '#',
          visible: l.visible !== false
        }));
        target.footer = mergedFooter;
        g.footer = mergedFooter;

        // Sync Legal Documents
        if (!target.legalDocuments && defCMS.legalDocuments) {
          target.legalDocuments = JSON.parse(JSON.stringify(defCMS.legalDocuments));
        } else if (defCMS.legalDocuments) {
          Object.keys(defCMS.legalDocuments).forEach(k => {
            if (!target.legalDocuments[k]) {
              target.legalDocuments[k] = JSON.parse(JSON.stringify(defCMS.legalDocuments[k]));
            } else if (!target.legalDocuments[k].content && defCMS.legalDocuments[k].content) {
              target.legalDocuments[k].content = defCMS.legalDocuments[k].content;
            }
          });
        }

        // Sync Pages & Sections
        target.pages = target.pages || {};
        if (defCMS.pages) {
          Object.keys(defCMS.pages).forEach(pKey => {
            const defPage = defCMS.pages[pKey];
            if (!target.pages[pKey]) {
              target.pages[pKey] = JSON.parse(JSON.stringify(defPage));
            } else {
              const pObj = target.pages[pKey];
              pObj.title = pObj.title || defPage.title;
              pObj.slug = pObj.slug || defPage.slug;
              pObj.seo = Object.assign({}, JSON.parse(JSON.stringify(defPage.seo || {})), pObj.seo || {});
              pObj.seo.title = pObj.seo.title || pObj.seo.metaTitle || defPage.seo?.title || '';
              pObj.seo.metaTitle = pObj.seo.metaTitle || pObj.seo.title;
              pObj.seo.description = pObj.seo.description || pObj.seo.metaDescription || defPage.seo?.description || '';
              pObj.seo.metaDescription = pObj.seo.metaDescription || pObj.seo.description;

              if (!pObj.content && defPage.content) pObj.content = defPage.content;
              if (!pObj.heading && defPage.heading) pObj.heading = defPage.heading;
              if (!pObj.effectiveDate && defPage.effectiveDate) pObj.effectiveDate = defPage.effectiveDate;
              if (!pObj.subtitle && defPage.subtitle) pObj.subtitle = defPage.subtitle;

              if (defPage.sections) {
                pObj.sections = pObj.sections || {};
                Object.keys(defPage.sections).forEach(sKey => {
                  const defSec = defPage.sections[sKey];
                  if (!pObj.sections[sKey]) {
                    pObj.sections[sKey] = JSON.parse(JSON.stringify(defSec));
                  } else {
                    const sec = Object.assign(
                      {},
                      JSON.parse(JSON.stringify(defSec)),
                      pObj.sections[sKey]
                    );
                    sec.id = sec.id || sKey;
                    sec.name = sec.name || defSec.name || sKey;
                    const isVis = sec.enabled !== false && sec.visible !== false;
                    sec.enabled = isVis;
                    sec.visible = isVis;
                    if (sec.btnPrimary) {
                      sec.btnPrimary.text = sec.btnPrimary.text || sec.btnPrimary.label || 'Explore';
                      sec.btnPrimary.label = sec.btnPrimary.text;
                      sec.btnPrimary.link = sec.btnPrimary.link || sec.btnPrimary.href || '#';
                      sec.btnPrimary.href = sec.btnPrimary.link;
                    }
                    if (sec.btnSecondary) {
                      sec.btnSecondary.text = sec.btnSecondary.text || sec.btnSecondary.label || 'Learn More';
                      sec.btnSecondary.label = sec.btnSecondary.text;
                      sec.btnSecondary.link = sec.btnSecondary.link || sec.btnSecondary.href || '#';
                      sec.btnSecondary.href = sec.btnSecondary.link;
                    }
                    if (sec.button) {
                      sec.button.text = sec.button.text || sec.button.label || 'Learn More';
                      sec.button.label = sec.button.text;
                      sec.button.link = sec.button.link || sec.button.href || '#';
                      sec.button.href = sec.button.link;
                    }
                    pObj.sections[sKey] = sec;
                  }
                });
              }

              // Ensure sectionOrder exists for section-driven pages (home, about, partner, contact)
              if (Array.isArray(defPage.sectionOrder) && defPage.sectionOrder.length) {
                if (!Array.isArray(pObj.sectionOrder) || !pObj.sectionOrder.length) {
                  pObj.sectionOrder = JSON.parse(JSON.stringify(defPage.sectionOrder));
                } else {
                  // Ensure all default sections are included in sectionOrder
                  defPage.sectionOrder.forEach(sKey => {
                    if (!pObj.sectionOrder.includes(sKey)) {
                      pObj.sectionOrder.push(sKey);
                    }
                  });
                }
              }
            }
          });
        }

        // Normalize Promotional Banners (handle both array and { settings, items } format)
        let rawBanners = [];
        if (Array.isArray(target.promotionalBanners) && target.promotionalBanners.length) {
          rawBanners = target.promotionalBanners;
        } else if (target.promotionalBanners && Array.isArray(target.promotionalBanners.items) && target.promotionalBanners.items.length) {
          rawBanners = target.promotionalBanners.items;
          target.promotionalBannersSettings = Object.assign({}, defCMS.promotionalBannersSettings || {}, target.promotionalBanners.settings || {});
        } else if (Array.isArray(defCMS.promotionalBanners)) {
          rawBanners = JSON.parse(JSON.stringify(defCMS.promotionalBanners));
        }

        target.promotionalBanners = rawBanners.map((b, idx) => {
          const img = b.image || b.desktopImage || b.mobileImage || 'assets/sweets/banner-celebration-table.jpg';
          const isAct = b.active !== false && b.visible !== false && b.status !== 'inactive';
          const pText = b.btnPrimary?.text || b.ctaPrimaryText || 'Explore Collection';
          const pUrl = b.btnPrimary?.url || b.ctaPrimaryUrl || 'index.html#categories';
          const sText = b.btnSecondary?.text || b.ctaSecondaryText || '';
          const sUrl = b.btnSecondary?.url || b.ctaSecondaryUrl || 'index.html#app';
          const sVis = b.btnSecondary ? (b.btnSecondary.visible !== false && !!sText) : !!sText;

          return Object.assign({}, b, {
            id: b.id || `promo-banner-${idx + 1}`,
            campaignName: b.campaignName || b.title || b.heading || `Campaign ${idx + 1}`,
            badge: b.badge || b.badgeText || 'FEATURED OFFER',
            badgeText: b.badgeText || b.badge || 'FEATURED OFFER',
            title: b.title || b.heading || '',
            heading: b.heading || b.title || '',
            description: b.description || b.subtitle || '',
            subtitle: b.subtitle || b.description || '',
            image: img,
            desktopImage: (b.desktopImage && b.desktopImage !== img) ? b.desktopImage : (img.startsWith('data:') ? '' : img),
            mobileImage: (b.mobileImage && b.mobileImage !== img) ? b.mobileImage : (img.startsWith('data:') ? '' : img),
            btnPrimary: { text: pText, url: pUrl, target: '_self' },
            ctaPrimaryText: pText,
            ctaPrimaryUrl: pUrl,
            btnSecondary: { text: sText, url: sUrl, target: '_self', visible: sVis },
            ctaSecondaryText: sVis ? sText : '',
            ctaSecondaryUrl: sVis ? sUrl : '',
            order: Number(b.order) || (idx + 1),
            active: isAct,
            visible: isAct,
            status: isAct ? 'active' : 'inactive'
          });
        });
      }

      ensureCompleteSchema(draftData);
      ensureCompleteSchema(liveData);

      mediaLibrary = (draftData.media && draftData.media.length)
        ? draftData.media
        : JSON.parse(JSON.stringify(defCMS.media || []));

      // Merge any default media items missing from mediaLibrary
      if (defCMS.media && Array.isArray(defCMS.media)) {
        defCMS.media.forEach(defItem => {
          const existing = mediaLibrary.find(m => m.url === defItem.url);
          if (!existing) {
            mediaLibrary.push(JSON.parse(JSON.stringify(defItem)));
          } else {
            if (!existing.usedInPage) existing.usedInPage = defItem.usedInPage;
            if (!existing.usedInSection) existing.usedInSection = defItem.usedInSection;
            if (!existing.status) existing.status = defItem.status || 'active';
          }
        });
      }
      draftData.media = mediaLibrary;

      safeSaveLocal('draft', draftData);
      safeSaveLocal('live', liveData);

      // 2. Fetch Submissions & Logs in background
      fetchSubmissions();
      fetchHistory();

      updateStatusIndicator();
      renderCurrentModule();
      renderQuickStats();
    } catch (err) {
      console.error('[CMS Admin] Load failed:', err);
      showToast('Error loading database. Using local cache.', 'error');
    }
  }

  function updateStatusIndicator() {
    const pill = document.getElementById('live-status-pill');
    const dot = document.getElementById('live-status-dot');
    const text = document.getElementById('live-status-text');
    if (!pill || !dot || !text) return;

    if (isDirty) {
      dot.className = 'status-dot pending';
      text.textContent = 'Draft Changes Pending';
      pill.style.borderColor = 'var(--warning)';
    } else {
      dot.className = 'status-dot';
      text.textContent = 'Live Synced';
      pill.style.borderColor = 'var(--border-subtle)';
    }
  }

  function markDirty() {
    isDirty = true;
    updateStatusIndicator();
    safeSaveLocal('draft', draftData);
    scheduleBackgroundDraftSync();
  }

  // ── Auto-commit open form module into draftData before save/publish ─────────
  function commitCurrentModuleForm() {
    if (activeModule === 'hero' && document.getElementById('hero-field-desktop-youtube-url')) {
      saveHeroModule(true);
    }
    if (activeModule === 'contact-cms' && document.getElementById('c-hero-heading')) {
      saveContactModule(true);
    }
    if (activeModule === 'partner-cms' && document.getElementById('vp-heading')) {
      savePartnerModule(true);
    }
  }

  // ── Save Draft Action ──────────────────────────────────────────────────────
  async function saveDraft() {
    const btn = document.getElementById('btn-save-draft');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving Draft...'; }

    try {
      commitCurrentModuleForm();
      draftData.meta = draftData.meta || {};
      draftData.meta.lastDraftSaved = new Date().toISOString();
      draftData.media = mediaLibrary;

      await fetch(DRAFT_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftData)
      });

      safeSaveLocal('draft', draftData);
      await logActivity('DRAFT_SAVE', 'Admin saved draft changes.');
      showToast('Draft saved to Firebase database.', 'info');
      updateStatusIndicator();
    } catch (err) {
      showToast('Failed to save draft: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Draft'; }
    }
  }

  // ── Publish Action ─────────────────────────────────────────────────────────
  async function publishToLive() {
    const btn = document.getElementById('btn-publish');
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }

    try {
      commitCurrentModuleForm();
      draftData.meta = draftData.meta || {};
      draftData.meta.lastPublished = new Date().toISOString();
      draftData.meta.version = incrementVersion(draftData.meta.version || '1.0.0');
      draftData.media = mediaLibrary;

      liveData = buildLeanStorageCopy(draftData);

      // Push to Firebase RTDB (liveData omits admin-only media catalog for fast public loading)
      await Promise.all([
        fetch(LIVE_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(liveData)
        }),
        fetch(DRAFT_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draftData)
        })
      ]);

      safeSaveLocal('draft', draftData);
      safeSaveLocal('live', liveData);

      isDirty = false;
      updateStatusIndicator();
      await logActivity('PUBLISH', `Published live version v${draftData.meta.version}.`);

      showToast(`Website Published Live! Version v${draftData.meta.version}`, 'success');
      renderQuickStats();
    } catch (err) {
      showToast('Publish failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Publish Changes'; }
    }
  }

  function incrementVersion(verStr) {
    const parts = (verStr || '1.0.0').split('.').map(n => parseInt(n, 10) || 0);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join('.');
  }

  // ── Render Quick Stats on Dashboard ────────────────────────────────────────
  function renderQuickStats() {
    const statPages = document.getElementById('stat-total-pages');
    const statMedia = document.getElementById('stat-total-media');
    const statSubmissions = document.getElementById('stat-total-submissions');
    const statVer = document.getElementById('stat-version');
    const statLastPub = document.getElementById('stat-last-pub');

    if (statPages && draftData.pages) {
      statPages.textContent = Object.keys(draftData.pages).length;
    }
    if (statMedia) {
      statMedia.textContent = mediaLibrary.length;
    }
    if (statSubmissions) {
      statSubmissions.textContent = formSubmissions.length;
    }
    if (statVer && draftData.meta) {
      statVer.textContent = 'v' + (draftData.meta.version || '1.0.0');
    }
    const bannerBadge = document.getElementById('badge-banners-count');
    if (bannerBadge && draftData.promotionalBanners) {
      const activeCount = draftData.promotionalBanners.filter(b => b.active !== false).length;
      bannerBadge.textContent = activeCount;
    }
    if (statLastPub && draftData.meta && draftData.meta.lastPublished) {
      const d = new Date(draftData.meta.lastPublished);
      statLastPub.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  // ── Navigation & Module Switching ──────────────────────────────────────────
  function switchModule(modName) {
    activeModule = modName;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.module === modName);
    });

    document.querySelectorAll('.module-view').forEach(el => {
      el.classList.toggle('active', el.id === `view-${modName}`);
    });

    // Close mobile drawer if open
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('open');

    renderCurrentModule();
  }

  function openPageShortcut(pageKey) {
    if (pageKey === 'partner') {
      switchModule('partner-cms');
      return;
    }
    if (pageKey === 'contact') {
      switchModule('contact-cms');
      return;
    }
    activeModule = 'pages';
    activePageKey = pageKey;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.module === `${pageKey}-cms`);
    });
    document.querySelectorAll('.module-view').forEach(el => {
      el.classList.toggle('active', el.id === 'view-pages');
    });
    document.querySelectorAll('.page-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === pageKey);
    });
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('open');
    renderPagesModule();
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function renderCurrentModule() {
    if (!draftData) return;

    switch (activeModule) {
      case 'dashboard':
        renderQuickStats();
        break;
      case 'hero':
        renderHeroModule();
        break;
      case 'images':
        renderImageLibraryModule();
        break;
      case 'partner-cms':
        renderPartnerCmsModule();
        break;
      case 'contact-cms':
        renderContactCmsModule();
        break;
      case 'legal-docs':
        renderLegalDocsModule();
        break;
      case 'app-links':
        renderAppLinksModule();
        break;
      case 'branding':
        renderBrandingModule();
        break;
      case 'preloader':
        renderPreloaderModule();
        break;
      case 'design':
        renderDesignModule();
        break;
      case 'header':
        renderHeaderModule();
        break;
      case 'footer':
        renderFooterModule();
        break;
      case 'banners':
        renderBannersModule();
        break;
      case 'pages':
        renderPagesModule();
        break;
      case 'media':
        renderMediaModule();
        break;
      case 'submissions':
        renderSubmissionsModule();
        break;
      case 'history':
        renderHistoryModule();
        break;
      case 'settings':
        renderSettingsModule();
        break;
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  // ── 1. GLOBAL BRANDING MODULE ──────────────────────────────────────────────
  function renderBrandingModule() {
    const g = draftData.global || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

    setVal('brand-sitename', g.siteName || g.brandName || 'MITTAI BANDI');
    setVal('brand-tagline', g.tagline || 'Traditional Taste');
    setVal('brand-company', g.companyName || 'GURMITRAA Technologies Pvt. Ltd.');
    setVal('brand-logo', g.logo || g.logoUrl || 'assets/images/logo.png');
    setVal('brand-logo-alt', g.logoAlt || g.officialLogoUrl || 'assets/images/logo-official.jpg');
    setVal('brand-favicon', g.favicon || g.faviconUrl || 'assets/images/logo.png');
    setVal('brand-playstore', g.playStoreUrl || g.appLinks?.playStoreUrl || 'https://play.google.com/store');
    setVal('brand-appstore', g.appStoreUrl || g.appLinks?.appStoreUrl || '#');

    // Contact
    const c = g.contact || {};
    setVal('brand-email', c.email || g.email || 'mittaibandi@gmail.com');
    setVal('brand-phone', c.phone || g.phone || '+91 94905 32121');
    setVal('brand-whatsapp', c.whatsapp || g.whatsappNumber || '919490532121');
    setVal('brand-address', c.address || g.address || 'GURMITRAA Technologies Pvt. Ltd., Rajahmundry, Andhra Pradesh, India');

    // Social
    const s = g.social || g.socialLinks || {};
    setVal('brand-instagram', s.instagram || 'https://instagram.com/mittaibandi');
    setVal('brand-facebook', s.facebook || 'https://facebook.com/mittaibandi');
    setVal('brand-youtube', s.youtube || 'https://youtube.com/@mittaibandi');
    setVal('brand-linkedin', s.linkedin || 'https://linkedin.com/company/gurmitraa-technologies');

    // Previews
    updateThumbPreview('brand-logo', 'preview-logo');
    updateThumbPreview('brand-logo-alt', 'preview-logo-alt');
    updateThumbPreview('brand-favicon', 'preview-favicon');
  }

  function saveBrandingModule() {
    const g = draftData.global = draftData.global || {};
    const getVal = id => document.getElementById(id)?.value?.trim() || '';

    g.siteName = getVal('brand-sitename') || 'MITTAI BANDI';
    g.brandName = g.siteName;
    g.tagline = getVal('brand-tagline') || 'Traditional Taste';
    g.companyName = getVal('brand-company') || 'GURMITRAA Technologies Pvt. Ltd.';
    g.logo = getVal('brand-logo') || 'assets/images/logo.png';
    g.logoUrl = g.logo;
    g.logoAlt = getVal('brand-logo-alt') || 'assets/images/logo-official.jpg';
    g.favicon = getVal('brand-favicon') || 'assets/images/logo.png';
    g.faviconUrl = g.favicon;
    g.playStoreUrl = getVal('brand-playstore');
    g.appStoreUrl = getVal('brand-appstore');

    g.appLinks = g.appLinks || {};
    g.appLinks.playStoreUrl = g.playStoreUrl;
    g.appLinks.appStoreUrl = g.appStoreUrl;

    g.contact = g.contact || {};
    g.contact.email = getVal('brand-email');
    g.contact.phone = getVal('brand-phone');
    g.contact.whatsapp = getVal('brand-whatsapp');
    g.contact.address = getVal('brand-address');
    g.email = g.contact.email;
    g.phone = g.contact.phone;
    g.whatsappNumber = g.contact.whatsapp;
    g.address = g.contact.address;

    g.social = g.social || {};
    g.social.instagram = getVal('brand-instagram');
    g.social.facebook = getVal('brand-facebook');
    g.social.youtube = getVal('brand-youtube');
    g.social.linkedin = getVal('brand-linkedin');
    g.socialLinks = Object.assign({}, g.socialLinks || {}, g.social);

    markDirty();
    showToast('Branding settings updated.', 'success');
  }

  // ── 2. PRELOADER MODULE ───────────────────────────────────────────────────
  function renderPreloaderModule() {
    const p = Object.assign({}, draftData.preloader || {}, draftData.global?.preloader || {});
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

    const enabledCheck = document.getElementById('preloader-enabled');
    if (enabledCheck) enabledCheck.checked = p.enabled !== false;

    setVal('preloader-title', p.title || p.brandTitle || 'MITTAI BANDI');
    setVal('preloader-subtitle', p.subtitle || p.tagline || "Let's Taste It ❤️");
    setVal('preloader-logo', p.logo || p.logoUrl || 'assets/images/logo-official.jpg');
    setVal('preloader-bgcolor', (p.bgColor && p.bgColor !== '#14020B' && p.bgColor !== '#16020D') ? p.bgColor : '#FFFCFA');
    setVal('preloader-accent', p.accentColor || p.accentRed || '#E60046');
    setVal('preloader-animation', p.animation || 'award-winning');
    setVal('preloader-duration', p.minDuration || p.durationMs || 2600);

    updateThumbPreview('preloader-logo', 'preview-preloader-logo');
  }

  function savePreloaderModule() {
    draftData.global = draftData.global || {};
    const p = draftData.global.preloader = draftData.global.preloader || {};
    p.enabled = document.getElementById('preloader-enabled').checked;
    p.title = document.getElementById('preloader-title').value.trim();
    p.brandTitle = p.title;
    p.subtitle = document.getElementById('preloader-subtitle').value.trim();
    p.tagline = p.subtitle;
    p.logo = document.getElementById('preloader-logo').value.trim() || 'assets/images/logo-official.jpg';
    p.logoUrl = p.logo;
    p.bgColor = document.getElementById('preloader-bgcolor').value;
    p.accentColor = document.getElementById('preloader-accent').value;
    p.accentRed = p.accentColor;
    p.animation = document.getElementById('preloader-animation').value;
    p.minDuration = parseInt(document.getElementById('preloader-duration').value, 10) || 2600;
    p.durationMs = p.minDuration;

    draftData.preloader = Object.assign({}, draftData.preloader || {}, p);

    markDirty();
    showToast('Preloader settings updated.', 'success');
  }

  // ── 3. DESIGN SYSTEM & THEME MODULE ────────────────────────────────────────
  function renderDesignModule() {
    const t = Object.assign({}, draftData.theme || {}, draftData.global?.theme || {});
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

    setVal('theme-primary', t.colorPrimary || t.primaryRed || '#E60046');
    setVal('theme-primary-dark', t.colorPrimaryDark || t.primaryRedDark || '#C9003D');
    setVal('theme-secondary', t.colorSecondary || t.accentGreen || '#16A34A');
    setVal('theme-dark', (t.colorDark && t.colorDark !== '#14020B' && t.colorDark !== '#16020D') ? t.colorDark : (t.textMain || '#252525'));
    setVal('theme-cream', t.colorCream || t.bgCream || '#FFFCFA');
    setVal('theme-light', t.colorLight || t.bgWhite || '#FFFFFF');
    setVal('theme-radius', t.borderRadius || t.cardRadius || '16px');
  }

  function saveDesignModule() {
    draftData.global = draftData.global || {};
    const t = draftData.global.theme = draftData.global.theme || {};
    t.colorPrimary = document.getElementById('theme-primary').value;
    t.primaryRed = t.colorPrimary;
    t.colorPrimaryDark = document.getElementById('theme-primary-dark').value;
    t.primaryRedDark = t.colorPrimaryDark;
    t.colorSecondary = document.getElementById('theme-secondary').value;
    t.accentGreen = t.colorSecondary;
    t.colorDark = document.getElementById('theme-dark').value;
    t.textMain = t.colorDark;
    t.colorCream = document.getElementById('theme-cream').value;
    t.bgCream = t.colorCream;
    t.colorLight = document.getElementById('theme-light').value;
    t.bgWhite = t.colorLight;
    t.borderRadius = document.getElementById('theme-radius').value;
    t.cardRadius = t.borderRadius;

    draftData.theme = Object.assign({}, draftData.theme || {}, t);

    markDirty();
    showToast('Theme colors & typography updated.', 'success');
  }

  // ── 4. HEADER & NAVIGATION MODULE ──────────────────────────────────────────
  function renderHeaderModule() {
    const h = Object.assign({}, draftData.header || {}, draftData.global?.header || {});
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

    const annCheck = document.getElementById('header-ann-enabled');
    if (annCheck) annCheck.checked = h.announcementEnabled === true;
    setVal('header-ann-text', h.announcementText || '');
    setVal('header-ann-link', h.announcementLink || '');
    setVal('header-ann-bg', h.announcementBg || '#C9003D');

    setVal('header-logo-text', h.navLogoText || h.brandName || 'MITTAI BANDI');
    setVal('header-logo-tag', h.navLogoTag || h.brandSubtitle || 'Traditional Taste');

    const storeCheck = document.getElementById('header-store-badges');
    if (storeCheck) storeCheck.checked = h.showStoreBadges !== false && h.showPlayStoreBtn !== false;

    const links = h.navLinks || h.links || [];
    renderNavLinksTable(links);
  }

  function renderNavLinksTable(links) {
    const tbody = document.getElementById('nav-links-tbody');
    if (!tbody) return;

    if (!links.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-faint);">No navigation links defined.</td></tr>`;
      return;
    }

    tbody.innerHTML = links.map((l, idx) => `
      <tr>
        <td><strong>${l.label || ''}</strong></td>
        <td><code>${l.url || l.href || '#'}</code></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.moveNavLink(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="Move Up">
            <i data-lucide="arrow-up"></i>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.moveNavLink(${idx}, 1)" ${idx === links.length - 1 ? 'disabled' : ''} title="Move Down">
            <i data-lucide="arrow-down"></i>
          </button>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.editNavLink(${idx})" title="Edit Link">
            <i data-lucide="edit-3"></i>
            <span>Edit</span>
          </button>
          <button class="btn btn-danger btn-sm" onclick="MB_CMS_ADMIN.deleteNavLink(${idx})" title="Delete Link">
            <i data-lucide="trash-2"></i>
            <span>Delete</span>
          </button>
        </td>
      </tr>
    `).join('');

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function syncHeaderState(h) {
    draftData.header = Object.assign({}, draftData.header || {}, h);
    draftData.global = draftData.global || {};
    draftData.global.header = draftData.header;
  }

  function saveHeaderModule() {
    const h = Object.assign({}, draftData.header || {}, draftData.global?.header || {});
    h.announcementEnabled = !!document.getElementById('header-ann-enabled')?.checked;
    h.announcementText = document.getElementById('header-ann-text')?.value?.trim() || '';
    h.announcementLink = document.getElementById('header-ann-link')?.value?.trim() || '';
    h.announcementBg = document.getElementById('header-ann-bg')?.value || '#C9003D';
    h.navLogoText = document.getElementById('header-logo-text')?.value?.trim() || 'MITTAI BANDI';
    h.brandName = h.navLogoText;
    h.navLogoTag = document.getElementById('header-logo-tag')?.value?.trim() || 'Traditional Taste';
    h.brandSubtitle = h.navLogoTag;
    h.showStoreBadges = document.getElementById('header-store-badges')?.checked !== false;
    h.showPlayStoreBtn = h.showStoreBadges;
    h.showAppStoreBtn = h.showStoreBadges;

    syncHeaderState(h);
    markDirty();
    showToast('Header configuration updated.', 'success');
  }

  function addNavLink() {
    const label = prompt('Enter Navigation Link Label (e.g. Menu, Stories):');
    if (!label) return;
    const url = prompt('Enter URL / Anchor (e.g. index.html#categories, about.html):', '#');
    if (!url) return;

    const h = Object.assign({}, draftData.header || {}, draftData.global?.header || {});
    h.navLinks = h.navLinks || h.links || [];
    h.navLinks.push({
      id: 'nav-' + Date.now(),
      label: label.trim(),
      url: url.trim(),
      href: url.trim(),
      visible: true,
      target: '_self'
    });
    h.links = h.navLinks;
    syncHeaderState(h);

    renderNavLinksTable(h.navLinks);
    markDirty();
    showToast('Navigation link added.', 'success');
  }

  function editNavLink(index) {
    const h = Object.assign({}, draftData.header || {}, draftData.global?.header || {});
    const links = h.navLinks || h.links || [];
    const item = links[index];
    if (!item) return;

    const newLabel = prompt('Edit Navigation Link Label:', item.label || '');
    if (newLabel === null) return;
    const newUrl = prompt('Edit Destination URL:', item.url || item.href || '#');
    if (newUrl === null) return;

    item.label = newLabel.trim() || item.label;
    item.url = newUrl.trim() || item.url;
    item.href = item.url;
    h.navLinks = links;
    h.links = links;
    syncHeaderState(h);

    renderNavLinksTable(links);
    markDirty();
    showToast('Navigation link updated.', 'success');
  }

  function moveNavLink(index, direction) {
    const h = Object.assign({}, draftData.header || {}, draftData.global?.header || {});
    const links = h.navLinks || h.links || [];
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= links.length) return;
    const temp = links[index];
    links[index] = links[targetIdx];
    links[targetIdx] = temp;
    h.navLinks = links;
    h.links = links;
    syncHeaderState(h);
    renderNavLinksTable(links);
    markDirty();
  }

  function deleteNavLink(index) {
    if (!confirm('Are you sure you want to delete this navigation link?')) return;
    const h = Object.assign({}, draftData.header || {}, draftData.global?.header || {});
    const links = h.navLinks || h.links || [];
    links.splice(index, 1);
    h.navLinks = links;
    h.links = links;
    syncHeaderState(h);
    renderNavLinksTable(links);
    markDirty();
    showToast('Navigation link deleted.', 'info');
  }

  // ── 5. FOOTER MODULE ───────────────────────────────────────────────────────
  function renderFooterModule() {
    const g = draftData.global || {};
    const f = Object.assign({}, draftData.footer || {}, g.footer || {});
    const c = g.contact || {};
    const s = g.social || g.socialLinks || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

    setVal('footer-company-name', g.companyName || 'GURMITRAA Technologies Pvt. Ltd.');
    setVal('footer-brand-desc', f.brandDesc || f.brandDescription || '');
    setVal('footer-powered', f.poweredBy || 'Powered by GURMITRAA Technologies Pvt. Ltd.');
    setVal('footer-copyright', f.copyright || f.copyrightText || '');
    setVal('footer-address', f.address || c.address || g.address || '');
    setVal('footer-email', f.email || c.email || g.email || '');
    setVal('footer-phone', f.phone || c.phone || g.phone || '');
    setVal('footer-instagram', s.instagram || '');
    setVal('footer-facebook', s.facebook || '');
    setVal('footer-youtube', s.youtube || '');
    setVal('footer-linkedin', s.linkedin || '');
    setVal('footer-playstore-url', g.playStoreUrl || g.appLinks?.playStoreUrl || '');
    setVal('footer-appstore-url', g.appStoreUrl || g.appLinks?.appStoreUrl || '');

    const storeCheck = document.getElementById('footer-store-badges');
    if (storeCheck) storeCheck.checked = f.showStoreBadges !== false;

    // Render Quick Links
    renderFooterLinksTable('footer-quick-links-tbody', f.quickLinks || [], 'quick');
    // Render Legal Links
    renderFooterLinksTable('footer-legal-links-tbody', f.legalLinks || [], 'legal');
  }

  function renderFooterLinksTable(tbodyId, links, type) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (!links.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-faint);">No links defined.</td></tr>`;
      return;
    }

    tbody.innerHTML = links.map((l, idx) => `
      <tr>
        <td><strong>${l.label || ''}</strong></td>
        <td><code>${l.url || l.href || '#'}</code></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.moveFooterLink('${type}', ${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="Move Up">
            <i data-lucide="arrow-up"></i>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.moveFooterLink('${type}', ${idx}, 1)" ${idx === links.length - 1 ? 'disabled' : ''} title="Move Down">
            <i data-lucide="arrow-down"></i>
          </button>
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.editFooterLink('${type}', ${idx})" title="Edit Link">
            <i data-lucide="edit-3"></i>
            <span>Edit</span>
          </button>
          <button class="btn btn-danger btn-sm" onclick="MB_CMS_ADMIN.deleteFooterLink('${type}', ${idx})" title="Delete Link">
            <i data-lucide="trash-2"></i>
            <span>Delete</span>
          </button>
        </td>
      </tr>
    `).join('');

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function syncFooterState(f) {
    draftData.footer = Object.assign({}, draftData.footer || {}, f);
    draftData.global = draftData.global || {};
    draftData.global.footer = draftData.footer;
  }

  function saveFooterModule() {
    const g = draftData.global = draftData.global || {};
    const f = Object.assign({}, draftData.footer || {}, g.footer || {});
    const c = g.contact = g.contact || {};
    const s = g.social = g.social || {};
    const getVal = id => document.getElementById(id)?.value?.trim() || '';

    if (document.getElementById('footer-company-name')) g.companyName = getVal('footer-company-name');
    f.brandDesc = getVal('footer-brand-desc');
    f.brandDescription = f.brandDesc;
    f.poweredBy = getVal('footer-powered');
    f.copyright = getVal('footer-copyright');
    f.copyrightText = f.copyright;
    f.showStoreBadges = document.getElementById('footer-store-badges')?.checked !== false;

    if (document.getElementById('footer-address')) {
      c.address = getVal('footer-address');
      g.address = c.address;
      f.address = c.address;
    }
    if (document.getElementById('footer-email')) {
      c.email = getVal('footer-email');
      g.email = c.email;
      f.email = c.email;
    }
    if (document.getElementById('footer-phone')) {
      c.phone = getVal('footer-phone');
      g.phone = c.phone;
      f.phone = c.phone;
    }
    if (document.getElementById('footer-instagram')) s.instagram = getVal('footer-instagram');
    if (document.getElementById('footer-facebook')) s.facebook = getVal('footer-facebook');
    if (document.getElementById('footer-youtube')) s.youtube = getVal('footer-youtube');
    if (document.getElementById('footer-linkedin')) s.linkedin = getVal('footer-linkedin');
    g.socialLinks = Object.assign({}, g.socialLinks || {}, s);

    if (document.getElementById('footer-playstore-url')) {
      g.playStoreUrl = getVal('footer-playstore-url');
      g.appLinks = g.appLinks || {};
      g.appLinks.playStoreUrl = g.playStoreUrl;
    }
    if (document.getElementById('footer-appstore-url')) {
      g.appStoreUrl = getVal('footer-appstore-url');
      g.appLinks = g.appLinks || {};
      g.appLinks.appStoreUrl = g.appStoreUrl;
    }

    syncFooterState(f);
    markDirty();
    showToast('Footer settings updated.', 'success');
  }

  function addFooterLink(type) {
    const label = prompt('Enter Footer Link Label:');
    if (!label) return;
    const url = prompt('Enter URL:', '#');
    if (!url) return;

    const f = Object.assign({}, draftData.footer || {}, draftData.global?.footer || {});
    const arrKey = type === 'quick' ? 'quickLinks' : 'legalLinks';
    f[arrKey] = f[arrKey] || [];
    f[arrKey].push({
      id: 'fl-' + Date.now(),
      label: label.trim(),
      url: url.trim(),
      href: url.trim(),
      visible: true
    });
    syncFooterState(f);

    renderFooterLinksTable(type === 'quick' ? 'footer-quick-links-tbody' : 'footer-legal-links-tbody', f[arrKey], type);
    markDirty();
    showToast('Footer link added.', 'success');
  }

  function editFooterLink(type, idx) {
    const f = Object.assign({}, draftData.footer || {}, draftData.global?.footer || {});
    const arrKey = type === 'quick' ? 'quickLinks' : 'legalLinks';
    const arr = f[arrKey] || [];
    const item = arr[idx];
    if (!item) return;

    const newLabel = prompt('Edit Footer Link Label:', item.label || '');
    if (newLabel === null) return;
    const newUrl = prompt('Edit Footer Link URL:', item.url || item.href || '#');
    if (newUrl === null) return;

    item.label = newLabel.trim() || item.label;
    item.url = newUrl.trim() || item.url;
    item.href = item.url;
    syncFooterState(f);

    renderFooterLinksTable(type === 'quick' ? 'footer-quick-links-tbody' : 'footer-legal-links-tbody', arr, type);
    markDirty();
    showToast('Footer link updated.', 'success');
  }

  function moveFooterLink(type, idx, dir) {
    const f = Object.assign({}, draftData.footer || {}, draftData.global?.footer || {});
    const arr = type === 'quick' ? (f.quickLinks || []) : (f.legalLinks || []);
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    const temp = arr[idx];
    arr[idx] = arr[target];
    arr[target] = temp;
    syncFooterState(f);
    renderFooterLinksTable(type === 'quick' ? 'footer-quick-links-tbody' : 'footer-legal-links-tbody', arr, type);
    markDirty();
  }

  function deleteFooterLink(type, idx) {
    if (!confirm('Are you sure you want to delete this footer link?')) return;
    const f = Object.assign({}, draftData.footer || {}, draftData.global?.footer || {});
    const arr = type === 'quick' ? (f.quickLinks || []) : (f.legalLinks || []);
    arr.splice(idx, 1);
    syncFooterState(f);
    renderFooterLinksTable(type === 'quick' ? 'footer-quick-links-tbody' : 'footer-legal-links-tbody', arr, type);
    markDirty();
    showToast('Footer link deleted.', 'info');
  }

  // ── 5.5 PROMOTIONAL BANNERS CMS MODULE ─────────────────────────────────────
  let bannerStatusFilter = 'all';
  let bannerSearchQuery = '';
  let bannerPreviewDevice = 'desktop';
  let adminPreviewSlide = 0;

  function getBannerSchedule(b) {
    if (b.active === false) {
      return { status: 'inactive', label: 'Inactive', color: '#64748B', bg: '#F1F5F9', icon: 'eye-off' };
    }
    const now = new Date();
    if (b.startDate) {
      const s = new Date(b.startDate);
      if (!isNaN(s) && now < s) {
        return { status: 'scheduled', label: 'Scheduled', color: '#0284C7', bg: '#E0F2FE', icon: 'calendar', note: 'Starts ' + s.toLocaleDateString() };
      }
    }
    if (b.endDate) {
      const e = new Date(b.endDate);
      if (!isNaN(e) && now > e) {
        return { status: 'expired', label: 'Expired', color: '#CA8A04', bg: '#FEF9C3', icon: 'clock', note: 'Ended ' + e.toLocaleDateString() };
      }
    }
    return { status: 'active', label: 'Live Now', color: '#16A34A', bg: '#DCFCE7', icon: 'check-circle-2' };
  }

  function renderBannersKPIs() {
    const banners = draftData.promotionalBanners || [];
    let active = 0, scheduled = 0, expired = 0, inactive = 0;

    banners.forEach(b => {
      const sch = getBannerSchedule(b);
      if (sch.status === 'active') active++;
      else if (sch.status === 'scheduled') scheduled++;
      else if (sch.status === 'expired') expired++;
      else if (sch.status === 'inactive') inactive++;
    });

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('banner-kpi-total', banners.length);
    setEl('banner-kpi-active', active);
    setEl('banner-kpi-scheduled', scheduled);
    setEl('banner-kpi-expired', expired);
    setEl('banner-kpi-inactive', inactive);

    const badge = document.getElementById('badge-banners-count');
    if (badge) badge.textContent = active;
  }

  function renderBannersList() {
    const container = document.getElementById('banners-list-container');
    if (!container) return;

    let banners = (draftData.promotionalBanners || []).slice();
    banners.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (bannerSearchQuery) {
      const q = bannerSearchQuery.toLowerCase();
      banners = banners.filter(b =>
        (b.campaignName && b.campaignName.toLowerCase().includes(q)) ||
        (b.title && b.title.toLowerCase().includes(q)) ||
        (b.badge && b.badge.toLowerCase().includes(q)) ||
        (b.description && b.description.toLowerCase().includes(q))
      );
    }

    if (bannerStatusFilter !== 'all') {
      banners = banners.filter(b => {
        const sch = getBannerSchedule(b);
        return sch.status === bannerStatusFilter;
      });
    }

    if (banners.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem 1.5rem; background: #FAFBFD; border-radius: 12px; border: 1px dashed #CBD5E1;">
          <div style="width: 54px; height: 54px; border-radius: 50%; background: rgba(230,0,70,0.08); color: var(--color-brand-red, #E60046); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 0.75rem;">
            <i data-lucide="megaphone" style="width: 26px; height: 26px;"></i>
          </div>
          <h4 style="font-size: 1.05rem; color: #1E293B; margin-bottom: 0.35rem;">No Promotional Banners Found</h4>
          <p style="font-size: 0.86rem; color: #64748B; max-width: 440px; margin: 0 auto 1.25rem auto;">
            ${bannerSearchQuery || bannerStatusFilter !== 'all' ? 'No campaigns match your filter criteria. Try resetting your search or filters.' : 'Add your first promotional banner campaign to highlight festive sweets, discount specials, or seasonal arrivals.'}
          </p>
          <button class="btn btn-primary btn-sm" onclick="MB_CMS_ADMIN.openBannerEditor()">
            <i data-lucide="plus-circle"></i>
            <span>Add Promotional Banner</span>
          </button>
        </div>
      `;
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
      return;
    }

    const allBanners = draftData.promotionalBanners || [];
    container.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 80px; text-align: center;">Order</th>
              <th style="width: 120px;">Visual</th>
              <th>Campaign &amp; Headline</th>
              <th>Action Links</th>
              <th style="width: 130px;">Status</th>
              <th style="width: 100px; text-align: center;">Active</th>
              <th style="width: 120px; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${banners.map((b) => {
              const globalIdx = allBanners.findIndex(item => item.id === b.id);
              const sch = getBannerSchedule(b);
              const isFirst = globalIdx <= 0;
              const isLast = globalIdx >= allBanners.length - 1;
              const pBtn = b.btnPrimary || { text: 'Explore', url: '#' };
              const sBtn = b.btnSecondary;
              const hasSec = sBtn && sBtn.visible !== false && sBtn.text;

              return `
                <tr data-banner-id="${b.id}">
                  <td style="text-align: center;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                      <span class="badge" style="background: #F1F5F9; color: #475569; font-weight: 700; font-size: 0.75rem;">#${b.order || (globalIdx + 1)}</span>
                      <div style="display: flex; gap: 2px; margin-top: 4px;">
                        <button class="btn btn-secondary btn-sm" style="padding: 2px 5px; height: 24px;" onclick="MB_CMS_ADMIN.reorderBanner('${b.id}', 'up')" ${isFirst ? 'disabled' : ''} title="Move Up in Carousel">
                          <i data-lucide="arrow-up" style="width: 12px; height: 12px;"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" style="padding: 2px 5px; height: 24px;" onclick="MB_CMS_ADMIN.reorderBanner('${b.id}', 'down')" ${isLast ? 'disabled' : ''} title="Move Down in Carousel">
                          <i data-lucide="arrow-down" style="width: 12px; height: 12px;"></i>
                        </button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style="width: 105px; height: 58px; border-radius: 8px; overflow: hidden; background: #FFF9F3; border: 1px solid #EEEEEE; position: relative;">
                      <img src="${resolveAssetUrl(b.image || b.desktopImage || '/assets/images/wedding_sweets.png')}" alt="${b.campaignName || 'Banner'}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/assets/images/logo.png';" />
                    </div>
                  </td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                      <span class="badge" style="background: rgba(230,0,70,0.08); color: var(--color-brand-red, #E60046); font-weight: 700; font-size: 0.7rem; letter-spacing: 0.04em;">
                        ${b.badge || 'PROMO'}
                      </span>
                      <strong style="color: #0F172A; font-size: 0.95rem;">${b.campaignName || 'Unnamed Campaign'}</strong>
                    </div>
                    <div style="color: #334155; font-size: 0.86rem; line-height: 1.4; font-weight: 500;">
                      ${b.title || 'No Headline'}
                    </div>
                    ${b.description ? `<div style="color: #64748B; font-size: 0.78rem; line-height: 1.35; margin-top: 2px; max-width: 440px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${b.description}</div>` : ''}
                  </td>
                  <td>
                    <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 2px;">
                      <div style="color: #1E293B;">
                        <span style="color: #64748B;">CTA:</span> <strong>${pBtn.text || 'Explore'}</strong>
                        <span style="color: #94A3B8; font-family: monospace; font-size: 0.72rem;">(${pBtn.url || '#'})</span>
                      </div>
                      ${hasSec ? `
                        <div style="color: #64748B;">
                          <span>2nd:</span> ${sBtn.text} <span style="font-family: monospace; font-size: 0.72rem;">(${sBtn.url || '#'})</span>
                        </div>
                      ` : '<div style="color: #94A3B8; font-size: 0.75rem;">(No 2nd button)</div>'}
                    </div>
                  </td>
                  <td>
                    <span class="badge" style="background: ${sch.bg}; color: ${sch.color}; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px;">
                      <i data-lucide="${sch.icon}" style="width: 12px; height: 12px;"></i>
                      <span>${sch.label}</span>
                    </span>
                    ${sch.note ? `<div style="font-size: 0.7rem; color: #64748B; margin-top: 3px;">${sch.note}</div>` : ''}
                  </td>
                  <td style="text-align: center;">
                    <label class="toggle-wrap" title="Toggle active in carousel">
                      <input type="checkbox" class="toggle-hidden" onchange="MB_CMS_ADMIN.toggleBannerActive('${b.id}')" ${b.active !== false ? 'checked' : ''} />
                      <span class="toggle-switch"></span>
                    </label>
                  </td>
                  <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 0.35rem;">
                      <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.openBannerEditor('${b.id}')" title="Edit Campaign">
                        <i data-lucide="edit-3"></i>
                        <span>Edit</span>
                      </button>
                      <button class="btn btn-danger btn-sm" onclick="MB_CMS_ADMIN.deleteBanner('${b.id}')" title="Delete Banner">
                        <i data-lucide="trash-2"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function renderAdminBannerPreview() {
    const stage = document.getElementById('banner-admin-preview-stage');
    if (!stage) return;

    const banners = (draftData.promotionalBanners || [])
      .filter(b => b.active !== false)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (banners.length === 0) {
      stage.innerHTML = `
        <div style="padding: 2.5rem; text-align: center; background: #FFFFFF; border-radius: 16px; border: 1.5px dashed #CBD5E1; color: #64748B;">
          <div style="width: 44px; height: 44px; border-radius: 50%; background: #F1F5F9; color: #94A3B8; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 0.5rem;">
            <i data-lucide="eye-off" style="width: 22px; height: 22px;"></i>
          </div>
          <p style="margin: 0;">No active promotional banners to preview. Toggle at least one banner as "Active".</p>
        </div>
      `;
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
      return;
    }

    if (adminPreviewSlide >= banners.length) adminPreviewSlide = 0;
    const b = banners[adminPreviewSlide];
    const pBtn = b.btnPrimary || { text: 'Explore Now', url: '#' };
    const sBtn = b.btnSecondary;
    const hasSec = sBtn && sBtn.visible !== false && sBtn.text;

    stage.innerHTML = `
      <div style="position: relative; border-radius: 18px; border: 1.5px solid #EEEEEE; background: #FFFFFF; box-shadow: 0 4px 20px rgba(0,0,0,0.05); overflow: hidden;">
        <div style="display: flex; flex-wrap: wrap; min-height: 280px;">
          <div style="flex: 1 1 54%; padding: 2rem; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; background: #FFFFFF;">
            <div style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.7rem; font-weight: 700; color: #E60046; background: rgba(230,0,70,0.08); border: 1px solid rgba(230,0,70,0.18); padding: 0.25rem 0.65rem; border-radius: 999px; margin-bottom: 0.65rem;">
              <i data-lucide="sparkles" style="width: 12px; height: 12px;"></i>
              <span>${b.badge || 'PROMOTION'}</span>
            </div>
            <h3 style="font-size: 1.35rem; font-weight: 700; color: #202124; line-height: 1.25; margin: 0 0 0.5rem 0;">${b.title || ''}</h3>
            <p style="font-size: 0.88rem; color: #666666; line-height: 1.55; margin: 0 0 1.25rem 0;">${b.description || ''}</p>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <span class="btn btn-primary btn-sm" style="background: #E60046; color: white; border-radius: 999px; padding: 0.5rem 1.15rem; font-size: 0.85rem; pointer-events: none;">
                ${pBtn.text || 'Explore'}
              </span>
              ${hasSec ? `
                <span class="btn btn-outline btn-sm" style="border-radius: 999px; padding: 0.5rem 1rem; font-size: 0.85rem; pointer-events: none;">
                  ${sBtn.text}
                </span>
              ` : ''}
            </div>
          </div>
          <div style="flex: 1 1 46%; min-height: 220px; background: #FFF9F3; position: relative;">
            <img src="${resolveAssetUrl(b.image || b.desktopImage || '/assets/images/wedding_sweets.png')}" alt="${b.campaignName}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/assets/images/logo.png';" />
          </div>
        </div>

        <!-- Preview Carousel Controls -->
        <div style="position: absolute; bottom: 12px; left: 16px; display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.92); padding: 4px 8px; border-radius: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <button style="border: none; background: transparent; cursor: pointer; padding: 2px; display: flex; align-items: center;" onclick="MB_CMS_ADMIN.adminPreviewPrev()"><i data-lucide="chevron-left" style="width: 16px; height: 16px;"></i></button>
          <span style="font-size: 0.75rem; font-weight: 700; color: #475569; padding: 0 4px;">Slide ${adminPreviewSlide + 1} of ${banners.length}</span>
          <button style="border: none; background: transparent; cursor: pointer; padding: 2px; display: flex; align-items: center;" onclick="MB_CMS_ADMIN.adminPreviewNext()"><i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i></button>
        </div>
      </div>
    `;

    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function adminPreviewNext() {
    const banners = (draftData.promotionalBanners || []).filter(b => b.active !== false);
    if (banners.length <= 1) return;
    adminPreviewSlide = (adminPreviewSlide + 1) % banners.length;
    renderAdminBannerPreview();
  }

  function adminPreviewPrev() {
    const banners = (draftData.promotionalBanners || []).filter(b => b.active !== false);
    if (banners.length <= 1) return;
    adminPreviewSlide = (adminPreviewSlide - 1 + banners.length) % banners.length;
    renderAdminBannerPreview();
  }

  function setBannerPreviewDevice(device) {
    bannerPreviewDevice = device;
    document.querySelectorAll('.device-btn[data-banner-device]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bannerDevice === device);
    });

    const stage = document.getElementById('banner-admin-preview-stage');
    if (stage) {
      if (device === 'mobile') stage.style.maxWidth = '375px';
      else if (device === 'tablet') stage.style.maxWidth = '768px';
      else stage.style.maxWidth = '100%';
    }
  }

  function renderBannersModule() {
    renderBannersKPIs();
    renderBannersList();
    renderAdminBannerPreview();
  }

  function filterBanners() {
    const input = document.getElementById('banner-search-input');
    bannerSearchQuery = input ? input.value.trim() : '';
    renderBannersList();
  }

  function setBannerStatusFilter(status) {
    bannerStatusFilter = status;
    const pills = document.querySelectorAll('#banner-status-filter-pills .filter-pill');
    pills.forEach(p => p.classList.toggle('active', p.dataset.status === status));
    renderBannersList();
  }

  function toggleBannerBtn2Fields(checked) {
    document.querySelectorAll('.banner-btn2-group').forEach(el => {
      el.style.display = checked ? '' : 'none';
    });
  }

  function openBannerEditor(bannerId = null) {
    const modal = document.getElementById('banner-edit-modal');
    if (!modal) return;

    const titleEl = document.getElementById('banner-modal-title');
    const idInput = document.getElementById('banner-field-id');
    const campInput = document.getElementById('banner-field-campaign');
    const badgeInput = document.getElementById('banner-field-badge');
    const headingInput = document.getElementById('banner-field-title');
    const descInput = document.getElementById('banner-field-desc');
    const imgInput = document.getElementById('banner-field-image');
    const imgPreview = document.getElementById('preview-banner-image');
    const btn1TextInput = document.getElementById('banner-field-btn1-text');
    const btn1UrlInput = document.getElementById('banner-field-btn1-url');
    const btn2EnabledInput = document.getElementById('banner-field-btn2-enabled');
    const btn2TextInput = document.getElementById('banner-field-btn2-text');
    const btn2UrlInput = document.getElementById('banner-field-btn2-url');
    const startInput = document.getElementById('banner-field-start');
    const endInput = document.getElementById('banner-field-end');
    const orderInput = document.getElementById('banner-field-order');
    const activeInput = document.getElementById('banner-field-active');

    draftData.promotionalBanners = draftData.promotionalBanners || [];

    if (bannerId) {
      const banner = draftData.promotionalBanners.find(b => b.id === bannerId);
      if (!banner) return;

      if (titleEl) titleEl.textContent = 'Edit Promotional Banner';
      if (idInput) idInput.value = banner.id || '';
      if (campInput) campInput.value = banner.campaignName || '';
      if (badgeInput) badgeInput.value = banner.badge || banner.badgeText || '';
      if (headingInput) headingInput.value = banner.title || banner.heading || '';
      if (descInput) descInput.value = banner.description || banner.subtitle || '';
      const bImg = banner.image || banner.desktopImage || '';
      if (imgInput) imgInput.value = bImg;
      if (imgPreview) imgPreview.src = resolveAssetUrl(bImg || '/assets/images/wedding_sweets.png');
      if (btn1TextInput) btn1TextInput.value = banner.btnPrimary?.text || banner.ctaPrimaryText || '';
      if (btn1UrlInput) btn1UrlInput.value = banner.btnPrimary?.url || banner.ctaPrimaryUrl || '';

      const hasBtn2 = banner.btnSecondary ? (banner.btnSecondary.visible !== false && !!(banner.btnSecondary.text || banner.ctaSecondaryText)) : !!banner.ctaSecondaryText;
      if (btn2EnabledInput) btn2EnabledInput.checked = hasBtn2;
      if (btn2TextInput) btn2TextInput.value = banner.btnSecondary?.text || banner.ctaSecondaryText || '';
      if (btn2UrlInput) btn2UrlInput.value = banner.btnSecondary?.url || banner.ctaSecondaryUrl || '';
      toggleBannerBtn2Fields(hasBtn2);

      if (startInput) startInput.value = banner.startDate ? banner.startDate.slice(0, 16) : '';
      if (endInput) endInput.value = banner.endDate ? banner.endDate.slice(0, 16) : '';
      if (orderInput) orderInput.value = banner.order || 1;
      if (activeInput) activeInput.checked = banner.active !== false && banner.visible !== false;
    } else {
      if (titleEl) titleEl.textContent = 'Create Promotional Banner';
      if (idInput) idInput.value = '';
      if (campInput) campInput.value = '';
      if (badgeInput) badgeInput.value = 'SPECIAL OFFER';
      if (headingInput) headingInput.value = '';
      if (descInput) descInput.value = '';
      if (imgInput) imgInput.value = 'assets/images/wedding_sweets.png';
      if (imgPreview) imgPreview.src = '/assets/images/wedding_sweets.png';
      if (btn1TextInput) btn1TextInput.value = 'Explore Now';
      if (btn1UrlInput) btn1UrlInput.value = 'index.html#categories';
      if (btn2EnabledInput) btn2EnabledInput.checked = true;
      if (btn2TextInput) btn2TextInput.value = 'Order On App';
      if (btn2UrlInput) btn2UrlInput.value = 'index.html#app';
      toggleBannerBtn2Fields(true);
      if (startInput) startInput.value = '';
      if (endInput) endInput.value = '';
      if (orderInput) orderInput.value = draftData.promotionalBanners.length + 1;
      if (activeInput) activeInput.checked = true;
    }

    modal.classList.add('active');
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function saveBannerForm(event) {
    if (event) event.preventDefault();
    const id = document.getElementById('banner-field-id').value.trim();
    const campaign = document.getElementById('banner-field-campaign').value.trim();
    const badge = document.getElementById('banner-field-badge').value.trim();
    const title = document.getElementById('banner-field-title').value.trim();
    const desc = document.getElementById('banner-field-desc').value.trim();
    const image = document.getElementById('banner-field-image').value.trim();
    const btn1Text = document.getElementById('banner-field-btn1-text').value.trim();
    const btn1Url = document.getElementById('banner-field-btn1-url').value.trim();
    const btn2Enabled = document.getElementById('banner-field-btn2-enabled').checked;
    const btn2Text = document.getElementById('banner-field-btn2-text').value.trim();
    const btn2Url = document.getElementById('banner-field-btn2-url').value.trim();
    const startDate = document.getElementById('banner-field-start').value;
    const endDate = document.getElementById('banner-field-end').value;
    const orderVal = parseInt(document.getElementById('banner-field-order').value, 10) || 1;
    const active = document.getElementById('banner-field-active').checked;

    if (!campaign || !title || !image || !btn1Text) {
      showToast('Please fill in all required fields (Campaign Name, Title, Image, CTA).', 'error');
      return;
    }

    draftData.promotionalBanners = draftData.promotionalBanners || [];
    const bannerId = id || ('banner-' + Date.now());
    const existingIdx = draftData.promotionalBanners.findIndex(b => b.id === bannerId);

    const bannerObj = {
      id: bannerId,
      campaignName: campaign,
      badge: badge || 'SPECIAL OFFER',
      badgeText: badge || 'SPECIAL OFFER',
      title: title,
      heading: title,
      description: desc,
      subtitle: desc,
      image: image,
      desktopImage: image.startsWith('data:') ? '' : image,
      mobileImage: image.startsWith('data:') ? '' : image,
      ctaPrimaryText: btn1Text,
      ctaPrimaryUrl: btn1Url || 'index.html#categories',
      ctaSecondaryText: btn2Enabled ? btn2Text : '',
      ctaSecondaryUrl: btn2Url || 'index.html#app',
      btnPrimary: {
        text: btn1Text,
        url: btn1Url || 'index.html#categories',
        target: '_self'
      },
      btnSecondary: {
        text: btn2Text,
        url: btn2Url || 'index.html#app',
        target: '_self',
        visible: btn2Enabled
      },
      startDate: startDate ? new Date(startDate).toISOString() : '',
      endDate: endDate ? new Date(endDate).toISOString() : '',
      order: orderVal,
      active: active,
      visible: active,
      status: active ? 'active' : 'inactive',
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      draftData.promotionalBanners[existingIdx] = bannerObj;
    } else {
      draftData.promotionalBanners.push(bannerObj);
    }

    draftData.promotionalBanners.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    closeModal('banner-edit-modal');
    markDirty();
    showToast('Promotional banner saved to draft!', 'success');
    renderBannersModule();
  }

  async function saveBannerAndPublish(event) {
    saveBannerForm(event);
    await publishToLive();
  }

  async function publishBannersLive() {
    await publishToLive();
  }

  function toggleBannerActive(id) {
    draftData.promotionalBanners = draftData.promotionalBanners || [];
    const banner = draftData.promotionalBanners.find(b => b.id === id);
    if (!banner) return;

    banner.active = banner.active === false ? true : false;
    banner.visible = banner.active;
    banner.status = banner.active ? 'active' : 'inactive';
    markDirty();
    renderBannersKPIs();
    renderBannersList();
    renderAdminBannerPreview();
    showToast(`Banner "${banner.campaignName}" is now ${banner.active ? 'active' : 'inactive'}.`, 'info');
  }

  function reorderBanner(id, direction) {
    draftData.promotionalBanners = draftData.promotionalBanners || [];
    draftData.promotionalBanners.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    const idx = draftData.promotionalBanners.findIndex(b => b.id === id);
    if (idx === -1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= draftData.promotionalBanners.length) return;

    const temp = draftData.promotionalBanners[idx];
    draftData.promotionalBanners[idx] = draftData.promotionalBanners[targetIdx];
    draftData.promotionalBanners[targetIdx] = temp;

    draftData.promotionalBanners.forEach((b, i) => {
      b.order = i + 1;
    });

    markDirty();
    renderBannersList();
    renderAdminBannerPreview();
    showToast('Banner carousel order updated.', 'info');
  }

  function deleteBanner(id) {
    draftData.promotionalBanners = draftData.promotionalBanners || [];
    const banner = draftData.promotionalBanners.find(b => b.id === id);
    if (!banner) return;

    const modal = document.getElementById('banner-delete-modal');
    const nameEl = document.getElementById('banner-delete-name');
    const confirmBtn = document.getElementById('btn-confirm-banner-delete');
    if (!modal || !confirmBtn) return;

    if (nameEl) nameEl.textContent = `"${banner.campaignName || banner.title}"`;

    confirmBtn.onclick = () => {
      draftData.promotionalBanners = draftData.promotionalBanners.filter(b => b.id !== id);
      draftData.promotionalBanners.forEach((b, i) => { b.order = i + 1; });
      closeModal('banner-delete-modal');
      markDirty();
      renderBannersModule();
      showToast('Banner deleted from draft.', 'info');
    };

    modal.classList.add('active');
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function resetBannersToDefault() {
    if (!confirm('Reset all promotional banners to factory default campaigns?')) return;
    if (window.MITTAI_DEFAULT_CMS && window.MITTAI_DEFAULT_CMS.promotionalBanners) {
      draftData.promotionalBanners = JSON.parse(JSON.stringify(window.MITTAI_DEFAULT_CMS.promotionalBanners));
      markDirty();
      renderBannersModule();
      showToast('Promotional banners reset to default campaigns.', 'success');
    }
  }

  async function handleBannerImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file (JPG, PNG, WebP).', 'error');
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      showToast('Image file size exceeds 12MB limit.', 'error');
      return;
    }

    showToast('Optimizing and uploading banner image...', 'info');

    try {
      let dataUrl = '';
      let sizeStr = (file.size / 1024).toFixed(1) + ' KB';

      if (window.MB_CLOUDINARY && typeof window.MB_CLOUDINARY.uploadFile === 'function') {
        const res = await window.MB_CLOUDINARY.uploadFile(file);
        if (res && res.secure_url) {
          dataUrl = res.secure_url;
          if (res.bytes) sizeStr = (res.bytes / 1024).toFixed(1) + ' KB';
        }
      }

      if (!dataUrl) {
        dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.onerror = () => reject(new Error('File read error'));
          reader.readAsDataURL(file);
        });
      }

      const input = document.getElementById('banner-field-image');
      const preview = document.getElementById('preview-banner-image');
      if (input) input.value = dataUrl;
      if (preview) preview.src = resolveAssetUrl(dataUrl);

      const assetId = 'asset-' + Date.now();
      const mediaItem = {
        id: assetId,
        name: file.name,
        url: dataUrl,
        type: 'image',
        tag: 'banners',
        size: sizeStr,
        usedInPage: 'Home',
        usedInSection: 'Promotional Banners',
        status: 'active',
        uploadedAt: new Date().toISOString()
      };
      mediaLibrary.unshift(mediaItem);
      draftData.media = mediaLibrary;

      showToast('Image optimized and set for banner!', 'success');
    } catch (err) {
      showToast('Banner image upload failed: ' + err.message, 'error');
    }
  }

  // ── 6. PAGE & SECTION CMS MODULE ───────────────────────────────────────────
  function switchPage(pageKey) {
    activePageKey = pageKey;
    document.querySelectorAll('.page-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === pageKey);
    });
    renderPagesModule();
  }

  function renderPagesModule() {
    const page = draftData.pages?.[activePageKey];
    if (!page) return;

    // Render Page SEO Form
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('page-seo-title', page.seo?.title || page.seo?.metaTitle);
    setVal('page-seo-desc', page.seo?.description || page.seo?.metaDescription);
    setVal('page-seo-keywords', page.seo?.keywords);
    setVal('page-seo-ogimg', page.seo?.ogImage);
    updateThumbPreview('page-seo-ogimg', 'preview-page-ogimg');

    const secListWrap = document.getElementById('page-sections-container');
    if (!secListWrap) return;

    // Special 404 Error Page Editor
    if (activePageKey === '404') {
      const hero = page.sections?.hero || {};
      const btn1 = hero.btnPrimary || { label: 'Back to Homepage', text: 'Back to Homepage', href: 'index.html', link: 'index.html' };
      const btn2 = hero.btnSecondary || { label: 'Contact Support', text: 'Contact Support', href: 'contact.html', link: 'contact.html' };
      secListWrap.innerHTML = `
        <div class="card" style="margin-top:1.5rem;">
          <div class="card-header">
            <div>
              <h3>404 Error Page Content</h3>
              <p>Customize the message and navigation buttons shown when a visitor reaches a missing route.</p>
            </div>
            <button class="btn btn-outline btn-sm" onclick="MB_CMS_ADMIN.openLivePreviewPage('404.html')">
              <i data-lucide="eye"></i>
              <span>Preview 404 Page</span>
            </button>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Error Code Display</label>
              <input class="form-input" type="text" id="404-error-code" value="${(hero.errorCode || '404').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Main Heading</label>
              <input class="form-input" type="text" id="404-heading" value="${(hero.heading || 'Oops! This Sweet Box Seems Empty').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Description Message</label>
              <textarea class="form-textarea" id="404-desc" rows="3">${hero.description || hero.subheading || ''}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Primary Button Label</label>
              <input class="form-input" type="text" id="404-btn1-text" value="${(btn1.label || btn1.text || 'Back to Homepage').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Primary Button Link</label>
              <input class="form-input" type="text" id="404-btn1-href" value="${(btn1.href || btn1.link || 'index.html').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Secondary Button Label</label>
              <input class="form-input" type="text" id="404-btn2-text" value="${(btn2.label || btn2.text || 'Contact Support').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Secondary Button Link</label>
              <input class="form-input" type="text" id="404-btn2-href" value="${(btn2.href || btn2.link || 'contact.html').replace(/"/g, '&quot;')}" />
            </div>
          </div>
          <div style="margin-top:1.25rem;">
            <button class="btn btn-primary" onclick="MB_CMS_ADMIN.save404Page()">
              <i data-lucide="check"></i>
              <span>Save 404 Page Content</span>
            </button>
          </div>
        </div>
      `;
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
      return;
    }

    if (!page.sectionOrder || !page.sections) {
      const heroSec = page.sections?.hero || {};
      const effDate = page.effectiveDate || heroSec.effectiveDate || '';
      const hdg = page.heading || heroSec.heading || '';
      const sub = page.subtitle || heroSec.subheading || '';
      const cnt = page.content || heroSec.contentHtml || '';
      secListWrap.innerHTML = `
        <div class="card" style="margin-top:1.5rem;">
          <div class="card-header">
            <div>
              <h3>Page Policy Content</h3>
              <p>Edit document heading, effective date, summary notice, and full HTML content.</p>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.switchModule('legal-docs'); MB_CMS_ADMIN.switchLegalDoc('${activePageKey}');">
              <i data-lucide="scale"></i>
              <span>Open Rich Text Editor</span>
            </button>
          </div>
          <div class="form-grid">
            <div class="form-group span-full">
              <label class="form-label">Effective Date</label>
              <input class="form-input" type="text" id="policy-effective-date" value="${effDate.replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Heading</label>
              <input class="form-input" type="text" id="policy-heading" value="${hdg.replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Subtitle / Notice</label>
              <textarea class="form-textarea" id="policy-subtitle" rows="2">${sub}</textarea>
            </div>
            <div class="form-group span-full">
              <label class="form-label">Full Document Content (HTML)</label>
              <textarea class="form-textarea" id="policy-full-content" rows="12" style="font-family:monospace; font-size:0.84rem;">${cnt}</textarea>
            </div>
          </div>
          <button class="btn btn-primary" style="margin-top:1rem;" onclick="MB_CMS_ADMIN.savePolicyPage()">Save Policy Changes</button>
        </div>
      `;
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
      return;
    }

    // Render Drag-and-Drop and Editable Section Cards
    secListWrap.innerHTML = `
      <div class="card" style="margin-top:1.5rem;">
        <div class="card-header">
          <div>
            <h3>Sections on this Page (${page.sectionOrder.length})</h3>
            <p>Drag or use arrows to reorder. Toggle switches to enable/disable sections without deleting content.</p>
          </div>
        </div>
        <div class="section-drag-list" id="section-drag-list">
          ${page.sectionOrder.map((secId, idx) => {
            const sec = page.sections[secId] || { name: secId, enabled: true };
            const isEnabled = sec.enabled !== false && sec.visible !== false;
            const eyebrowTxt = sec.eyebrow || sec.badge || '';
            const countInfo = Array.isArray(sec.cards) ? `${sec.cards.length} cards` : Array.isArray(sec.steps) ? `${sec.steps.length} steps` : Array.isArray(sec.items) ? `${sec.items.length} items` : Array.isArray(sec.pillars) ? `${sec.pillars.length} pillars` : '';
            return `
              <div class="section-drag-item ${isEnabled ? '' : 'disabled'}" data-secid="${secId}" data-secidx="${idx}" draggable="true">
                <div class="drag-item-left">
                  <span class="drag-handle" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
                  <div class="drag-item-title">
                    <h4>${sec.name || secId} <span class="badge ${isEnabled ? 'badge-success' : 'badge-danger'}" style="margin-left:0.5rem;">${isEnabled ? 'Enabled' : 'Disabled'}</span> ${countInfo ? `<span class="badge" style="background:#F1F5F9;color:#475569;margin-left:0.35rem;">${countInfo}</span>` : ''}</h4>
                    <p>ID: <code>#${secId}</code> ${eyebrowTxt ? '&bull; ' + eyebrowTxt : ''} ${sec.heading ? '&bull; <strong>' + sec.heading + '</strong>' : ''}</p>
                  </div>
                </div>
                <div class="drag-item-right">
                  <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.moveSection(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="Move Up">
                    <i data-lucide="arrow-up"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.moveSection(${idx}, 1)" ${idx === page.sectionOrder.length - 1 ? 'disabled' : ''} title="Move Down">
                    <i data-lucide="arrow-down"></i>
                  </button>
                  <label class="toggle-wrap" title="Toggle section visibility">
                    <input type="checkbox" class="toggle-hidden" onchange="MB_CMS_ADMIN.toggleSection('${secId}', this.checked)" ${isEnabled ? 'checked' : ''} />
                    <span class="toggle-switch"></span>
                  </label>
                  <button class="btn btn-outline btn-sm" onclick="MB_CMS_ADMIN.editSectionModal('${secId}')">
                    <i data-lucide="edit-3"></i>
                    <span>Edit</span>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    bindSectionDragAndDrop();

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function bindSectionDragAndDrop() {
    const listEl = document.getElementById('section-drag-list');
    if (!listEl) return;
    let draggedIdx = null;
    const items = listEl.querySelectorAll('.section-drag-item');
    items.forEach(item => {
      item.addEventListener('dragstart', e => {
        draggedIdx = parseInt(item.dataset.secidx, 10);
        item.style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.style.opacity = '';
        items.forEach(el => el.style.borderTop = '');
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.style.borderTop = '2px solid #E60046';
      });
      item.addEventListener('dragleave', () => {
        item.style.borderTop = '';
      });
      item.addEventListener('drop', e => {
        e.preventDefault();
        item.style.borderTop = '';
        const targetIdx = parseInt(item.dataset.secidx, 10);
        const page = draftData.pages?.[activePageKey];
        if (draggedIdx === null || isNaN(targetIdx) || draggedIdx === targetIdx || !page || !page.sectionOrder) return;
        const [moved] = page.sectionOrder.splice(draggedIdx, 1);
        page.sectionOrder.splice(targetIdx, 0, moved);
        draggedIdx = null;
        renderPagesModule();
        markDirty();
        showToast('Section order updated via drag & drop.', 'info');
      });
    });
  }

  function save404Page() {
    const page = draftData.pages?.['404'];
    if (!page) return;
    page.sections = page.sections || {};
    const hero = page.sections.hero = page.sections.hero || {};
    const getVal = id => document.getElementById(id)?.value?.trim() || '';

    hero.errorCode = getVal('404-error-code') || '404';
    hero.heading = getVal('404-heading') || 'Oops! This Sweet Box Seems Empty';
    hero.description = getVal('404-desc');
    hero.subheading = hero.description;
    hero.btnPrimary = {
      label: getVal('404-btn1-text') || 'Back to Homepage',
      text: getVal('404-btn1-text') || 'Back to Homepage',
      href: getVal('404-btn1-href') || 'index.html',
      link: getVal('404-btn1-href') || 'index.html'
    };
    hero.btnSecondary = {
      label: getVal('404-btn2-text') || 'Contact Support',
      text: getVal('404-btn2-text') || 'Contact Support',
      href: getVal('404-btn2-href') || 'contact.html',
      link: getVal('404-btn2-href') || 'contact.html'
    };

    markDirty();
    showToast('404 Error Page content saved to draft!', 'success');
  }

  function savePageSEO() {
    const page = draftData.pages?.[activePageKey];
    if (!page) return;

    page.seo = page.seo || {};
    const titleVal = document.getElementById('page-seo-title').value.trim();
    const descVal = document.getElementById('page-seo-desc').value.trim();
    page.seo.title = titleVal;
    page.seo.metaTitle = titleVal;
    page.seo.description = descVal;
    page.seo.metaDescription = descVal;
    page.seo.keywords = document.getElementById('page-seo-keywords').value.trim();
    page.seo.ogImage = document.getElementById('page-seo-ogimg').value.trim();

    markDirty();
    showToast(`SEO settings for ${activePageKey} saved.`, 'success');
  }

  function savePolicyPage() {
    const page = draftData.pages?.[activePageKey];
    if (!page) return;

    page.effectiveDate = document.getElementById('policy-effective-date')?.value?.trim() || '';
    page.heading = document.getElementById('policy-heading')?.value?.trim() || '';
    page.subtitle = document.getElementById('policy-subtitle')?.value?.trim() || '';
    const fullContentEl = document.getElementById('policy-full-content');
    if (fullContentEl) {
      page.content = fullContentEl.value;
    }

    page.sections = page.sections || {};
    page.sections.hero = page.sections.hero || {};
    page.sections.hero.effectiveDate = page.effectiveDate;
    page.sections.hero.heading = page.heading;
    page.sections.hero.subheading = page.subtitle;
    if (fullContentEl) page.sections.hero.contentHtml = page.content;

    // Also sync to draftData.legalDocuments
    draftData.legalDocuments = draftData.legalDocuments || {};
    if (draftData.legalDocuments[activePageKey]) {
      draftData.legalDocuments[activePageKey].effectiveDate = page.effectiveDate;
      draftData.legalDocuments[activePageKey].heading = page.heading;
      draftData.legalDocuments[activePageKey].title = page.heading;
      draftData.legalDocuments[activePageKey].subtitle = page.subtitle;
      if (fullContentEl) draftData.legalDocuments[activePageKey].content = page.content;
    }

    markDirty();
    showToast('Policy details updated.', 'success');
  }

  function moveSection(index, direction) {
    const page = draftData.pages?.[activePageKey];
    if (!page || !page.sectionOrder) return;
    const target = index + direction;
    if (target < 0 || target >= page.sectionOrder.length) return;

    const temp = page.sectionOrder[index];
    page.sectionOrder[index] = page.sectionOrder[target];
    page.sectionOrder[target] = temp;

    renderPagesModule();
    markDirty();
    showToast('Section order updated.', 'info');
  }

  function toggleSection(secId, enabled) {
    const page = draftData.pages?.[activePageKey];
    if (!page || !page.sections || !page.sections[secId]) return;

    page.sections[secId].enabled = enabled;
    page.sections[secId].visible = enabled;
    renderPagesModule();
    markDirty();
    showToast(`Section "${page.sections[secId].name || secId}" is now ${enabled ? 'Enabled' : 'Disabled'}.`, 'info');
  }

  // ── Section Edit Modal ─────────────────────────────────────────────────────
  function editSectionModal(secId) {
    const page = draftData.pages?.[activePageKey];
    if (!page || !page.sections || !page.sections[secId]) return;

    const sec = page.sections[secId];
    const modal = document.getElementById('section-edit-modal');
    const modalBody = document.getElementById('section-modal-body');
    const modalTitle = document.getElementById('section-modal-title');
    if (!modal || !modalBody) return;

    if (secId === 'vision') {
      sec.image = sec.image || sec.bgImage || 'assets/images/traditional_sweets.png';
      sec.paragraph1 = sec.paragraph1 || sec.p1 || "India's confectionery tradition is vast, diverse and deeply personal. Behind every sweet shop is a story of craftsmanship, recipes passed down across generations and dedication to taste.";
      sec.paragraph2 = sec.paragraph2 || sec.p2 || "MITTAI BANDI believes modern technology should not replace tradition — it should preserve and elevate it. By providing traditional confectioners with digital infrastructure, we aim to help keep cherished recipes alive and thriving for future generations.";
      if (sec.quote === undefined) sec.quote = 'Bridging timeless artisanal flavours with modern digital access across India.';
      if (sec.quoteCite === undefined) sec.quoteCite = 'MITTAI BANDI Core Philosophy';
    }

    modalTitle.textContent = `Edit Section: ${sec.name || secId} (#${secId})`;
    const pageLabel = activePageKey === 'home' ? 'Home' : activePageKey === 'about' ? 'About Us' : activePageKey === 'partner' ? 'Partner With Us' : 'Contact';
    const secLabel = `${sec.name || secId} (#${secId})`;

    // Determine if section has object cards, steps, items, or pillars
    const isStringItems = Array.isArray(sec.items) && sec.items.length > 0 && typeof sec.items[0] === 'string';
    const listKey = Array.isArray(sec.cards) ? 'cards' : Array.isArray(sec.steps) ? 'steps' : Array.isArray(sec.pillars) ? 'pillars' : (Array.isArray(sec.items) && !isStringItems) ? 'items' : null;
    const listArr = listKey ? sec[listKey] : [];

    const eyebrowVal = sec.eyebrow !== undefined ? sec.eyebrow : sec.badge;
    const descVal = sec.description !== undefined ? sec.description : sec.bodyText;
    const leadVal = sec.lead !== undefined ? sec.lead : sec.leadText;
    const p1Val = sec.paragraph1 !== undefined ? sec.paragraph1 : sec.p1;
    const p2Val = sec.paragraph2 !== undefined ? sec.paragraph2 : sec.p2;
    const p3Val = sec.paragraph3 !== undefined ? sec.paragraph3 : sec.p3;
    const bgImgVal = sec.bgImage !== undefined ? sec.bgImage : sec.bannerImage;

    modalBody.innerHTML = `
      <form id="edit-section-form" onsubmit="event.preventDefault(); MB_CMS_ADMIN.saveSectionModal('${secId}');">
        <div class="form-grid">
          <div class="form-group span-full">
            <label class="form-label">Section Display Name (Internal CMS)</label>
            <input class="form-input" type="text" id="sec-field-name" value="${(sec.name || '').replace(/"/g, '&quot;')}" />
          </div>

          ${eyebrowVal !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Eyebrow / Badge Text</label>
              <input class="form-input" type="text" id="sec-field-eyebrow" value="${(eyebrowVal || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.heading !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Heading</label>
              <input class="form-input" type="text" id="sec-field-heading" value="${(sec.heading || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.tagline !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Tagline</label>
              <input class="form-input" type="text" id="sec-field-tagline" value="${(sec.tagline || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.subheading !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Subheading</label>
              <textarea class="form-textarea" id="sec-field-subheading" rows="2">${sec.subheading || ''}</textarea>
            </div>
          ` : ''}

          ${descVal !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Description / Narrative Text</label>
              <textarea class="form-textarea" id="sec-field-desc" rows="3">${descVal || ''}</textarea>
            </div>
          ` : ''}

          ${leadVal !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Lead Paragraph</label>
              <textarea class="form-textarea" id="sec-field-lead" rows="2">${leadVal || ''}</textarea>
            </div>
          ` : ''}

          ${p1Val !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Paragraph 1</label>
              <textarea class="form-textarea" id="sec-field-p1" rows="2">${p1Val || ''}</textarea>
            </div>
          ` : ''}

          ${p2Val !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Paragraph 2</label>
              <textarea class="form-textarea" id="sec-field-p2" rows="2">${p2Val || ''}</textarea>
            </div>
          ` : ''}

          ${p3Val !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Paragraph 3</label>
              <textarea class="form-textarea" id="sec-field-p3" rows="2">${p3Val || ''}</textarea>
            </div>
          ` : ''}

          ${sec.quote !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Quote Text</label>
              <textarea class="form-textarea" id="sec-field-quote" rows="2">${sec.quote || ''}</textarea>
            </div>
          ` : ''}

          ${sec.quoteCite !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Quote Attribution</label>
              <input class="form-input" type="text" id="sec-field-quotecite" value="${(sec.quoteCite || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${isStringItems ? `
            <div class="form-group span-full">
              <label class="form-label">Marquee / Ticker Items (One item per line)</label>
              <textarea class="form-textarea" id="sec-field-string-items" rows="6">${sec.items.join('\n')}</textarea>
            </div>
          ` : ''}

          ${Array.isArray(sec.features) ? `
            <div class="form-group span-full">
              <label class="form-label">Key Features List (One feature per line)</label>
              <textarea class="form-textarea" id="sec-field-features" rows="5">${sec.features.join('\n')}</textarea>
            </div>
          ` : ''}

          ${sec.visionTitle !== undefined ? `
            <div class="form-group">
              <label class="form-label">Vision Card Title</label>
              <input class="form-input" type="text" id="sec-field-vision-title" value="${(sec.visionTitle || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Mission Card Title</label>
              <input class="form-input" type="text" id="sec-field-mission-title" value="${(sec.missionTitle || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Vision Statement</label>
              <textarea class="form-textarea" id="sec-field-vision-text" rows="2">${sec.visionText || ''}</textarea>
            </div>
            <div class="form-group span-full">
              <label class="form-label">Mission Statement</label>
              <textarea class="form-textarea" id="sec-field-mission-text" rows="2">${sec.missionText || ''}</textarea>
            </div>
          ` : ''}

          ${sec.customerTitle !== undefined ? `
            <div class="form-group">
              <label class="form-label">Customer Column Title</label>
              <input class="form-input" type="text" id="sec-field-cust-title" value="${(sec.customerTitle || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Vendor Column Title</label>
              <input class="form-input" type="text" id="sec-field-vend-title" value="${(sec.vendorTitle || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Customer Benefits (One per line)</label>
              <textarea class="form-textarea" id="sec-field-cust-items" rows="4">${(sec.customerItems || []).join('\n')}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Customer Button Label</label>
              <input class="form-input" type="text" id="sec-field-cust-btn-label" value="${(sec.customerBtnLabel || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Customer Button Link</label>
              <input class="form-input" type="text" id="sec-field-cust-btn-href" value="${(sec.customerBtnHref || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Vendor Benefits (One per line)</label>
              <textarea class="form-textarea" id="sec-field-vend-items" rows="4">${(sec.vendorItems || []).join('\n')}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Vendor Button Label</label>
              <input class="form-input" type="text" id="sec-field-vend-btn-label" value="${(sec.vendorBtnLabel || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Vendor Button Link</label>
              <input class="form-input" type="text" id="sec-field-vend-btn-href" value="${(sec.vendorBtnHref || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.officerName !== undefined ? `
            <div class="form-group">
              <label class="form-label">Grievance Officer Name</label>
              <input class="form-input" type="text" id="sec-field-officer-name" value="${(sec.officerName || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Designation</label>
              <input class="form-input" type="text" id="sec-field-officer-role" value="${(sec.designation || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Company Name</label>
              <input class="form-input" type="text" id="sec-field-company-name" value="${(sec.companyName || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Grievance Email</label>
              <input class="form-input" type="text" id="sec-field-officer-email" value="${(sec.officerEmail || sec.email || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Grievance Phone</label>
              <input class="form-input" type="text" id="sec-field-officer-phone" value="${(sec.officerPhone || sec.phone || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Operating Hours</label>
              <input class="form-input" type="text" id="sec-field-officer-hours" value="${(sec.hours || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Registered Office Address</label>
              <input class="form-input" type="text" id="sec-field-officer-address" value="${(sec.address || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Escalation Note</label>
              <textarea class="form-textarea" id="sec-field-escalation-note" rows="2">${sec.escalationNote || ''}</textarea>
            </div>
          ` : ''}

          ${sec.legalName !== undefined ? `
            <div class="form-group">
              <label class="form-label">Corporate Legal Name</label>
              <input class="form-input" type="text" id="sec-field-legal-name" value="${(sec.legalName || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">CIN</label>
              <input class="form-input" type="text" id="sec-field-cin" value="${(sec.cin || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">GSTIN</label>
              <input class="form-input" type="text" id="sec-field-gstin" value="${(sec.gstin || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Corporate Email</label>
              <input class="form-input" type="text" id="sec-field-corp-email" value="${(sec.email || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Corporate Phone</label>
              <input class="form-input" type="text" id="sec-field-corp-phone" value="${(sec.phone || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group span-full">
              <label class="form-label">Registered Address</label>
              <input class="form-input" type="text" id="sec-field-corp-address" value="${(sec.registeredAddress || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.email !== undefined && sec.officerName === undefined && sec.legalName === undefined ? `
            <div class="form-group">
              <label class="form-label">Contact Email</label>
              <input class="form-input" type="text" id="sec-field-contact-email" value="${(sec.email || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Contact Phone</label>
              <input class="form-input" type="text" id="sec-field-contact-phone" value="${(sec.phone || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Location / Address</label>
              <input class="form-input" type="text" id="sec-field-contact-address" value="${(sec.address || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Submit Button Label</label>
              <input class="form-input" type="text" id="sec-field-submit-label" value="${(sec.submitBtnLabel || 'Send Message').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.googlePlayUrl !== undefined || sec.playStoreUrl !== undefined ? `
            <div class="form-group">
              <label class="form-label">Google Play Store URL (Android)</label>
              <input class="form-input" type="text" id="sec-field-playurl" value="${(sec.googlePlayUrl || sec.playStoreUrl || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.appStoreUrl !== undefined ? `
            <div class="form-group">
              <label class="form-label">Apple App Store URL (iOS)</label>
              <input class="form-input" type="text" id="sec-field-appleurl" value="${(sec.appStoreUrl || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.registerBtnText !== undefined || sec.ctaLabel !== undefined ? `
            <div class="form-group">
              <label class="form-label">Registration / Action Button Text</label>
              <input class="form-input" type="text" id="sec-field-regtext" value="${(sec.registerBtnText || sec.ctaLabel || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Registration / Action Button Link</label>
              <input class="form-input" type="text" id="sec-field-regurl" value="${(sec.registerBtnUrl || sec.ctaHref || '#partner-form').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.image !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Section Featured Image</label>
              <div class="image-picker-field">
                <img src="${resolveAssetUrl(sec.image)}" id="preview-sec-image" class="image-preview-thumb" style="width:110px; height:70px; object-fit:cover;" />
                <div class="image-picker-actions" style="flex:1;">
                  <input class="form-input" type="text" id="sec-field-image" value="${sec.image || ''}" oninput="MB_CMS_ADMIN.updateThumbPreview('sec-field-image', 'preview-sec-image')" />
                  <div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
                    <button type="button" class="btn btn-primary btn-sm" onclick="MB_CMS_ADMIN.openUploadModalForField('sec-field-image', 'preview-sec-image', '${pageLabel}', '${secLabel}')">
                      <i data-lucide="upload"></i>
                      <span>Upload New Image</span>
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.openMediaPicker('sec-field-image', 'preview-sec-image')">
                      <i data-lucide="images"></i>
                      <span>Choose from Media Library</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}

          ${bgImgVal !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">Background Banner Image</label>
              <div class="image-picker-field">
                <img src="${resolveAssetUrl(bgImgVal)}" id="preview-sec-bgimage" class="image-preview-thumb" style="width:110px; height:70px; object-fit:cover;" />
                <div class="image-picker-actions" style="flex:1;">
                  <input class="form-input" type="text" id="sec-field-bgimage" value="${bgImgVal || ''}" oninput="MB_CMS_ADMIN.updateThumbPreview('sec-field-bgimage', 'preview-sec-bgimage')" />
                  <div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
                    <button type="button" class="btn btn-primary btn-sm" onclick="MB_CMS_ADMIN.openUploadModalForField('sec-field-bgimage', 'preview-sec-bgimage', '${pageLabel}', '${secLabel}')">
                      <i data-lucide="upload"></i>
                      <span>Upload New Image</span>
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.openMediaPicker('sec-field-bgimage', 'preview-sec-bgimage')">
                      <i data-lucide="images"></i>
                      <span>Choose from Media Library</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}

          ${sec.mockupHeroImage !== undefined ? `
            <div class="form-group span-full">
              <label class="form-label">App Mockup Hero Image</label>
              <div class="image-picker-field">
                <img src="${resolveAssetUrl(sec.mockupHeroImage)}" id="preview-sec-mockup-hero" class="image-preview-thumb" style="width:90px; height:60px; object-fit:cover;" />
                <div class="image-picker-actions" style="flex:1;">
                  <input class="form-input" type="text" id="sec-field-mockup-hero" value="${sec.mockupHeroImage || ''}" oninput="MB_CMS_ADMIN.updateThumbPreview('sec-field-mockup-hero', 'preview-sec-mockup-hero')" />
                  <div style="display:flex; gap:0.4rem; margin-top:0.35rem;">
                    <button type="button" class="btn btn-primary btn-sm" onclick="MB_CMS_ADMIN.openUploadModalForField('sec-field-mockup-hero', 'preview-sec-mockup-hero', '${pageLabel}', '${secLabel}')">Upload</button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.openMediaPicker('sec-field-mockup-hero', 'preview-sec-mockup-hero')">Library</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">App Mockup Card 1 Image</label>
              <input class="form-input" type="text" id="sec-field-mockup-card1" value="${sec.mockupCard1Image || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">App Mockup Card 2 Image</label>
              <input class="form-input" type="text" id="sec-field-mockup-card2" value="${sec.mockupCard2Image || ''}" />
            </div>
          ` : ''}

          ${sec.videoUrl !== undefined ? `
            <div class="form-group">
              <label class="form-label">Background Video URL (MP4)</label>
              <input class="form-input" type="text" id="sec-field-video" value="${sec.videoUrl || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">YouTube Video ID (Optional)</label>
              <input class="form-input" type="text" id="sec-field-videoid" value="${sec.videoId || ''}" />
            </div>
          ` : ''}

          ${sec.btnPrimary ? `
            <div class="form-group">
              <label class="form-label">Primary Button Text</label>
              <input class="form-input" type="text" id="sec-btn1-text" value="${(sec.btnPrimary.text || sec.btnPrimary.label || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Primary Button Link</label>
              <input class="form-input" type="text" id="sec-btn1-link" value="${(sec.btnPrimary.link || sec.btnPrimary.href || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.btnSecondary ? `
            <div class="form-group">
              <label class="form-label">Secondary Button Text</label>
              <input class="form-input" type="text" id="sec-btn2-text" value="${(sec.btnSecondary.text || sec.btnSecondary.label || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Secondary Button Link</label>
              <input class="form-input" type="text" id="sec-btn2-link" value="${(sec.btnSecondary.link || sec.btnSecondary.href || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${sec.button ? `
            <div class="form-group">
              <label class="form-label">Action Button Text</label>
              <input class="form-input" type="text" id="sec-btn-text" value="${(sec.button.text || sec.button.label || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Action Button Link</label>
              <input class="form-input" type="text" id="sec-btn-link" value="${(sec.button.link || sec.button.href || '').replace(/"/g, '&quot;')}" />
            </div>
          ` : ''}

          ${listKey ? `
            <div class="form-group span-full" style="border-top:1px solid #E5E7EB; padding-top:1rem; margin-top:0.5rem;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                <h4 style="margin:0; color:#111827;">Section Cards / Items (${listArr.length})</h4>
                <button type="button" class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.addSectionItem('${secId}', '${listKey}')">
                  <i data-lucide="plus"></i>
                  <span>Add Item</span>
                </button>
              </div>
              <div style="display:flex; flex-direction:column; gap:0.85rem;">
                ${listArr.map((item, cIdx) => `
                  <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:0.9rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                      <div style="font-weight:700; font-size:0.82rem; color:#C9003D;">Item #${cIdx + 1} ${item.title || item.question ? '— ' + (item.title || item.question) : ''}</div>
                      <div style="display:flex; gap:0.25rem;">
                        <button type="button" class="btn btn-secondary btn-sm" style="padding:2px 6px;" onclick="MB_CMS_ADMIN.moveSectionItem('${secId}', '${listKey}', ${cIdx}, -1)" ${cIdx === 0 ? 'disabled' : ''} title="Move Up"><i data-lucide="arrow-up" style="width:12px;height:12px;"></i></button>
                        <button type="button" class="btn btn-secondary btn-sm" style="padding:2px 6px;" onclick="MB_CMS_ADMIN.moveSectionItem('${secId}', '${listKey}', ${cIdx}, 1)" ${cIdx === listArr.length - 1 ? 'disabled' : ''} title="Move Down"><i data-lucide="arrow-down" style="width:12px;height:12px;"></i></button>
                        <button type="button" class="btn btn-danger btn-sm" style="padding:2px 6px;" onclick="MB_CMS_ADMIN.deleteSectionItem('${secId}', '${listKey}', ${cIdx})" title="Delete Item"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
                      </div>
                    </div>
                    <div class="form-grid">
                      ${item.title !== undefined ? `
                        <div class="form-group ${item.badge !== undefined || item.tag !== undefined || item.region !== undefined || item.number !== undefined ? '' : 'span-full'}">
                          <label class="form-label">Title</label>
                          <input class="form-input" type="text" id="sec-item-title-${cIdx}" value="${(item.title || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.number !== undefined ? `
                        <div class="form-group">
                          <label class="form-label">Step Number</label>
                          <input class="form-input" type="text" id="sec-item-number-${cIdx}" value="${(item.number || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.subtitle !== undefined ? `
                        <div class="form-group span-full">
                          <label class="form-label">Subtitle</label>
                          <input class="form-input" type="text" id="sec-item-subtitle-${cIdx}" value="${(item.subtitle || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.question !== undefined ? `
                        <div class="form-group span-full">
                          <label class="form-label">Question</label>
                          <input class="form-input" type="text" id="sec-item-q-${cIdx}" value="${(item.question || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.badge !== undefined || item.tag !== undefined ? `
                        <div class="form-group">
                          <label class="form-label">Badge / Tag</label>
                          <input class="form-input" type="text" id="sec-item-badge-${cIdx}" value="${(item.badge || item.tag || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.region !== undefined ? `
                        <div class="form-group">
                          <label class="form-label">Region</label>
                          <input class="form-input" type="text" id="sec-item-region-${cIdx}" value="${(item.region || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.email !== undefined ? `
                        <div class="form-group">
                          <label class="form-label">Email</label>
                          <input class="form-input" type="text" id="sec-item-email-${cIdx}" value="${(item.email || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.phone !== undefined ? `
                        <div class="form-group">
                          <label class="form-label">Phone</label>
                          <input class="form-input" type="text" id="sec-item-phone-${cIdx}" value="${(item.phone || '').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${Array.isArray(item.tags) ? `
                        <div class="form-group span-full">
                          <label class="form-label">Tags (Comma-separated)</label>
                          <input class="form-input" type="text" id="sec-item-tags-${cIdx}" value="${item.tags.join(', ').replace(/"/g, '&quot;')}" />
                        </div>
                      ` : ''}
                      ${item.description !== undefined ? `
                        <div class="form-group span-full">
                          <label class="form-label">Description</label>
                          <textarea class="form-textarea" id="sec-item-desc-${cIdx}" rows="2">${item.description || ''}</textarea>
                        </div>
                      ` : ''}
                      ${item.answer !== undefined ? `
                        <div class="form-group span-full">
                          <label class="form-label">Answer</label>
                          <textarea class="form-textarea" id="sec-item-ans-${cIdx}" rows="2">${item.answer || ''}</textarea>
                        </div>
                      ` : ''}
                      ${item.image !== undefined ? `
                        <div class="form-group span-full">
                          <label class="form-label">Card Image</label>
                          <div class="image-picker-field">
                            <img src="${resolveAssetUrl(item.image)}" id="preview-sec-item-img-${cIdx}" class="image-preview-thumb" style="width:76px; height:54px; object-fit:cover;" />
                            <div class="image-picker-actions" style="flex:1;">
                              <input class="form-input" type="text" id="sec-item-img-${cIdx}" value="${item.image || ''}" oninput="MB_CMS_ADMIN.updateThumbPreview('sec-item-img-${cIdx}', 'preview-sec-item-img-${cIdx}')" />
                              <div style="display:flex; gap:0.4rem; margin-top:0.35rem;">
                                <button type="button" class="btn btn-primary btn-sm" onclick="MB_CMS_ADMIN.openUploadModalForField('sec-item-img-${cIdx}', 'preview-sec-item-img-${cIdx}', '${pageLabel}', '${secLabel}')">Upload</button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.openMediaPicker('sec-item-img-${cIdx}', 'preview-sec-item-img-${cIdx}')">Library</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </form>
    `;

    modal.classList.add('active');
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function syncModalDOMToSection(secId) {
    const page = draftData.pages?.[activePageKey];
    if (!page || !page.sections || !page.sections[secId]) return null;
    const sec = page.sections[secId];
    const getVal = id => document.getElementById(id)?.value?.trim();

    if (getVal('sec-field-name') !== undefined) sec.name = getVal('sec-field-name');
    if (getVal('sec-field-eyebrow') !== undefined) {
      sec.eyebrow = getVal('sec-field-eyebrow');
      sec.badge = sec.eyebrow;
    }
    if (getVal('sec-field-heading') !== undefined) sec.heading = getVal('sec-field-heading');
    if (getVal('sec-field-tagline') !== undefined) sec.tagline = getVal('sec-field-tagline');
    if (getVal('sec-field-subheading') !== undefined) sec.subheading = getVal('sec-field-subheading');
    if (getVal('sec-field-desc') !== undefined) {
      sec.description = getVal('sec-field-desc');
      if (sec.bodyText !== undefined) sec.bodyText = sec.description;
    }
    if (getVal('sec-field-lead') !== undefined) {
      sec.lead = getVal('sec-field-lead');
      sec.leadText = sec.lead;
    }
    if (getVal('sec-field-p1') !== undefined) {
      sec.paragraph1 = getVal('sec-field-p1');
      sec.p1 = sec.paragraph1;
    }
    if (getVal('sec-field-p2') !== undefined) {
      sec.paragraph2 = getVal('sec-field-p2');
      sec.p2 = sec.paragraph2;
    }
    if (getVal('sec-field-p3') !== undefined) {
      sec.paragraph3 = getVal('sec-field-p3');
      sec.p3 = sec.paragraph3;
    }
    if (getVal('sec-field-quote') !== undefined) sec.quote = getVal('sec-field-quote');
    if (getVal('sec-field-quotecite') !== undefined) sec.quoteCite = getVal('sec-field-quotecite');
    if (getVal('sec-field-image') !== undefined) sec.image = getVal('sec-field-image');
    if (getVal('sec-field-bgimage') !== undefined) {
      sec.bgImage = getVal('sec-field-bgimage');
      if (sec.bannerImage !== undefined) sec.bannerImage = sec.bgImage;
    }
    if (getVal('sec-field-mockup-hero') !== undefined) sec.mockupHeroImage = getVal('sec-field-mockup-hero');
    if (getVal('sec-field-mockup-card1') !== undefined) sec.mockupCard1Image = getVal('sec-field-mockup-card1');
    if (getVal('sec-field-mockup-card2') !== undefined) sec.mockupCard2Image = getVal('sec-field-mockup-card2');
    if (getVal('sec-field-video') !== undefined) sec.videoUrl = getVal('sec-field-video');
    if (getVal('sec-field-videoid') !== undefined) sec.videoId = getVal('sec-field-videoid');

    if (document.getElementById('sec-field-string-items')) {
      sec.items = document.getElementById('sec-field-string-items').value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
    }

    if (document.getElementById('sec-field-features')) {
      sec.features = document.getElementById('sec-field-features').value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
    }

    if (getVal('sec-field-vision-title') !== undefined) sec.visionTitle = getVal('sec-field-vision-title');
    if (getVal('sec-field-vision-text') !== undefined) sec.visionText = getVal('sec-field-vision-text');
    if (getVal('sec-field-mission-title') !== undefined) sec.missionTitle = getVal('sec-field-mission-title');
    if (getVal('sec-field-mission-text') !== undefined) sec.missionText = getVal('sec-field-mission-text');

    if (getVal('sec-field-cust-title') !== undefined) sec.customerTitle = getVal('sec-field-cust-title');
    if (getVal('sec-field-vend-title') !== undefined) sec.vendorTitle = getVal('sec-field-vend-title');
    if (document.getElementById('sec-field-cust-items')) {
      sec.customerItems = document.getElementById('sec-field-cust-items').value.split('\n').map(s => s.trim()).filter(Boolean);
    }
    if (document.getElementById('sec-field-vend-items')) {
      sec.vendorItems = document.getElementById('sec-field-vend-items').value.split('\n').map(s => s.trim()).filter(Boolean);
    }
    if (getVal('sec-field-cust-btn-label') !== undefined) sec.customerBtnLabel = getVal('sec-field-cust-btn-label');
    if (getVal('sec-field-cust-btn-href') !== undefined) sec.customerBtnHref = getVal('sec-field-cust-btn-href');
    if (getVal('sec-field-vend-btn-label') !== undefined) sec.vendorBtnLabel = getVal('sec-field-vend-btn-label');
    if (getVal('sec-field-vend-btn-href') !== undefined) sec.vendorBtnHref = getVal('sec-field-vend-btn-href');

    if (getVal('sec-field-officer-name') !== undefined) sec.officerName = getVal('sec-field-officer-name');
    if (getVal('sec-field-officer-role') !== undefined) sec.designation = getVal('sec-field-officer-role');
    if (getVal('sec-field-company-name') !== undefined) sec.companyName = getVal('sec-field-company-name');
    if (getVal('sec-field-officer-email') !== undefined) {
      sec.officerEmail = getVal('sec-field-officer-email');
      sec.email = sec.officerEmail;
    }
    if (getVal('sec-field-officer-phone') !== undefined) {
      sec.officerPhone = getVal('sec-field-officer-phone');
      sec.phone = sec.officerPhone;
    }
    if (getVal('sec-field-officer-hours') !== undefined) sec.hours = getVal('sec-field-officer-hours');
    if (getVal('sec-field-officer-address') !== undefined) sec.address = getVal('sec-field-officer-address');
    if (getVal('sec-field-escalation-note') !== undefined) sec.escalationNote = getVal('sec-field-escalation-note');

    if (getVal('sec-field-legal-name') !== undefined) sec.legalName = getVal('sec-field-legal-name');
    if (getVal('sec-field-cin') !== undefined) sec.cin = getVal('sec-field-cin');
    if (getVal('sec-field-gstin') !== undefined) sec.gstin = getVal('sec-field-gstin');
    if (getVal('sec-field-corp-email') !== undefined) sec.email = getVal('sec-field-corp-email');
    if (getVal('sec-field-corp-phone') !== undefined) sec.phone = getVal('sec-field-corp-phone');
    if (getVal('sec-field-corp-address') !== undefined) sec.registeredAddress = getVal('sec-field-corp-address');

    if (getVal('sec-field-contact-email') !== undefined) sec.email = getVal('sec-field-contact-email');
    if (getVal('sec-field-contact-phone') !== undefined) sec.phone = getVal('sec-field-contact-phone');
    if (getVal('sec-field-contact-address') !== undefined) sec.address = getVal('sec-field-contact-address');
    if (getVal('sec-field-submit-label') !== undefined) sec.submitBtnLabel = getVal('sec-field-submit-label');

    if (getVal('sec-field-playurl') !== undefined) {
      sec.googlePlayUrl = getVal('sec-field-playurl');
      sec.playStoreUrl = sec.googlePlayUrl;
    }
    if (getVal('sec-field-appleurl') !== undefined) sec.appStoreUrl = getVal('sec-field-appleurl');
    if (getVal('sec-field-regtext') !== undefined) {
      sec.registerBtnText = getVal('sec-field-regtext');
      sec.ctaLabel = sec.registerBtnText;
    }
    if (getVal('sec-field-regurl') !== undefined) {
      sec.registerBtnUrl = getVal('sec-field-regurl');
      sec.ctaHref = sec.registerBtnUrl;
    }

    if (sec.btnPrimary) {
      const t1 = getVal('sec-btn1-text') || sec.btnPrimary.text || sec.btnPrimary.label;
      const l1 = getVal('sec-btn1-link') || sec.btnPrimary.link || sec.btnPrimary.href;
      sec.btnPrimary.text = t1;
      sec.btnPrimary.label = t1;
      sec.btnPrimary.link = l1;
      sec.btnPrimary.href = l1;
    }
    if (sec.btnSecondary) {
      const t2 = getVal('sec-btn2-text') || sec.btnSecondary.text || sec.btnSecondary.label;
      const l2 = getVal('sec-btn2-link') || sec.btnSecondary.link || sec.btnSecondary.href;
      sec.btnSecondary.text = t2;
      sec.btnSecondary.label = t2;
      sec.btnSecondary.link = l2;
      sec.btnSecondary.href = l2;
    }
    if (sec.button) {
      const tb = getVal('sec-btn-text') || sec.button.text || sec.button.label;
      const lb = getVal('sec-btn-link') || sec.button.link || sec.button.href;
      sec.button.text = tb;
      sec.button.label = tb;
      sec.button.link = lb;
      sec.button.href = lb;
    }

    const isStringItems = Array.isArray(sec.items) && sec.items.length > 0 && typeof sec.items[0] === 'string';
    const listKey = Array.isArray(sec.cards) ? 'cards' : Array.isArray(sec.steps) ? 'steps' : Array.isArray(sec.pillars) ? 'pillars' : (Array.isArray(sec.items) && !isStringItems) ? 'items' : null;
    if (listKey && Array.isArray(sec[listKey])) {
      sec[listKey].forEach((item, cIdx) => {
        if (getVal(`sec-item-title-${cIdx}`) !== undefined) item.title = getVal(`sec-item-title-${cIdx}`);
        if (getVal(`sec-item-number-${cIdx}`) !== undefined) item.number = getVal(`sec-item-number-${cIdx}`);
        if (getVal(`sec-item-subtitle-${cIdx}`) !== undefined) item.subtitle = getVal(`sec-item-subtitle-${cIdx}`);
        if (getVal(`sec-item-q-${cIdx}`) !== undefined) item.question = getVal(`sec-item-q-${cIdx}`);
        if (getVal(`sec-item-badge-${cIdx}`) !== undefined) {
          item.badge = getVal(`sec-item-badge-${cIdx}`);
          if (item.tag !== undefined) item.tag = item.badge;
        }
        if (getVal(`sec-item-region-${cIdx}`) !== undefined) item.region = getVal(`sec-item-region-${cIdx}`);
        if (getVal(`sec-item-email-${cIdx}`) !== undefined) item.email = getVal(`sec-item-email-${cIdx}`);
        if (getVal(`sec-item-phone-${cIdx}`) !== undefined) item.phone = getVal(`sec-item-phone-${cIdx}`);
        if (getVal(`sec-item-tags-${cIdx}`) !== undefined) {
          item.tags = getVal(`sec-item-tags-${cIdx}`).split(',').map(s => s.trim()).filter(Boolean);
        }
        if (getVal(`sec-item-desc-${cIdx}`) !== undefined) item.description = getVal(`sec-item-desc-${cIdx}`);
        if (getVal(`sec-item-ans-${cIdx}`) !== undefined) item.answer = getVal(`sec-item-ans-${cIdx}`);
        if (getVal(`sec-item-img-${cIdx}`) !== undefined) item.image = getVal(`sec-item-img-${cIdx}`);
      });
    }
    return sec;
  }

  function addSectionItem(secId, listKey) {
    const sec = syncModalDOMToSection(secId);
    if (!sec || !Array.isArray(sec[listKey])) return;
    const sample = sec[listKey][0] || { title: '', description: '' };
    const newItem = {};
    Object.keys(sample).forEach(k => {
      if (k === 'id') newItem[k] = 'item-' + Date.now();
      else if (Array.isArray(sample[k])) newItem[k] = [];
      else if (k === 'image') newItem[k] = sample[k] || 'assets/images/logo.png';
      else if (k === 'title') newItem[k] = 'New Item';
      else if (k === 'question') newItem[k] = 'New Question?';
      else newItem[k] = '';
    });
    sec[listKey].push(newItem);
    editSectionModal(secId);
    markDirty();
  }

  function moveSectionItem(secId, listKey, idx, dir) {
    const sec = syncModalDOMToSection(secId);
    if (!sec || !Array.isArray(sec[listKey])) return;
    const target = idx + dir;
    if (target < 0 || target >= sec[listKey].length) return;
    const tmp = sec[listKey][idx];
    sec[listKey][idx] = sec[listKey][target];
    sec[listKey][target] = tmp;
    editSectionModal(secId);
    markDirty();
  }

  function deleteSectionItem(secId, listKey, idx) {
    const sec = syncModalDOMToSection(secId);
    if (!sec || !Array.isArray(sec[listKey])) return;
    if (sec[listKey].length <= 1) {
      showToast('At least one item must remain in this section.', 'error');
      return;
    }
    sec[listKey].splice(idx, 1);
    editSectionModal(secId);
    markDirty();
  }

  function saveSectionModal(secId) {
    const sec = syncModalDOMToSection(secId);
    if (!sec) return;
    closeModal('section-edit-modal');
    renderPagesModule();
    markDirty();
    showToast(`Section "${sec.name || secId}" updated.`, 'success');
  }

  // ── 7. CENTRALIZED MEDIA LIBRARY MODULE ─────────────────────────────────────
  let activeMediaFilter = 'all';

  function renderMediaModule() {
    renderMediaFilterPills();
    renderMediaGrid();
  }

  function renderMediaFilterPills() {
    const container = document.getElementById('media-filter-pills');
    if (!container) return;

    const filters = [
      { id: 'all', label: 'All Assets' },
      { id: 'logos', label: 'Logos & Icons' },
      { id: 'banners', label: 'Banners & Backgrounds' },
      { id: 'sweets', label: 'Sweets & Products' },
      { id: 'videos', label: 'Videos' }
    ];

    container.innerHTML = filters.map(f => `
      <button class="filter-pill ${activeMediaFilter === f.id ? 'active' : ''}" onclick="MB_CMS_ADMIN.filterMedia('${f.id}')">
        ${f.label}
      </button>
    `).join('');
  }

  function filterMedia(tag) {
    activeMediaFilter = tag;
    renderMediaFilterPills();
    renderMediaGrid();
  }

  function renderMediaGrid() {
    const grid = document.getElementById('media-grid-container');
    if (!grid) return;

    const filtered = activeMediaFilter === 'all'
      ? mediaLibrary
      : mediaLibrary.filter(m => m.tag === activeMediaFilter);

    if (!filtered.length) {
      grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem; color:var(--text-faint);">No media assets in this category.</div>`;
      return;
    }

    grid.innerHTML = filtered.map(item => `
      <div class="media-item-card">
        <div class="media-thumb-wrap" onclick="MB_CMS_ADMIN.openImageLightbox('${item.id}')" style="cursor:pointer;" title="Click to Preview">
          ${item.type === 'video'
            ? `<video class="media-thumb" src="${resolveAssetUrl(item.url)}" muted></video>`
            : `<img class="media-thumb" src="${resolveAssetUrl(item.url)}" alt="${item.name}" loading="lazy" />`
          }
          <span class="media-type-badge">${item.type}</span>
        </div>
        <div class="media-meta">
          <h5 title="${item.name}">${item.name}</h5>
          <p>${item.usedInPage || 'Website'} &bull; ${item.usedInSection || item.tag || 'General'}</p>
          <div class="media-actions" style="flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" style="flex:1;" onclick="MB_CMS_ADMIN.openReplaceImageModal('${item.id}')" title="Replace Asset">
              <i data-lucide="refresh-cw"></i>
              <span>Replace</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.openEditImageDetailsModal('${item.id}')" title="Edit Details">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.copyToClipboard('${item.url}')" title="Copy URL">
              <i data-lucide="copy"></i>
            </button>
            <button class="btn btn-danger btn-sm" onclick="MB_CMS_ADMIN.deleteMediaItem('${item.id}')" title="Delete Asset">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  async function handleMediaUpload(files) {
    if (!files || !files.length) return;
    const file = files[0];

    showToast(`Processing "${file.name}"...`, 'info');

    // 1. Try Cloudinary unsigned upload if configured
    try {
      if (window.MB_Cloudinary && window.MB_Cloudinary.uploadFile) {
        const uploadRes = await window.MB_Cloudinary.uploadFile(file);
        if (uploadRes && uploadRes.secure_url) {
          addMediaToLibrary({
            id: 'med-' + Date.now(),
            name: file.name,
            url: uploadRes.secure_url,
            type: file.type.startsWith('video') ? 'video' : 'image',
            tag: determineMediaTag(file.name),
            size: formatBytes(file.size),
            uploadedAt: new Date().toISOString()
          });
          showToast(`Uploaded to Cloudinary CDN: ${file.name}`, 'success');
          return;
        }
      }
    } catch (e) {
      console.warn('[Media] Cloudinary direct upload failed, storing locally:', e);
    }

    // 2. Reliable Data URL / Base64 fallback (guarantees upload ALWAYS works!)
    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      addMediaToLibrary({
        id: 'med-' + Date.now(),
        name: file.name,
        url: dataUrl,
        type: file.type.startsWith('video') ? 'video' : 'image',
        tag: determineMediaTag(file.name),
        size: formatBytes(file.size),
        uploadedAt: new Date().toISOString()
      });
      showToast(`Asset added to Media Library: ${file.name}`, 'success');
    };
    reader.readAsDataURL(file);
  }

  function addMediaToLibrary(item) {
    mediaLibrary.unshift(item);
    draftData.media = mediaLibrary;
    markDirty();
    renderMediaGrid();
    renderQuickStats();
    logActivity('MEDIA_UPLOAD', `Uploaded media asset: ${item.name}`);
  }

  function addMediaByUrl() {
    const url = prompt('Enter direct image or video URL:');
    if (!url) return;
    const name = prompt('Enter asset display name:', url.split('/').pop().split('?')[0] || 'Web Asset');

    addMediaToLibrary({
      id: 'med-' + Date.now(),
      name: name || 'External Asset',
      url: url.trim(),
      type: url.includes('.mp4') ? 'video' : 'image',
      tag: 'banners',
      size: 'External',
      uploadedAt: new Date().toISOString()
    });
  }

  function deleteMediaItem(id) {
    const idx = mediaLibrary.findIndex(m => m.id === id);
    if (idx === -1) return;
    if (!confirm(`Are you sure you want to delete "${mediaLibrary[idx].name}"?`)) return;

    const removed = mediaLibrary.splice(idx, 1)[0];
    draftData.media = mediaLibrary;
    markDirty();
    renderMediaGrid();
    renderImageLibraryModule();
    renderQuickStats();
    showToast(`Deleted "${removed.name}".`, 'info');
  }

  function determineMediaTag(name = '') {
    const lower = name.toLowerCase();
    if (lower.includes('logo') || lower.includes('icon') || lower.includes('favicon')) return 'logos';
    if (lower.includes('banner') || lower.includes('hero') || lower.includes('bg')) return 'banners';
    if (lower.includes('sweet') || lower.includes('cat') || lower.includes('laddu') || lower.includes('ghee')) return 'sweets';
    if (lower.includes('video') || lower.includes('.mp4')) return 'videos';
    return 'sweets';
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ── Media Picker Modal (when editing an image field) ────────────────────────
  function openMediaPicker(targetInputId, previewImgId) {
    const modal = document.getElementById('media-picker-modal');
    const pickerGrid = document.getElementById('media-picker-grid');
    if (!modal || !pickerGrid) return;

    activeImagePickerCallback = (selectedUrl) => {
      const input = document.getElementById(targetInputId);
      if (input) {
        input.value = selectedUrl;
        updateThumbPreview(targetInputId, previewImgId);
      }
      closeModal('media-picker-modal');
    };

    pickerGrid.innerHTML = mediaLibrary.map(item => `
      <div class="media-item-card" onclick="MB_CMS_ADMIN.selectPickerMedia('${item.url}')" style="cursor:pointer;">
        <div class="media-thumb-wrap">
          <img class="media-thumb" src="${resolveAssetUrl(item.url)}" alt="${item.name}" />
        </div>
        <div class="media-meta">
          <h5>${item.name}</h5>
          <button class="btn btn-primary btn-sm" style="width:100%; margin-top:0.4rem;">Select</button>
        </div>
      </div>
    `).join('');

    modal.classList.add('active');
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function selectPickerMedia(url) {
    if (activeImagePickerCallback) {
      activeImagePickerCallback(url);
      activeImagePickerCallback = null;
    }
  }

  // ── 8. FORM SUBMISSIONS & ENQUIRIES MODULE ─────────────────────────────────
  let activeSubmissionsTab = 'all';

  async function fetchSubmissions() {
    try {
      const [contactRes, partnerRes] = await Promise.all([
        fetch(`${RTDB_BASE}/contact_submissions.json`),
        fetch(`${RTDB_BASE}/partner_registrations.json`)
      ]);

      const contacts = (contactRes.ok ? await contactRes.json() : null) || {};
      const partners = (partnerRes.ok ? await partnerRes.json() : null) || {};

      const list = [];
      Object.entries(contacts).forEach(([key, val]) => {
        list.push({ id: key, type: 'contact', ...val });
      });
      Object.entries(partners).forEach(([key, val]) => {
        list.push({ id: key, type: 'partner', ...val });
      });

      // Sort newest first
      list.sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
      formSubmissions = list;
      renderQuickStats();
    } catch (e) {
      console.warn('[Submissions] Fetch error:', e);
    }
  }

  function renderSubmissionsModule() {
    const tbody = document.getElementById('submissions-tbody');
    if (!tbody) return;

    const searchTerm = document.getElementById('submission-search')?.value?.toLowerCase() || '';

    const filtered = formSubmissions.filter(sub => {
      if (activeSubmissionsTab === 'contact' && sub.type !== 'contact') return false;
      if (activeSubmissionsTab === 'partner' && sub.type !== 'partner') return false;

      if (searchTerm) {
        const text = `${sub.name || ''} ${sub.email || ''} ${sub.phone || ''} ${sub.shopName || ''} ${sub.message || ''}`.toLowerCase();
        return text.includes(searchTerm);
      }
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-faint);">No submissions found matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(sub => {
      const date = sub.createdAt ? new Date(sub.createdAt).toLocaleDateString() : 'Recent';
      const isPartner = sub.type === 'partner';
      const cleanPhone = (sub.phone || '').replace(/[^0-9]/g, '');

      return `
        <tr>
          <td><span class="badge ${isPartner ? 'badge-gold' : 'badge-info'}">${isPartner ? 'Partner Reg' : 'Contact Us'}</span></td>
          <td><strong>${sub.name || sub.ownerName || 'Customer'}</strong>${sub.shopName ? `<br /><small style="color:var(--gold);">${sub.shopName}</small>` : ''}</td>
          <td>${sub.phone || ' - '}</td>
          <td>${sub.email || ' - '}</td>
          <td><div style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${sub.message || sub.description || ' - '}</div></td>
          <td>${date}</td>
          <td style="text-align:right; white-space:nowrap;">
            ${cleanPhone ? `<a href="https://wa.me/${cleanPhone}" target="_blank" class="btn btn-secondary btn-sm" title="Chat on WhatsApp">
              <i data-lucide="message-circle"></i>
              <span>WhatsApp</span>
            </a>` : ''}
            <button class="btn btn-outline btn-sm" onclick="MB_CMS_ADMIN.viewSubmissionModal('${sub.id}')">
              <i data-lucide="eye"></i>
              <span>View</span>
            </button>
            <button class="btn btn-danger btn-sm" onclick="MB_CMS_ADMIN.deleteSubmission('${sub.type}', '${sub.id}')" title="Delete Submission">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function filterSubmissionsTab(tab) {
    activeSubmissionsTab = tab;
    document.querySelectorAll('.sub-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    renderSubmissionsModule();
  }

  function viewSubmissionModal(id) {
    const item = formSubmissions.find(s => s.id === id);
    if (!item) return;

    const modal = document.getElementById('submission-view-modal');
    const modalBody = document.getElementById('submission-modal-body');
    if (!modal || !modalBody) return;

    modalBody.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.75rem;">
        <div><strong>Submission Type:</strong> <span class="badge ${item.type === 'partner' ? 'badge-gold' : 'badge-info'}">${item.type.toUpperCase()}</span></div>
        <div><strong>Date & Time:</strong> ${item.createdAt || 'N/A'}</div>
        <div><strong>Name:</strong> ${item.name || item.ownerName || ' - '}</div>
        ${item.shopName ? `<div><strong>Shop / Business Name:</strong> ${item.shopName}</div>` : ''}
        <div><strong>Phone:</strong> <a href="tel:${item.phone}" style="color:var(--gold);">${item.phone || ' - '}</a></div>
        <div><strong>Email:</strong> <a href="mailto:${item.email}">${item.email || ' - '}</a></div>
        ${item.city ? `<div><strong>City:</strong> ${item.city}</div>` : ''}
        ${item.subject ? `<div><strong>Subject:</strong> ${item.subject}</div>` : ''}
        <div style="background:var(--bg-input); padding:1rem; border-radius:var(--radius-md); border:1px solid var(--border-subtle); margin-top:0.5rem;">
          <strong>Message / Description:</strong>
          <p style="margin-top:0.5rem; white-space:pre-wrap; color:#111827;">${item.message || item.description || 'No message text provided.'}</p>
        </div>
      </div>
    `;

    modal.classList.add('active');
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  async function deleteSubmission(type, id) {
    if (!confirm('Are you sure you want to permanently delete this submission?')) return;
    const node = type === 'partner' ? 'partner_registrations' : 'contact_submissions';

    try {
      await fetch(`${RTDB_BASE}/${node}/${id}.json`, { method: 'DELETE' });
      formSubmissions = formSubmissions.filter(s => s.id !== id);
      renderSubmissionsModule();
      renderQuickStats();
      showToast('Submission deleted.', 'info');
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error');
    }
  }

  function exportSubmissionsCSV() {
    if (!formSubmissions.length) {
      showToast('No submissions to export.', 'info');
      return;
    }

    const headers = ['Type', 'Name', 'ShopName', 'Phone', 'Email', 'City', 'Subject', 'Message', 'Date'];
    const rows = formSubmissions.map(s => [
      `"${s.type || ''}"`,
      `"${(s.name || s.ownerName || '').replace(/"/g, '""')}"`,
      `"${(s.shopName || '').replace(/"/g, '""')}"`,
      `"${s.phone || ''}"`,
      `"${s.email || ''}"`,
      `"${s.city || ''}"`,
      `"${(s.subject || '').replace(/"/g, '""')}"`,
      `"${(s.message || s.description || '').replace(/"/g, '""')}"`,
      `"${s.createdAt || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', `mittaibandi_submissions_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // ── 9. ACTIVITY LOGS AUDIT TRAIL MODULE ────────────────────────────────────
  async function fetchHistory() {
    try {
      const res = await fetch(HISTORY_URL);
      if (res.ok) {
        const data = await res.json();
        if (data) {
          const list = Object.values(data);
          list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
          auditLogs = list;
          renderHistoryModule();
        }
      }
    } catch (e) {}
  }

  function renderHistoryModule() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    if (!auditLogs.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-faint);">No recent activity logs recorded.</td></tr>`;
      return;
    }

    tbody.innerHTML = auditLogs.map(log => {
      const date = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Recent';
      let badgeCls = 'badge-info';
      if (log.action === 'PUBLISH') badgeCls = 'badge-success';
      if (log.action === 'PASSWORD_CHANGE' || log.action === 'DELETE') badgeCls = 'badge-danger';
      if (log.action === 'DRAFT_SAVE') badgeCls = 'badge-warning';

      return `
        <tr>
          <td><span class="badge ${badgeCls}">${log.action}</span></td>
          <td>${log.description}</td>
          <td><strong>${log.user || 'admin'}</strong></td>
          <td style="color:var(--text-muted);">${date}</td>
        </tr>
      `;
    }).join('');
  }

  // ── 10. ADMIN SETTINGS & SECURITY MODULE ───────────────────────────────────
  function renderSettingsModule() {
    const connEl = document.getElementById('settings-db-status');
    if (connEl) {
      const who = window.MB_AUTH ? MB_AUTH.getCurrentUserEmail() : 'admin';
      connEl.innerHTML = `<span class="badge badge-success">● Connected &amp; Operational</span> (RTDB: asia-southeast1) — signed in as <strong>${who}</strong> via Firebase Auth`;
    }
  }

  async function handleChangePasswordSubmit(e) {
    e.preventDefault();
    const curr = document.getElementById('pwd-current').value;
    const newP = document.getElementById('pwd-new').value;
    const conf = document.getElementById('pwd-confirm').value;

    if (newP !== conf) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    showToast('Updating password...', 'info');
    const result = await MB_AUTH.changePassword(curr, newP);
    if (result.success) {
      showToast('Password changed successfully! Keep it safe.', 'success');
      document.getElementById('change-pwd-form').reset();
    } else {
      showToast(result.message || 'Password change failed.', 'error');
    }
  }

  function exportBackupJSON() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(draftData, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `mittaibandi_cms_backup_${Date.now()}.json`);
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
  }

  function importBackupJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed && parsed.global && parsed.pages) {
          if (confirm('Import this backup? This will replace your current draft configuration.')) {
            draftData = parsed;
            markDirty();
            renderCurrentModule();
            showToast('Backup imported into draft successfully!', 'success');
          }
        } else {
          showToast('Invalid backup file structure.', 'error');
        }
      } catch (err) {
        showToast('JSON parse error: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  async function resetToDefaults() {
    const code = prompt('WARNING: This will reset ALL draft CMS fields back to original MITTAI BANDI defaults.\nType "RESET" to confirm:');
    if (code !== 'RESET') {
      showToast('Reset cancelled.', 'info');
      return;
    }

    draftData = JSON.parse(JSON.stringify(window.MITTAI_DEFAULT_CMS));
    mediaLibrary = draftData.media;
    markDirty();
    renderCurrentModule();
    renderQuickStats();
    await logActivity('RESET', 'Reset CMS configuration to default state.');
    showToast('Reset to default content complete.', 'info');
  }

  // ── 11. LIVE PREVIEW MODAL CONTROLLER ──────────────────────────────────────
  let activePreviewDevice = 'desktop';

  function openLivePreview() {
    const modal = document.getElementById('live-preview-modal');
    const frame = document.getElementById('preview-iframe');
    const pageSelect = document.getElementById('preview-page-select');
    if (!modal || !frame) return;

    modal.classList.add('active');

    // Load preview page using root-relative path
    const pageFile = (pageSelect ? pageSelect.value : 'index.html').replace(/^\.?\//, '');
    frame.src = `/${pageFile}?preview=true`;

    frame.onload = function () {
      // Send real-time draft state via postMessage
      frame.contentWindow.postMessage({
        type: 'MB_CMS_PREVIEW',
        cmsData: draftData
      }, '*');
    };
  }

  function setPreviewDevice(device) {
    activePreviewDevice = device;
    const frame = document.getElementById('preview-iframe');
    if (!frame) return;

    document.querySelectorAll('.device-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.device === device);
    });

    frame.className = `preview-frame ${device}`;
  }

  function changePreviewPage(pageFile) {
    const frame = document.getElementById('preview-iframe');
    if (!frame) return;
    const cleanPage = pageFile.replace(/^\.?\//, '');
    frame.src = `/${cleanPage}?preview=true`;
  }

  // ── Helper: Modal Dismissal ────────────────────────────────────────────────
  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  function resolveAssetUrl(url, fallback = '/assets/images/logo.png') {
    if (!url) return fallback;
    const trimmed = String(url).trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/') || trimmed.startsWith('data:')) {
      return trimmed;
    }
    return '/' + trimmed;
  }

  function updateThumbPreview(inputId, imgId) {
    const input = document.getElementById(inputId);
    const img = document.getElementById(imgId);
    if (input && img && input.value) {
      img.src = resolveAssetUrl(input.value);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!', 'info');
    });
  }

  // ── Initialize on Page Load ────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // Route guard: wait for Firebase session restore + admin claim before loading any CMS data
      if (!window.MB_AUTH) {
        window.location.replace('/admin/login.html');
        return;
      }
      const adminUser = await window.MB_AUTH.requireAdmin();
      const userLabel = document.getElementById('admin-user-email');
      if (userLabel && adminUser) userLabel.textContent = adminUser.email;
    } catch (authErr) {
      console.error('[CMS Admin] Auth initialization failed:', authErr);
      document.documentElement.classList.remove('mb-auth-pending');
      window.location.replace('/admin/login.html');
      return;
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }

    loadAllData();

    // Bind Sidebar Drawer Toggle
    const toggleBtn = document.getElementById('btn-sidebar-toggle') || document.getElementById('btn-mobile-menu');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.toggle('open');
      });
    }

    // Bind Drag-and-drop on media drop zone
    const dropZone = document.getElementById('media-dropzone');
    const fileInput = document.getElementById('media-file-input');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
      dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border-subtle)'; });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border-subtle)';
        handleMediaUpload(e.dataTransfer.files);
      });
      fileInput.addEventListener('change', () => handleMediaUpload(fileInput.files));
    }
  });

  function openLivePreviewPage(pageFile) {
    const pageSelect = document.getElementById('preview-page-select');
    if (pageSelect && pageFile) {
      pageSelect.value = pageFile;
    }
    openLivePreview();
  }

  // ── Helper: Extract YouTube ID from any format ─────────────────────────────
  function extractYouTubeId(urlOrId) {
    if (!urlOrId) return '';
    const str = String(urlOrId).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
    const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/i);
    return match ? match[1] : '';
  }

  let _heroPreviewMode = 'desktop';

  function setHeroPreviewMode(mode) {
    _heroPreviewMode = mode === 'mobile' ? 'mobile' : 'desktop';
    const btnDesk = document.getElementById('btn-hero-prev-desktop');
    const btnMob = document.getElementById('btn-hero-prev-mobile');
    if (btnDesk && btnMob) {
      if (_heroPreviewMode === 'desktop') {
        btnDesk.className = 'btn btn-sm btn-primary';
        btnMob.className = 'btn btn-sm btn-secondary';
      } else {
        btnDesk.className = 'btn btn-sm btn-secondary';
        btnMob.className = 'btn btn-sm btn-primary';
      }
    }
    renderHeroInlinePreview();
  }

  function handleHeroYouTubeInput(targetType = 'all') {
    if (targetType === 'desktop' || targetType === 'all') {
      const input = document.getElementById('hero-field-desktop-youtube-url');
      const badge = document.getElementById('hero-desktop-yt-id-badge');
      const textEl = document.getElementById('hero-desktop-yt-id-text');
      if (input && badge && textEl) {
        const val = input.value.trim();
        if (!val) {
          badge.style.background = '#F3F4F6';
          badge.style.color = '#6B7280';
          textEl.textContent = 'No Video';
        } else {
          const id = extractYouTubeId(val);
          if (id) {
            badge.style.background = '#DCFCE7';
            badge.style.color = '#15803D';
            textEl.textContent = `ID: ${id}`;
          } else {
            badge.style.background = '#FEE2E2';
            badge.style.color = '#DC2626';
            textEl.textContent = 'Invalid Link';
          }
        }
      }
    }

    if (targetType === 'mobile' || targetType === 'all') {
      const input = document.getElementById('hero-field-mobile-youtube-url');
      const badge = document.getElementById('hero-mobile-yt-id-badge');
      const textEl = document.getElementById('hero-mobile-yt-id-text');
      if (input && badge && textEl) {
        const val = input.value.trim();
        if (!val) {
          badge.style.background = '#F3F4F6';
          badge.style.color = '#6B7280';
          textEl.textContent = 'No Video';
        } else {
          const id = extractYouTubeId(val);
          if (id) {
            badge.style.background = '#DCFCE7';
            badge.style.color = '#15803D';
            textEl.textContent = `Shorts: ${id}`;
          } else {
            badge.style.background = '#FEE2E2';
            badge.style.color = '#DC2626';
            textEl.textContent = 'Invalid Link';
          }
        }
      }
    }
  }

  // ── 12. HERO SECTION CMS MANAGEMENT MODULE ─────────────────────────────────
  function renderHeroModule() {
    const hero = draftData.pages?.home?.sections?.hero || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setCheck('hero-field-enabled', hero.enabled !== false && hero.visible !== false);
    setVal('hero-field-order', hero.order || 1);
    setVal('hero-field-alignment', hero.textAlignment || 'left');
    setVal('hero-field-imgpos', hero.imagePosition || 'center center');

    setVal('hero-field-eyebrow', hero.eyebrow || hero.badge || 'Authentic Indian Confectionery');
    setVal('hero-field-heading', hero.heading || 'MITTAI BANDI');
    setVal('hero-field-tagline', hero.tagline || 'Traditional Taste. Delivered Fresh.');
    setVal('hero-field-description', hero.description || hero.subheading || '');

    // Media Settings (Separate Desktop & Mobile YouTube Video URLs)
    setCheck('hero-field-show-video', hero.showVideo !== false);
    setCheck('hero-field-fallback-enabled', hero.fallbackImageEnabled !== false);

    let deskYtUrl = hero.desktopYoutubeUrl || (hero.desktopVideoId ? `https://www.youtube.com/watch?v=${hero.desktopVideoId}` : '');
    if (!deskYtUrl && hero.youtubeUrl && !hero.youtubeUrl.includes('ZU5BKMTEI9E')) {
      deskYtUrl = hero.youtubeUrl;
    }
    const mobYtUrl = hero.mobileYoutubeUrl || (hero.mobileVideoId ? `https://www.youtube.com/shorts/${hero.mobileVideoId}` : '');

    setVal('hero-field-desktop-youtube-url', deskYtUrl);
    setVal('hero-field-mobile-youtube-url', mobYtUrl);
    handleHeroYouTubeInput('all');

    const defaultDesktopImg = hero.desktopImage || hero.image || hero.bgImage || 'assets/images/artisan_making_sweets.png';
    const defaultMobileImg = hero.mobileImage || defaultDesktopImg;

    setVal('hero-field-desktop-img', defaultDesktopImg);
    setVal('hero-field-mobile-img', defaultMobileImg);

    updateThumbPreview('hero-field-desktop-img', 'preview-hero-desktop-img');
    updateThumbPreview('hero-field-mobile-img', 'preview-hero-mobile-img');

    setVal('hero-field-btn1-text', hero.btnPrimary?.text || hero.btnPrimary?.label || 'Explore Sweets');
    setVal('hero-field-btn1-link', hero.btnPrimary?.link || hero.btnPrimary?.href || '#categories');
    setVal('hero-field-btn2-text', hero.btnSecondary?.text || hero.btnSecondary?.label || 'Partner With Us');
    setVal('hero-field-btn2-link', hero.btnSecondary?.link || hero.btnSecondary?.href || 'partner.html');

    renderHeroInlinePreview();
  }

  function renderHeroInlinePreview() {
    const box = document.getElementById('hero-inline-preview-box');
    if (!box) return;

    const getVal = id => document.getElementById(id)?.value || '';
    const getCheck = id => !!document.getElementById(id)?.checked;

    const eyebrow = getVal('hero-field-eyebrow') || 'Authentic Indian Confectionery';
    const heading = getVal('hero-field-heading') || 'MITTAI BANDI';
    const tagline = getVal('hero-field-tagline') || 'Traditional Taste. Delivered Fresh.';
    const desc = getVal('hero-field-description') || '';
    const align = getVal('hero-field-alignment') || 'left';
    const imgPos = getVal('hero-field-imgpos') || 'center center';
    const btn1Text = getVal('hero-field-btn1-text') || 'Explore Sweets';
    const btn2Text = getVal('hero-field-btn2-text') || 'Partner With Us';

    const isVideoEnabled = getCheck('hero-field-show-video');
    const isFallbackEnabled = getCheck('hero-field-fallback-enabled');

    const deskYtUrl = getVal('hero-field-desktop-youtube-url');
    const mobYtUrl = getVal('hero-field-mobile-youtube-url');
    const deskId = extractYouTubeId(deskYtUrl);
    const mobId = extractYouTubeId(mobYtUrl);

    const isMobileMode = _heroPreviewMode === 'mobile';
    const activeVideoId = isMobileMode ? (mobId || deskId) : deskId;
    const activeYtType = isMobileMode ? (mobId ? 'Portrait Shorts' : (deskId ? 'Landscape Fallback' : 'None')) : (deskId ? 'Landscape 16:9' : 'None');

    const imgFieldId = isMobileMode ? 'hero-field-mobile-img' : 'hero-field-desktop-img';
    const imgRaw = getVal(imgFieldId) || 'assets/images/artisan_making_sweets.png';
    const activeImgUrl = resolveAssetUrl(imgRaw);

    const flexAlign = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

    // Outer box responsive styling
    if (isMobileMode) {
      box.style.width = '340px';
      box.style.maxWidth = '340px';
      box.style.minHeight = '560px';
      box.style.borderRadius = '28px';
      box.style.border = '4px solid #374151';
      box.style.boxShadow = '0 25px 50px -12px rgba(0,0,0,0.7)';
    } else {
      box.style.width = '100%';
      box.style.maxWidth = '100%';
      box.style.minHeight = '380px';
      box.style.borderRadius = '16px';
      box.style.border = '1px solid #374151';
      box.style.boxShadow = 'none';
    }

    const videoBadgeHtml = isVideoEnabled && activeVideoId
      ? `<span style="background:rgba(220,38,38,0.92); color:#fff; font-size:0.7rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:999px; display:inline-flex; align-items:center; gap:0.3rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg> ${activeYtType} (${activeVideoId})</span>`
      : `<span style="background:rgba(75,85,99,0.9); color:#fff; font-size:0.7rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:999px;">${isVideoEnabled ? 'No Video Configured (Showing Poster)' : 'Video Disabled (Showing Poster)'}</span>`;

    const modeBadgeHtml = `<span style="background:rgba(0,0,0,0.75); color:#FBBF24; font-size:0.7rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:999px;">${isMobileMode ? '9:16 Mobile View' : '16:9 Desktop View'}</span>`;

    const fallbackStatusHtml = !isFallbackEnabled
      ? `<span style="background:rgba(239,68,68,0.9); color:#fff; font-size:0.7rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:999px;">⚠️ Fallback Disabled</span>`
      : '';

    box.innerHTML = `
      <img src="${activeImgUrl}" alt="Hero Preview" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:${imgPos}; z-index:1;" onerror="this.src='/assets/images/artisan_making_sweets.png';" />
      <div style="position:absolute; top:12px; left:12px; right:12px; display:flex; gap:0.5rem; flex-wrap:wrap; z-index:3;">
        ${modeBadgeHtml}
        ${videoBadgeHtml}
        ${fallbackStatusHtml}
      </div>
      <div style="position:relative; z-index:2; width:100%; max-width:${isMobileMode ? '300px' : '760px'}; padding:${isMobileMode ? '4rem 1.25rem 2rem' : '3rem 2rem 2.5rem'}; display:flex; flex-direction:column; align-items:${flexAlign}; text-align:${align};">
        <span style="display:inline-block; background:rgba(255,255,255,0.95); color:#E60046; font-size:${isMobileMode ? '0.65rem' : '0.72rem'}; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; padding:0.3rem 0.75rem; border-radius:999px; margin-bottom:0.65rem;">${eyebrow}</span>
        <h2 style="color:#FFFFFF; font-size:${isMobileMode ? '1.6rem' : '2.3rem'}; font-weight:800; line-height:1.15; margin:0 0 0.35rem 0; text-shadow:0 3px 18px rgba(0,0,0,0.85);">${heading}</h2>
        <p style="color:#FFE082; font-size:${isMobileMode ? '0.95rem' : '1.15rem'}; font-style:italic; font-weight:600; margin:0 0 0.65rem 0; text-shadow:0 2px 12px rgba(0,0,0,0.85);">${tagline}</p>
        <p style="color:#FFFFFF; font-size:${isMobileMode ? '0.82rem' : '0.92rem'}; line-height:1.5; max-width:600px; margin:0 0 1.15rem 0; text-shadow:0 2px 12px rgba(0,0,0,0.9);">${desc}</p>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; justify-content:${flexAlign};">
          <span style="background:#E60046; color:#FFFFFF; padding:${isMobileMode ? '0.5rem 1rem' : '0.6rem 1.25rem'}; border-radius:999px; font-weight:700; font-size:${isMobileMode ? '0.75rem' : '0.85rem'}; box-shadow:0 4px 14px rgba(230,0,70,0.4);">${btn1Text}</span>
          <span style="background:rgba(255,255,255,0.92); color:#E60046; padding:${isMobileMode ? '0.5rem 1rem' : '0.6rem 1.25rem'}; border-radius:999px; font-weight:700; font-size:${isMobileMode ? '0.75rem' : '0.85rem'};">${btn2Text}</span>
        </div>
      </div>
    `;
  }

  function saveHeroModule(silent = false) {
    draftData.pages = draftData.pages || {};
    draftData.pages.home = draftData.pages.home || { sections: {} };
    draftData.pages.home.sections = draftData.pages.home.sections || {};
    const hero = draftData.pages.home.sections.hero = draftData.pages.home.sections.hero || {};

    const getVal = id => document.getElementById(id)?.value?.trim() || '';
    const getCheck = id => !!document.getElementById(id)?.checked;

    hero.name = hero.name || 'Hero Banner';
    hero.enabled = getCheck('hero-field-enabled');
    hero.visible = hero.enabled;
    hero.order = parseInt(getVal('hero-field-order'), 10) || 1;
    hero.textAlignment = getVal('hero-field-alignment') || 'left';
    hero.imagePosition = getVal('hero-field-imgpos') || 'center center';

    hero.eyebrow = getVal('hero-field-eyebrow');
    hero.badge = hero.eyebrow;
    hero.heading = getVal('hero-field-heading');
    hero.tagline = getVal('hero-field-tagline');
    hero.description = getVal('hero-field-description');
    hero.subheading = hero.description;

    // Media Settings (Separate Desktop 16:9 & Mobile 9:16 URLs)
    hero.showVideo = getCheck('hero-field-show-video');
    hero.fallbackImageEnabled = getCheck('hero-field-fallback-enabled');

    const deskUrl = getVal('hero-field-desktop-youtube-url');
    const deskId = extractYouTubeId(deskUrl);
    const mobUrl = getVal('hero-field-mobile-youtube-url');
    const mobId = extractYouTubeId(mobUrl);

    hero.desktopYoutubeUrl = deskUrl;
    hero.desktopVideoId = deskId;
    hero.mobileYoutubeUrl = mobUrl;
    hero.mobileVideoId = mobId;

    // Unified fallbacks for backward compatibility
    hero.youtubeUrl = deskUrl || mobUrl || '';
    hero.videoId = deskId || mobId || '';
    hero.videoUrl = deskUrl || mobUrl || '';
    delete hero.fallbackVideoUrl;

    const deskImg = getVal('hero-field-desktop-img') || 'assets/images/artisan_making_sweets.png';
    const mobImg = getVal('hero-field-mobile-img') || deskImg;

    hero.desktopImage = deskImg;
    hero.mobileImage = mobImg;
    hero.image = deskImg;
    hero.bgImage = deskImg;
    hero.posterImage = deskImg;

    const b1Text = getVal('hero-field-btn1-text') || 'Explore Sweets';
    const b1Link = getVal('hero-field-btn1-link') || '#categories';
    hero.btnPrimary = {
      text: b1Text,
      label: b1Text,
      link: b1Link,
      href: b1Link
    };
    const b2Text = getVal('hero-field-btn2-text') || 'Partner With Us';
    const b2Link = getVal('hero-field-btn2-link') || 'partner.html';
    hero.btnSecondary = {
      text: b2Text,
      label: b2Text,
      link: b2Link,
      href: b2Link
    };

    markDirty();
    if (!silent) {
      showToast('Hero Section configuration saved to draft!', 'success');
    }
  }

  async function saveHeroAndPublish() {
    saveHeroModule(true);
    await publishToLive();
  }

  async function handleHeroVideoUpload(event) {
    // Retained for backward-compatibility if invoked from older handlers
    showToast('Video uploads are replaced by YouTube links. Paste a YouTube URL in Hero Media Settings.', 'info');
  }

  // ── 13. CENTRALIZED IMAGE LIBRARY MODULE ───────────────────────────────────
  let activeImgLibPageFilter = 'all';
  let pendingUploadDataUrl = '';

  function buildWebsiteImageUsageMap() {
    const usageMap = {};
    const addUsage = (url, pageName, secName, defaultName) => {
      if (!url || typeof url !== 'string') return;
      const clean = url.trim();
      if (!clean) return;
      if (!usageMap[clean]) {
        usageMap[clean] = {
          pages: new Set(),
          sections: new Set(),
          defaultName: defaultName || clean.split('/').pop().split('?')[0] || 'Website Image'
        };
      }
      if (pageName) usageMap[clean].pages.add(pageName);
      if (secName) usageMap[clean].sections.add(secName);
    };

    const g = draftData?.global || {};
    addUsage(g.logo, 'Global Branding', 'Header, Footer & Preloader Logo', 'Brand Logo');
    addUsage(g.favicon, 'Global Branding', 'Browser Favicon', 'Favicon');

    (draftData?.promotionalBanners || []).forEach((b, i) => {
      addUsage(b.image, 'Promotional Banners', `Slide #${i + 1}: ${b.campaignName || b.title || 'Promo'}`, b.campaignName || `Promo Banner #${i + 1}`);
    });

    const pageLabels = {
      home: 'Home',
      about: 'About Us',
      partner: 'Partner With Us',
      contact: 'Contact'
    };

    Object.entries(draftData?.pages || {}).forEach(([pKey, pObj]) => {
      const pName = pageLabels[pKey] || pKey;
      if (pObj.seo?.ogImage) addUsage(pObj.seo.ogImage, pName, 'SEO Social Share Image', `${pName} OG Image`);
      Object.entries(pObj.sections || {}).forEach(([sKey, sec]) => {
        const sLabel = `${sec.name || sKey} (#${sKey})`;
        if (sec.image) addUsage(sec.image, pName, sLabel, `${sec.name || sKey} Image`);
        if (sec.bgImage) addUsage(sec.bgImage, pName, sLabel, `${sec.name || sKey} Background`);
        if (sec.desktopImage) addUsage(sec.desktopImage, pName, `${sLabel} Desktop`, `${sec.name || sKey} Desktop`);
        if (sec.mobileImage) addUsage(sec.mobileImage, pName, `${sLabel} Mobile`, `${sec.name || sKey} Mobile`);
        if (sec.posterImage) addUsage(sec.posterImage, pName, `${sLabel} Poster`, `${sec.name || sKey} Poster`);
        if (sec.videoUrl) addUsage(sec.videoUrl, pName, `${sLabel} Video`, `${sec.name || sKey} Video`);
        const arr = sec.cards || sec.steps || sec.items || [];
        arr.forEach(card => {
          if (card && card.image) {
            addUsage(card.image, pName, `${sLabel} -> ${card.title || 'Card'}`, card.title || 'Card Image');
          }
        });
      });
    });

    return usageMap;
  }

  function syncWebsiteImagesIntoLibrary(silent = false) {
    const usageMap = buildWebsiteImageUsageMap();
    let addedCount = 0;

    Object.entries(usageMap).forEach(([url, info]) => {
      const pagesStr = Array.from(info.pages).join(', ');
      const secsStr = Array.from(info.sections).join(' | ');
      const existing = mediaLibrary.find(m => m.url === url);
      if (existing) {
        if (pagesStr) existing.usedInPage = pagesStr;
        if (secsStr) existing.usedInSection = secsStr;
        if (!existing.status) existing.status = 'active';
      } else {
        mediaLibrary.push({
          id: 'med-sync-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: info.defaultName,
          url: url,
          type: url.endsWith('.mp4') ? 'video' : 'image',
          tag: determineMediaTag(url),
          size: 'Live Asset',
          usedInPage: pagesStr || 'Website',
          usedInSection: secsStr || 'Active Section',
          status: 'active',
          uploadedAt: new Date().toISOString()
        });
        addedCount++;
      }
    });

    draftData.media = mediaLibrary;
    if (!silent) {
      renderImageLibraryModule();
      showToast(`Synchronized all website images (${mediaLibrary.length} total assets).`, 'success');
    }
  }

  function setImageLibraryFilter(pageFilter) {
    activeImgLibPageFilter = pageFilter;
    document.querySelectorAll('#imglib-page-pills .filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pageFilter === pageFilter);
    });
    renderImageLibraryModule();
  }

  function renderImageLibraryModule() {
    syncWebsiteImagesIntoLibrary(true);
    const tbody = document.getElementById('imglib-tbody');
    if (!tbody) return;

    const searchQ = (document.getElementById('imglib-search-input')?.value || '').trim().toLowerCase();

    const list = mediaLibrary.filter(item => {
      if (activeImgLibPageFilter !== 'all') {
        const usedP = (item.usedInPage || '').toLowerCase();
        if (!usedP.includes(activeImgLibPageFilter.toLowerCase())) return false;
      }
      if (searchQ) {
        const hay = `${item.name || ''} ${item.url || ''} ${item.usedInPage || ''} ${item.usedInSection || ''} ${item.tag || ''}`.toLowerCase();
        return hay.includes(searchQ);
      }
      return true;
    });

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-faint);">No images match the current filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => {
      const dateStr = item.uploadedAt ? new Date(item.uploadedAt).toLocaleDateString() : 'Live';
      const isVideo = item.type === 'video' || (item.url && item.url.endsWith('.mp4'));
      const resolved = resolveAssetUrl(item.url);
      const displayUrl = item.url && item.url.startsWith('data:')
        ? 'data:image/... (Embedded Base64 Asset)'
        : item.url;
      const isActive = item.status !== 'inactive';

      return `
        <tr>
          <td>
            <div style="width:92px; height:60px; border-radius:8px; overflow:hidden; border:1px solid #E2E8F0; background:#F8FAFC; cursor:pointer; position:relative;" onclick="MB_CMS_ADMIN.openImageLightbox('${item.id}')" title="Click to Preview Full Size">
              ${isVideo
                ? `<video src="${resolved}" muted style="width:100%; height:100%; object-fit:cover;"></video>`
                : `<img src="${resolved}" alt="${item.name}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='/assets/images/logo.png';" />`
              }
            </div>
          </td>
          <td>
            <div style="font-weight:700; color:#0F172A; font-size:0.9rem;">${item.name || 'Website Image'}</div>
            <div style="font-family:monospace; font-size:0.75rem; color:#64748B; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${displayUrl}">${displayUrl}</div>
          </td>
          <td>
            <span class="badge" style="background:rgba(201,0,61,0.08); color:#C9003D; font-weight:600;">${item.usedInPage || 'Website Library'}</span>
          </td>
          <td>
            <div style="font-size:0.82rem; color:#334155; max-width:240px; line-height:1.4;">${item.usedInSection || 'General Asset'}</div>
          </td>
          <td style="font-size:0.82rem; color:#64748B;">${dateStr}</td>
          <td>
            <span class="badge ${isActive ? 'badge-success' : 'badge-warning'}">${isActive ? 'Active' : 'Inactive'}</span>
          </td>
          <td style="text-align:right; white-space:nowrap;">
            <div style="display:inline-flex; gap:0.3rem; flex-wrap:wrap; justify-content:flex-end;">
              <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.openImageLightbox('${item.id}')" title="Preview Image">
                <i data-lucide="eye"></i>
              </button>
              <button class="btn btn-primary btn-sm" onclick="MB_CMS_ADMIN.openReplaceImageModal('${item.id}')" title="Replace Image Across Website">
                <i data-lucide="refresh-cw"></i>
                <span>Replace</span>
              </button>
              <button class="btn btn-outline btn-sm" onclick="MB_CMS_ADMIN.openEditImageDetailsModal('${item.id}')" title="Edit Image Details">
                <i data-lucide="edit-3"></i>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="MB_CMS_ADMIN.copyToClipboard('${item.url}')" title="Copy Image URL">
                <i data-lucide="copy"></i>
              </button>
              <button class="btn btn-danger btn-sm" onclick="MB_CMS_ADMIN.deleteMediaItem('${item.id}')" title="Delete Image">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function openImageLightbox(id) {
    const item = mediaLibrary.find(m => m.id === id);
    if (!item) return;
    const modal = document.getElementById('image-lightbox-modal');
    const titleEl = document.getElementById('lightbox-img-title');
    const imgEl = document.getElementById('lightbox-img-el');
    const metaEl = document.getElementById('lightbox-img-meta');
    if (!modal || !imgEl) return;

    if (titleEl) titleEl.textContent = item.name || 'Image Preview';
    imgEl.src = resolveAssetUrl(item.url);
    if (metaEl) {
      metaEl.textContent = `Used in Page: ${item.usedInPage || 'Website'}  •  Section: ${item.usedInSection || 'General'}  •  URL: ${item.url.startsWith('data:') ? 'Embedded DataURL' : item.url}`;
    }
    modal.classList.add('active');
  }

  function openUploadModalForField(targetInputId = null, targetPreviewId = null, defaultPage = 'Website', defaultSection = 'General') {
    const modal = document.getElementById('image-upload-modal');
    if (!modal) return;

    pendingUploadDataUrl = '';
    document.getElementById('img-upload-modal-title').textContent = targetInputId ? 'Upload Image for Section' : 'Upload New Website Image';
    document.getElementById('img-upload-replace-id').value = '';
    document.getElementById('img-upload-target-input').value = targetInputId || '';
    document.getElementById('img-upload-target-preview').value = targetPreviewId || '';
    document.getElementById('img-upload-file-input').value = '';
    document.getElementById('img-upload-url-input').value = '';
    document.getElementById('img-upload-name-input').value = defaultSection !== 'General' ? `${defaultSection} Image` : '';
    document.getElementById('img-upload-page-input').value = defaultPage || 'Website';
    document.getElementById('img-upload-section-input').value = defaultSection || 'General';
    document.getElementById('img-upload-live-preview').src = '/assets/images/logo.png';
    document.getElementById('img-upload-progress-wrap').style.display = 'none';

    modal.classList.add('active');
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function openReplaceImageModal(mediaId) {
    const item = mediaLibrary.find(m => m.id === mediaId);
    if (!item) return;

    const modal = document.getElementById('image-upload-modal');
    if (!modal) return;

    pendingUploadDataUrl = '';
    document.getElementById('img-upload-modal-title').textContent = `Replace Image: ${item.name}`;
    document.getElementById('img-upload-replace-id').value = item.id;
    document.getElementById('img-upload-target-input').value = '';
    document.getElementById('img-upload-target-preview').value = '';
    document.getElementById('img-upload-file-input').value = '';
    document.getElementById('img-upload-url-input').value = '';
    document.getElementById('img-upload-name-input').value = item.name || '';
    document.getElementById('img-upload-page-input').value = item.usedInPage || 'Website';
    document.getElementById('img-upload-section-input').value = item.usedInSection || 'General';
    document.getElementById('img-upload-live-preview').src = resolveAssetUrl(item.url);
    document.getElementById('img-upload-progress-wrap').style.display = 'none';

    modal.classList.add('active');
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  async function handleUploadModalFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];
    if (!file.type.startsWith('image/') && !validTypes.includes(file.type)) {
      showToast('Please select a valid image file (JPG, JPEG, PNG, WEBP).', 'error');
      return;
    }

    const nameInput = document.getElementById('img-upload-name-input');
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = file.name.replace(/\.[^.]+$/, '');
    }

    const progWrap = document.getElementById('img-upload-progress-wrap');
    const progBar = document.getElementById('img-upload-progress-bar');
    const progPct = document.getElementById('img-upload-progress-pct');
    const progTxt = document.getElementById('img-upload-progress-text');
    if (progWrap) {
      progWrap.style.display = 'block';
      progBar.style.width = '40%';
      progPct.textContent = '40%';
      progTxt.textContent = 'Optimizing image & generating preview...';
    }

    try {
      if (window.MB_CLOUDINARY && typeof window.MB_CLOUDINARY.uploadFile === 'function') {
        const res = await window.MB_CLOUDINARY.uploadFile(file);
        if (res && res.secure_url) {
          pendingUploadDataUrl = res.secure_url;
          const previewEl = document.getElementById('img-upload-live-preview');
          if (previewEl) previewEl.src = pendingUploadDataUrl;
          if (progWrap) {
            progBar.style.width = '100%';
            progPct.textContent = '100%';
            progTxt.textContent = `Optimized & ready to save (${formatBytes(res.bytes || file.size)})`;
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[Upload Modal] Optimization fallback:', e);
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      pendingUploadDataUrl = e.target.result;
      const previewEl = document.getElementById('img-upload-live-preview');
      if (previewEl) previewEl.src = pendingUploadDataUrl;
      if (progWrap) {
        progBar.style.width = '100%';
        progPct.textContent = '100%';
        progTxt.textContent = `Ready to save (${formatBytes(file.size)})`;
      }
    };
    reader.readAsDataURL(file);
  }

  function handleUploadModalUrlInput(val) {
    const trimmed = (val || '').trim();
    if (!trimmed) return;
    pendingUploadDataUrl = trimmed;
    const previewEl = document.getElementById('img-upload-live-preview');
    if (previewEl) previewEl.src = resolveAssetUrl(trimmed);
  }

  function replaceImageUrlAcrossCMS(oldUrl, newUrl) {
    if (!oldUrl || !newUrl || oldUrl === newUrl) return 0;
    let count = 0;

    const g = draftData.global || {};
    if (g.logo === oldUrl || g.logoUrl === oldUrl) { g.logo = newUrl; g.logoUrl = newUrl; count++; }
    if (g.logoAlt === oldUrl) { g.logoAlt = newUrl; count++; }
    if (g.favicon === oldUrl || g.faviconUrl === oldUrl) { g.favicon = newUrl; g.faviconUrl = newUrl; count++; }
    if (g.preloader && (g.preloader.logo === oldUrl || g.preloader.logoUrl === oldUrl)) {
      g.preloader.logo = newUrl;
      g.preloader.logoUrl = newUrl;
      count++;
    }
    if (draftData.preloader && (draftData.preloader.logo === oldUrl || draftData.preloader.logoUrl === oldUrl)) {
      draftData.preloader.logo = newUrl;
      draftData.preloader.logoUrl = newUrl;
    }

    (draftData.promotionalBanners || []).forEach(b => {
      if (b.image === oldUrl || b.desktopImage === oldUrl) {
        b.image = newUrl;
        b.desktopImage = newUrl.startsWith('data:') ? '' : newUrl;
        b.mobileImage = newUrl.startsWith('data:') ? '' : newUrl;
        count++;
      }
    });

    Object.values(draftData.pages || {}).forEach(pObj => {
      if (pObj.seo && pObj.seo.ogImage === oldUrl) { pObj.seo.ogImage = newUrl; count++; }
      Object.values(pObj.sections || {}).forEach(sec => {
        if (sec.image === oldUrl) { sec.image = newUrl; count++; }
        if (sec.bgImage === oldUrl) { sec.bgImage = newUrl; count++; }
        if (sec.bannerImage === oldUrl) { sec.bannerImage = newUrl; count++; }
        if (sec.desktopImage === oldUrl) { sec.desktopImage = newUrl; count++; }
        if (sec.mobileImage === oldUrl) { sec.mobileImage = newUrl; count++; }
        if (sec.posterImage === oldUrl) { sec.posterImage = newUrl; count++; }
        if (sec.mockupHeroImage === oldUrl) { sec.mockupHeroImage = newUrl; count++; }
        const arr = sec.cards || sec.steps || sec.items || sec.pillars || [];
        arr.forEach(card => {
          if (card && card.image === oldUrl) { card.image = newUrl; count++; }
        });
      });
    });

    return count;
  }

  async function confirmImageUploadAndSave(event) {
    if (event) event.preventDefault();

    const fileInput = document.getElementById('img-upload-file-input');
    const urlInput = document.getElementById('img-upload-url-input');
    const nameVal = document.getElementById('img-upload-name-input')?.value?.trim() || 'Uploaded Image';
    const pageVal = document.getElementById('img-upload-page-input')?.value?.trim() || 'Website';
    const secVal = document.getElementById('img-upload-section-input')?.value?.trim() || 'General';
    const replaceId = document.getElementById('img-upload-replace-id')?.value?.trim() || '';
    const targetInputId = document.getElementById('img-upload-target-input')?.value?.trim() || '';
    const targetPreviewId = document.getElementById('img-upload-target-preview')?.value?.trim() || '';

    let finalUrl = urlInput?.value?.trim() || pendingUploadDataUrl;
    if (!finalUrl) {
      showToast('Please select an image file or enter an image URL first.', 'error');
      return;
    }

    const progWrap = document.getElementById('img-upload-progress-wrap');
    const progBar = document.getElementById('img-upload-progress-bar');
    const progPct = document.getElementById('img-upload-progress-pct');
    const progTxt = document.getElementById('img-upload-progress-text');

    // Attempt Cloudinary upload if a file was chosen
    const file = fileInput?.files?.[0];
    if (file && window.MB_Cloudinary && window.MB_Cloudinary.uploadFile) {
      try {
        if (progWrap) {
          progWrap.style.display = 'block';
          progBar.style.width = '65%';
          progPct.textContent = '65%';
          progTxt.textContent = 'Uploading to CDN...';
        }
        const res = await window.MB_Cloudinary.uploadFile(file);
        if (res && res.secure_url) {
          finalUrl = res.secure_url;
        }
      } catch (e) {
        console.warn('[Image Upload] Using persistent DataURL fallback:', e);
      }
    }

    if (replaceId) {
      const item = mediaLibrary.find(m => m.id === replaceId);
      if (item) {
        const oldUrl = item.url;
        item.url = finalUrl;
        item.name = nameVal;
        item.usedInPage = pageVal;
        item.usedInSection = secVal;
        item.uploadedAt = new Date().toISOString();
        const replacedLocations = replaceImageUrlAcrossCMS(oldUrl, finalUrl);
        showToast(`Replaced "${nameVal}" across ${replacedLocations || 1} website section(s)!`, 'success');
      }
    } else {
      const newMedia = {
        id: 'med-' + Date.now(),
        name: nameVal,
        url: finalUrl,
        type: 'image',
        tag: determineMediaTag(nameVal),
        size: file ? formatBytes(file.size) : 'Direct Asset',
        usedInPage: pageVal,
        usedInSection: secVal,
        status: 'active',
        uploadedAt: new Date().toISOString()
      };
      mediaLibrary.unshift(newMedia);
      showToast(`Image "${nameVal}" saved to CMS!`, 'success');
    }

    if (targetInputId) {
      const inp = document.getElementById(targetInputId);
      if (inp) {
        inp.value = finalUrl;
        if (targetPreviewId) updateThumbPreview(targetInputId, targetPreviewId);
        if (targetInputId.startsWith('hero-field-')) renderHeroInlinePreview();
      }
    }

    draftData.media = mediaLibrary;
    markDirty();
    closeModal('image-upload-modal');
    renderImageLibraryModule();
    renderMediaGrid();
    renderQuickStats();
  }

  function openEditImageDetailsModal(mediaId) {
    const item = mediaLibrary.find(m => m.id === mediaId);
    if (!item) return;

    const modal = document.getElementById('image-edit-modal');
    if (!modal) return;

    document.getElementById('img-edit-id').value = item.id;
    document.getElementById('img-edit-name').value = item.name || '';
    document.getElementById('img-edit-page').value = item.usedInPage || '';
    document.getElementById('img-edit-section').value = item.usedInSection || '';
    document.getElementById('img-edit-tag').value = item.tag || 'sweets';
    document.getElementById('img-edit-status').value = item.status || 'active';

    modal.classList.add('active');
  }

  function saveImageDetailsModal(event) {
    if (event) event.preventDefault();
    const id = document.getElementById('img-edit-id').value;
    const item = mediaLibrary.find(m => m.id === id);
    if (!item) return;

    item.name = document.getElementById('img-edit-name').value.trim();
    item.usedInPage = document.getElementById('img-edit-page').value.trim();
    item.usedInSection = document.getElementById('img-edit-section').value.trim();
    item.tag = document.getElementById('img-edit-tag').value;
    item.status = document.getElementById('img-edit-status').value;

    draftData.media = mediaLibrary;
    markDirty();
    closeModal('image-edit-modal');
    renderImageLibraryModule();
    renderMediaGrid();
    showToast('Image metadata updated.', 'success');
  }

  // ── 14. PARTNER WITH US CMS MANAGEMENT MODULE ──────────────────────────────
  function renderPartnerCmsModule() {
    const partnerPage = draftData.pages?.partner || { sections: {} };
    const secs = partnerPage.sections || {};
    const pHero = secs['partner-hero'] || {};
    const vp = secs['vendor-partnership'] || {};
    const dp = secs['delivery-partnership'] || {};

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    // Partner Hero
    setCheck('p-hero-enabled', pHero.enabled !== false && pHero.visible !== false);
    setVal('p-hero-eyebrow', pHero.eyebrow || pHero.badge || 'Grow Your Confectionery Business');
    setVal('p-hero-heading', pHero.heading || 'Partner With MITTAI BANDI');
    setVal('p-hero-desc', pHero.description || pHero.subheading || '');
    setVal('p-hero-bgimage', pHero.bgImage || pHero.image || 'assets/images/wedding_sweets.png');
    updateThumbPreview('p-hero-bgimage', 'preview-p-hero-bg');

    // Section 1: Vendor Partnership
    setCheck('vp-enabled', vp.enabled !== false && vp.visible !== false);
    setVal('vp-eyebrow', vp.eyebrow || vp.badge || 'FOR SWEET MAKERS & CONFECTIONERS');
    setVal('vp-heading', vp.heading || 'Become a MITTAI BANDI Vendor');
    setVal('vp-desc', vp.description || vp.subheading || 'Bring your traditional sweets and authentic flavours to more customers. Join MITTAI BANDI and grow your confectionery business digitally.');
    setVal('vp-image', vp.image || 'assets/images/traditional_sweets.png');
    updateThumbPreview('vp-image', 'preview-vp-image');
    setVal('vp-features', (vp.features || []).join('\n'));
    setVal('vp-play-url', vp.googlePlayUrl || vp.playStoreUrl || draftData.global?.vendorPlayStoreUrl || '');
    setVal('vp-apple-url', vp.appStoreUrl || draftData.global?.vendorAppStoreUrl || '');
    setVal('vp-reg-text', vp.registerBtnText || vp.ctaLabel || 'Register as a Vendor');
    setVal('vp-reg-url', vp.registerBtnUrl || vp.ctaHref || '#partner-form');

    // Section 2: Delivery Partner (Android Only)
    setCheck('dp-enabled', dp.enabled !== false && dp.visible !== false);
    setVal('dp-eyebrow', dp.eyebrow || dp.badge || 'FOR DELIVERY FLEET & LOGISTICS PARTNERS');
    setVal('dp-heading', dp.heading || 'Deliver Happiness with MITTAI BANDI');
    setVal('dp-desc', dp.description || dp.subheading || 'Join our delivery network and help bring authentic traditional sweets to customers.');
    setVal('dp-image', dp.image || 'assets/sweets/step3-fulfilment.jpg');
    updateThumbPreview('dp-image', 'preview-dp-image');
    setVal('dp-features', (dp.features || []).join('\n'));
    setVal('dp-play-url', dp.googlePlayUrl || dp.playStoreUrl || draftData.global?.deliveryPlayStoreUrl || '');
    setVal('dp-android-text', dp.androidAppText || dp.playStoreLabel || 'Download Android App (Google Play)');
    setVal('dp-reg-text', dp.registerBtnText || dp.ctaLabel || 'Become a Delivery Partner');
    setVal('dp-reg-url', dp.registerBtnUrl || dp.ctaHref || '#partner-form');
  }

  function savePartnerModule(silent = false) {
    draftData.pages = draftData.pages || {};
    draftData.pages.partner = draftData.pages.partner || { sections: {} };
    const secs = draftData.pages.partner.sections = draftData.pages.partner.sections || {};

    const getVal = id => document.getElementById(id)?.value?.trim() || '';
    const getCheck = id => !!document.getElementById(id)?.checked;

    // Partner Hero
    const pHero = secs['partner-hero'] = secs['partner-hero'] || { name: 'Partner Hero Banner' };
    pHero.enabled = getCheck('p-hero-enabled');
    pHero.visible = pHero.enabled;
    pHero.eyebrow = getVal('p-hero-eyebrow');
    pHero.badge = pHero.eyebrow;
    pHero.heading = getVal('p-hero-heading');
    pHero.description = getVal('p-hero-desc');
    pHero.subheading = pHero.description;
    pHero.bgImage = getVal('p-hero-bgimage') || 'assets/images/wedding_sweets.png';
    pHero.image = pHero.bgImage;

    // Section 1: Vendor Partnership (Android + iOS)
    const vp = secs['vendor-partnership'] = secs['vendor-partnership'] || { name: 'Vendor / Sweet Maker Partnership' };
    vp.enabled = getCheck('vp-enabled');
    vp.visible = vp.enabled;
    vp.active = vp.enabled;
    vp.eyebrow = getVal('vp-eyebrow');
    vp.badge = vp.eyebrow;
    vp.heading = getVal('vp-heading');
    vp.description = getVal('vp-desc');
    vp.subheading = vp.description;
    vp.image = getVal('vp-image') || 'assets/images/traditional_sweets.png';
    vp.features = (document.getElementById('vp-features')?.value || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    vp.googlePlayUrl = getVal('vp-play-url');
    vp.playStoreUrl = vp.googlePlayUrl;
    vp.appStoreUrl = getVal('vp-apple-url');
    vp.registerBtnText = getVal('vp-reg-text') || 'Register as a Vendor';
    vp.ctaLabel = vp.registerBtnText;
    vp.registerBtnUrl = getVal('vp-reg-url') || '#partner-form';
    vp.ctaHref = vp.registerBtnUrl;

    // Sync to global app links
    draftData.global = draftData.global || {};
    draftData.global.vendorPlayStoreUrl = vp.googlePlayUrl;
    draftData.global.vendorAppStoreUrl = vp.appStoreUrl;

    // Section 2: Delivery Partner (Android Only)
    const dp = secs['delivery-partnership'] = secs['delivery-partnership'] || { name: 'Delivery Partner Section' };
    dp.enabled = getCheck('dp-enabled');
    dp.visible = dp.enabled;
    dp.active = dp.enabled;
    dp.eyebrow = getVal('dp-eyebrow');
    dp.badge = dp.eyebrow;
    dp.heading = getVal('dp-heading');
    dp.description = getVal('dp-desc');
    dp.subheading = dp.description;
    dp.image = getVal('dp-image') || 'assets/sweets/step3-fulfilment.jpg';
    dp.features = (document.getElementById('dp-features')?.value || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    dp.googlePlayUrl = getVal('dp-play-url');
    dp.playStoreUrl = dp.googlePlayUrl;
    dp.androidOnly = true;
    dp.androidAppText = getVal('dp-android-text') || 'Download Android App (Google Play)';
    dp.playStoreLabel = dp.androidAppText;
    dp.registerBtnText = getVal('dp-reg-text') || 'Become a Delivery Partner';
    dp.ctaLabel = dp.registerBtnText;
    dp.registerBtnUrl = getVal('dp-reg-url') || '#partner-form';
    dp.ctaHref = dp.registerBtnUrl;

    draftData.global.deliveryPlayStoreUrl = dp.googlePlayUrl;

    markDirty();
    if (!silent) {
      showToast('Partner With Us sections (Vendor & Delivery Partner) saved!', 'success');
    }
  }

  async function savePartnerAndPublish() {
    savePartnerModule(true);
    await publishToLive();
  }

  // ── 14B. CONTACT & SUPPORT CMS MODULE ───────────────────────────────────────
  function renderContactCmsModule() {
    const contactPage = draftData.pages?.contact || {};
    const secs = contactPage.sections || {};
    const cHero = secs['contact-hero'] || {};
    const channels = secs['channels'] || {};
    const cItems = channels.items || channels.cards || [];
    const supPanels = secs['supportPanels'] || {};
    const orderHelp = supPanels.orderHelp || {};
    const vendorOnb = supPanels.vendorOnboarding || {};
    const safety = secs['foodSafety'] || {};
    const esc = secs['escalation'] || {};
    const escSteps = esc.steps || [];
    const griev = secs['grievance'] || draftData.legalDocuments?.grievance || {};
    const corp = secs['corporate'] || draftData.global?.corporate || {};
    const secAlert = secs['securityAlert'] || {};

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    // 1. Contact Hero
    setCheck('c-hero-enabled', cHero.enabled !== false && cHero.visible !== false);
    setVal('c-hero-eyebrow', cHero.eyebrow || 'Support');
    setVal('c-hero-breadcrumb', cHero.breadcrumb || 'Home / Support / Contact Us');
    setVal('c-hero-heading', cHero.heading || "We're Here to Help.");
    setVal('c-hero-subheading', cHero.subheading || cHero.description || "Whether you have a question about an order, a refund, food safety, a partnership or anything else, reach out through our dedicated support channels below.");

    // 2. Direct Assistance (6 Channels)
    setCheck('c-channels-enabled', channels.enabled !== false && channels.visible !== false);
    setVal('c-channels-eyebrow', channels.eyebrow || 'Direct Assistance');
    setVal('c-channels-heading', channels.heading || 'Get in Touch Directly');
    setVal('c-channels-subheading', channels.subheading || 'Select the specific team best suited to assist with your inquiry for prompt resolution.');

    const defaultChannels = [
      { title: 'Orders & Refunds', badge: 'Priority', desc: 'For order status, delivery queries, missing or damaged items, and refund assistance.', action: 'order@mittaibandi.com', url: 'mailto:order@mittaibandi.com' },
      { title: 'Customer Care Phone', badge: 'Mon–Fri', desc: 'Direct telephone support. Available Monday to Friday, 9:00 am – 6:00 pm (IST).', action: '+91-9494614551', url: 'tel:+919494614551' },
      { title: 'General Enquiries', badge: '', desc: 'Customer feedback, sweet maker partnerships, business questions and account assistance.', action: 'info@mittaibandi.com', url: 'mailto:info@mittaibandi.com' },
      { title: 'Food Safety & Hygiene', badge: '', desc: 'Dedicated desk for food hygiene reports, quality audits and health concerns.', action: 'hygiene@mittaibandi.com', url: 'mailto:hygiene@mittaibandi.com' },
      { title: 'Legal & Regulatory', badge: '', desc: 'Statutory communications, legal notices, copyright, IP and trademark matters.', action: 'legal@mittaibandi.com', url: 'mailto:legal@mittaibandi.com' },
      { title: 'Vendor Partnerships', badge: '', desc: 'List your traditional sweet shop or regional confectionery on MITTAI BANDI.', action: 'Join as a Partner', url: 'partner.html' }
    ];

    for (let i = 1; i <= 6; i++) {
      const itm = cItems[i - 1] || defaultChannels[i - 1];
      setVal(`c-card${i}-title`, itm.title || defaultChannels[i-1].title);
      setVal(`c-card${i}-badge`, itm.badge ?? defaultChannels[i-1].badge);
      setVal(`c-card${i}-desc`, itm.description || itm.desc || defaultChannels[i-1].desc);
      setVal(`c-card${i}-action`, itm.actionText || itm.email || itm.phone || itm.action || defaultChannels[i-1].action);
      setVal(`c-card${i}-url`, itm.actionUrl || itm.url || defaultChannels[i-1].url);
    }

    // 3. Dual Support Panels
    setCheck('c-panels-enabled', supPanels.enabled !== false && supPanels.visible !== false);
    setVal('c-panel-order-badge', orderHelp.badge || 'Fastest Resolution');
    setVal('c-panel-order-title', orderHelp.title || 'Need Help With an Order?');
    setVal('c-panel-order-p1', orderHelp.p1 || 'For the fastest support with an in-progress order, please use call or chat support inside the MITTAI BANDI app. Navigate to “My Orders”, select your active order, and tap the help option.');
    setVal('c-panel-order-p2', orderHelp.p2 || 'For refunds, missing items, or order-related complaints after delivery, write to order@mittaibandi.com. Please include your order number and clear photos of the items. You will receive an official ticket number to track your resolution.');
    setVal('c-panel-order-tip', orderHelp.tip || 'Tip: In-app chat connects you directly with our real-time dispatch and delivery partners.');

    setVal('c-panel-vendor-badge', vendorOnb.badge || 'Vendor Onboarding');
    setVal('c-panel-vendor-title', vendorOnb.title || 'Want to List Your Sweet Shop?');
    setVal('c-panel-vendor-p1', vendorOnb.p1 || 'If you own a sweet shop, bakery, or confectionery and want to expand your reach with MITTAI BANDI, email us at info@mittaibandi.com with your shop name, location, contact number, and FSSAI license number.');
    setVal('c-panel-vendor-p2', vendorOnb.p2 || 'Our vendor onboarding team will review your details and guide you through storefront setup, packaging standards, and digital order management.');
    setVal('c-panel-vendor-btntext', vendorOnb.btnText || 'Partner With Us Page');
    setVal('c-panel-vendor-btnlink', vendorOnb.btnLink || 'partner.html');

    // 4. Food Safety
    setCheck('c-safety-enabled', safety.enabled !== false && safety.visible !== false);
    setVal('c-safety-badge', safety.badge || 'Customer Health & Trust');
    setVal('c-safety-title', safety.title || 'Food Safety and Hygiene Commitment');
    setVal('c-safety-desc', safety.description || 'Your health and satisfaction are our utmost priority. If you experience any hygiene concerns or believe a product made you unwell, please notify us immediately at hygiene@mittaibandi.com with your order number and specific details.');
    setVal('c-safety-advisory', safety.advisory || 'Important Health Advisory: If you require immediate medical care or attention, please consult a certified healthcare professional first before filing a report.');

    // 5. Complaint Escalation
    setCheck('c-escalation-enabled', esc.enabled !== false && esc.visible !== false);
    setVal('c-escalation-eyebrow', esc.eyebrow || 'Resolution Framework');
    setVal('c-escalation-heading', esc.heading || 'Not Satisfied? Escalate Your Complaint');
    setVal('c-escalation-subheading', esc.subheading || 'We maintain a structured four-stage escalation matrix to ensure every issue is fairly and transparently addressed.');

    const defaultSteps = [
      { title: 'In-App Support', description: 'Initiate real-time call or chat support through the MITTAI BANDI app for immediate response on active deliveries.' },
      { title: 'Email Support Desk', description: 'Email order@mittaibandi.com with order details and photos to receive an official complaint ticket number.' },
      { title: 'Priority Phone Line', description: 'If unresolved, call +91-9494614551 (Mon–Fri, 9am–6pm IST) quoting your ticket. We aim to resolve within ~48 hours.' },
      { title: 'Grievance Officer', description: 'For persistent or legal grievances, reach out directly to our statutory Grievance Officer detailed below.' }
    ];

    for (let s = 1; s <= 4; s++) {
      const stepObj = escSteps[s - 1] || defaultSteps[s - 1];
      setVal(`c-step${s}-title`, stepObj.title || defaultSteps[s - 1].title);
      setVal(`c-step${s}-desc`, stepObj.description || defaultSteps[s - 1].description);
    }

    // 6. Grievance Officer
    setCheck('c-grievance-enabled', griev.enabled !== false && griev.visible !== false);
    setVal('c-grievance-title', griev.title || 'Grievance Officer (India)');
    setVal('c-grievance-intro', griev.intro || 'In accordance with the Information Technology Act, 2000 and the Consumer Protection Act, 2019 and the rules established thereunder:');
    setVal('c-grievance-officer', griev.officerName || 'Budi Srinivasa Rao [CEO]');
    setVal('c-grievance-designation', griev.designation || 'CEO');
    setVal('c-grievance-company', griev.companyName || 'Gurmitraa Technologies Pvt Ltd');
    setVal('c-grievance-address', griev.address || 'AVA Road, Rajahmundry – 533106, Andhra Pradesh, India');
    setVal('c-grievance-email', griev.email || griev.officerEmail || 'grievance@mittaibandi.com');
    setVal('c-grievance-phone', griev.phone || griev.officerPhone || '+91-9490532121');
    setVal('c-grievance-hours', griev.hours || 'Monday to Friday, 9:00 am – 6:00 pm IST');
    setVal('c-grievance-sla-ack', griev.slaAcknowledge || '24 Hours');
    setVal('c-grievance-sla-res', griev.slaResolve || '15 Days');

    // 7. Registered Office & FSSAI Number
    setCheck('c-corporate-enabled', corp.enabled !== false && corp.visible !== false);
    setVal('c-corporate-title', corp.title || 'Our Registered Office');
    setVal('c-corporate-name', corp.entityName || 'Gurmitraa Technologies Pvt Ltd');
    setVal('c-corporate-parent-note', corp.parentNote || '(Parent company of MITTAI BANDI)');
    setVal('c-corporate-cin', corp.cin || 'U72900AP2020PTC114398');
    setVal('c-corporate-fssai', corp.fssai || corp.fssaiNumber || '10125018000861');
    setVal('c-corporate-address', corp.address || 'AVA Road, Rajahmundry – 533429, Andhra Pradesh, India');
    setVal('c-corporate-web-label', corp.websiteLabel || 'www.mittaibandi.com');
    setVal('c-corporate-web-url', corp.websiteUrl || 'https://www.mittaibandi.com');
    setVal('c-corporate-email', corp.email || 'mittaibandi@gmail.com');
    setVal('c-corporate-notice', corp.notice || 'Notice: This is our registered corporate office address. Please do not send orders, return parcels, or refund claims by postal mail. Use our digital email or app channels for immediate assistance.');

    // 8. Security Notice
    setCheck('c-security-enabled', secAlert.enabled !== false && secAlert.visible !== false);
    setVal('c-security-title', secAlert.title || 'Stay Safe — Important Security Notice');
    setVal('c-security-message', secAlert.message || 'MITTAI BANDI representatives will never ask for your OTP, credit/debit card number, CVV, UPI PIN, or net-banking credentials via telephone, SMS, WhatsApp, or email. Never share these sensitive credentials with anyone claiming affiliation with MITTAI BANDI. If you encounter any suspicious message or request, report it immediately to our security team at order@mittaibandi.com.');
  }

  function saveContactModule(silent = false) {
    draftData.pages = draftData.pages || {};
    draftData.pages.contact = draftData.pages.contact || { sections: {} };
    const secs = draftData.pages.contact.sections = draftData.pages.contact.sections || {};

    const getVal = id => document.getElementById(id)?.value?.trim() || '';
    const getCheck = id => !!document.getElementById(id)?.checked;

    // 1. Contact Hero
    const cHero = secs['contact-hero'] = secs['contact-hero'] || { name: 'Contact Hero Banner' };
    cHero.enabled = getCheck('c-hero-enabled');
    cHero.visible = cHero.enabled;
    cHero.eyebrow = getVal('c-hero-eyebrow') || 'Support';
    cHero.breadcrumb = getVal('c-hero-breadcrumb') || 'Home / Support / Contact Us';
    cHero.heading = getVal('c-hero-heading') || "We're Here to Help.";
    cHero.subheading = getVal('c-hero-subheading') || '';
    cHero.description = cHero.subheading;

    // 2. Direct Assistance Channels
    const channels = secs['channels'] = secs['channels'] || { name: 'Direct Assistance (6 Channels)' };
    channels.enabled = getCheck('c-channels-enabled');
    channels.visible = channels.enabled;
    channels.eyebrow = getVal('c-channels-eyebrow') || 'Direct Assistance';
    channels.heading = getVal('c-channels-heading') || 'Get in Touch Directly';
    channels.subheading = getVal('c-channels-subheading') || '';

    const iconMap = ['package', 'phone', 'mail', 'shield', 'file-text', 'users'];
    const items = [];
    for (let i = 1; i <= 6; i++) {
      items.push({
        badge: getVal(`c-card${i}-badge`),
        icon: iconMap[i - 1] || 'help-circle',
        title: getVal(`c-card${i}-title`),
        description: getVal(`c-card${i}-desc`),
        actionText: getVal(`c-card${i}-action`),
        actionUrl: getVal(`c-card${i}-url`),
        email: getVal(`c-card${i}-action`),
        url: getVal(`c-card${i}-url`)
      });
    }
    channels.items = items;
    channels.cards = items;

    // 3. Dual Support Panels
    const supPanels = secs['supportPanels'] = secs['supportPanels'] || { name: 'Dual Support Panels (Orders & Vendors)' };
    supPanels.enabled = getCheck('c-panels-enabled');
    supPanels.visible = supPanels.enabled;
    supPanels.orderHelp = {
      badge: getVal('c-panel-order-badge'),
      title: getVal('c-panel-order-title'),
      p1: getVal('c-panel-order-p1'),
      p2: getVal('c-panel-order-p2'),
      tip: getVal('c-panel-order-tip')
    };
    supPanels.vendorOnboarding = {
      badge: getVal('c-panel-vendor-badge'),
      title: getVal('c-panel-vendor-title'),
      p1: getVal('c-panel-vendor-p1'),
      p2: getVal('c-panel-vendor-p2'),
      btnText: getVal('c-panel-vendor-btntext'),
      btnLink: getVal('c-panel-vendor-btnlink')
    };

    // 4. Food Safety
    const safety = secs['foodSafety'] = secs['foodSafety'] || { name: 'Food Safety & Hygiene Commitment' };
    safety.enabled = getCheck('c-safety-enabled');
    safety.visible = safety.enabled;
    safety.badge = getVal('c-safety-badge');
    safety.title = getVal('c-safety-title');
    safety.description = getVal('c-safety-desc');
    safety.advisory = getVal('c-safety-advisory');

    // 5. Complaint Escalation
    const esc = secs['escalation'] = secs['escalation'] || { name: 'Complaint Escalation Framework' };
    esc.enabled = getCheck('c-escalation-enabled');
    esc.visible = esc.enabled;
    esc.eyebrow = getVal('c-escalation-eyebrow');
    esc.heading = getVal('c-escalation-heading');
    esc.subheading = getVal('c-escalation-subheading');
    const steps = [];
    for (let s = 1; s <= 4; s++) {
      steps.push({
        step: String(s),
        title: getVal(`c-step${s}-title`),
        description: getVal(`c-step${s}-desc`)
      });
    }
    esc.steps = steps;

    // 6. Grievance Officer
    const griev = secs['grievance'] = secs['grievance'] || { name: 'Grievance Redressal Officer' };
    griev.enabled = getCheck('c-grievance-enabled');
    griev.visible = griev.enabled;
    griev.title = getVal('c-grievance-title');
    griev.intro = getVal('c-grievance-intro');
    griev.officerName = getVal('c-grievance-officer');
    griev.designation = getVal('c-grievance-designation');
    griev.companyName = getVal('c-grievance-company');
    griev.companyNote = '(Parent company of MITTAI BANDI)';
    griev.address = getVal('c-grievance-address');
    griev.email = getVal('c-grievance-email');
    griev.officerEmail = griev.email;
    griev.phone = getVal('c-grievance-phone');
    griev.officerPhone = griev.phone;
    griev.hours = getVal('c-grievance-hours');
    griev.slaAcknowledge = getVal('c-grievance-sla-ack');
    griev.slaResolve = getVal('c-grievance-sla-res');

    // Also sync to draftData.legalDocuments.grievance
    if (draftData.legalDocuments && draftData.legalDocuments.grievance) {
      const lg = draftData.legalDocuments.grievance;
      lg.officerName = griev.officerName;
      lg.designation = griev.designation;
      lg.companyName = griev.companyName;
      lg.address = griev.address;
      lg.email = griev.email;
      lg.phone = griev.phone;
      lg.hours = griev.hours;
    }

    // 7. Registered Corporate Office & FSSAI Number
    const corp = secs['corporate'] = secs['corporate'] || { name: 'Our Registered Office' };
    corp.enabled = getCheck('c-corporate-enabled');
    corp.visible = corp.enabled;
    corp.title = getVal('c-corporate-title');
    corp.intro = getVal('c-corporate-intro');
    corp.entityName = getVal('c-corporate-name');
    corp.parentNote = getVal('c-corporate-parent-note') || '(Parent company of MITTAI BANDI)';
    corp.cin = getVal('c-corporate-cin');
    corp.fssai = getVal('c-corporate-fssai');
    corp.fssaiNumber = corp.fssai;
    corp.address = getVal('c-corporate-address');
    corp.websiteLabel = getVal('c-corporate-web-label');
    corp.websiteUrl = getVal('c-corporate-web-url');
    corp.email = getVal('c-corporate-email');
    corp.notice = getVal('c-corporate-notice');

    // Also sync to draftData.global.corporate
    draftData.global = draftData.global || {};
    draftData.global.corporate = draftData.global.corporate || {};
    draftData.global.corporate.entityName = corp.entityName;
    draftData.global.corporate.cin = corp.cin;
    draftData.global.corporate.fssai = corp.fssai;
    draftData.global.corporate.fssaiNumber = corp.fssai;
    draftData.global.corporate.address = corp.address;
    draftData.global.corporate.email = corp.email;

    // 8. Security Alert Notice
    const secAlert = secs['securityAlert'] = secs['securityAlert'] || { name: 'Stay Safe Security Notice' };
    secAlert.enabled = getCheck('c-security-enabled');
    secAlert.visible = secAlert.enabled;
    secAlert.title = getVal('c-security-title');
    secAlert.message = getVal('c-security-message');

    markDirty();
    if (!silent) {
      showToast('Contact Management sections and FSSAI details saved to draft!', 'success');
    }
  }

  async function saveContactAndPublish() {
    saveContactModule(true);
    await publishToLive();
  }

  // ── 15. LEGAL DOCUMENTS & POLICIES CMS MODULE ──────────────────────────────
  let activeLegalKey = 'privacy';
  let legalSourceMode = false;

  const LEGAL_ROUTES = {
    privacy: 'privacy-policy.html',
    terms: 'terms-of-service.html',
    refund: 'cancellation-refund.html',
    api: 'api-policy.html',
    grievance: 'contact.html#grievance'
  };

  const LEGAL_NAMES = {
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    refund: 'Cancellation & Refund Policy',
    api: 'API & Integration Policy',
    grievance: 'Grievance Redressal Policy'
  };

  function switchLegalDoc(key) {
    activeLegalKey = key;
    document.querySelectorAll('#legal-doc-tabs .filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.legalKey === key);
    });
    renderLegalDocsModule();
  }

  function renderLegalDocsModule() {
    draftData.legalDocuments = draftData.legalDocuments || {};
    const defDocs = window.MITTAI_DEFAULT_CMS?.legalDocuments || {};
    const doc = draftData.legalDocuments[activeLegalKey] || defDocs[activeLegalKey] || {};
    const pageObj = draftData.pages?.[activeLegalKey] || {};
    const heroSec = pageObj.sections?.hero || {};

    const titleEl = document.getElementById('legal-editor-card-title');
    const routeEl = document.getElementById('legal-editor-route-label');
    if (titleEl) titleEl.textContent = `Edit ${LEGAL_NAMES[activeLegalKey] || activeLegalKey}`;
    if (routeEl) routeEl.innerHTML = `Public Route: <code>/${LEGAL_ROUTES[activeLegalKey] || ''}</code>`;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const activeCheck = document.getElementById('legal-field-active');
    if (activeCheck) activeCheck.checked = (doc.active !== false) && (heroSec.active !== false);

    setVal('legal-field-heading', doc.heading || doc.title || heroSec.heading || pageObj.heading || LEGAL_NAMES[activeLegalKey]);
    setVal('legal-field-date', doc.effectiveDate || heroSec.effectiveDate || pageObj.effectiveDate || 'Effective Date: 12-09-2026 | Last Updated: 26-10-2026');
    setVal('legal-field-subtitle', doc.subtitle || heroSec.subheading || pageObj.subtitle || '');

    const htmlContent = doc.content || heroSec.contentHtml || pageObj.content || '';
    const visualEl = document.getElementById('legal-visual-editor');
    const sourceEl = document.getElementById('legal-field-content');
    if (visualEl) visualEl.innerHTML = htmlContent;
    if (sourceEl) sourceEl.value = htmlContent;

    const grievWrap = document.getElementById('grievance-extra-fields');
    if (grievWrap) {
      if (activeLegalKey === 'grievance') {
        grievWrap.style.display = 'block';
        const gSec = draftData.pages?.contact?.sections?.grievance || {};
        setVal('grievance-officer-name', doc.officerName || gSec.officerName || 'Budi Srinivasa Rao [CEO]');
        setVal('grievance-officer-role', doc.designation || gSec.designation || 'CEO & Grievance Officer');
        setVal('grievance-company', doc.companyName || gSec.companyName || 'Gurmitraa Technologies Pvt Ltd.');
        setVal('grievance-email', doc.email || gSec.officerEmail || gSec.email || 'grievance@mittaibandi.com');
        setVal('grievance-phone', doc.phone || gSec.officerPhone || gSec.phone || '+91-9490532121');
        setVal('grievance-hours', doc.hours || gSec.hours || 'Monday to Saturday, 10:00 AM to 6:00 PM IST');
        setVal('grievance-address', doc.address || gSec.address || 'AVA Road, Rajahmundry, Andhra Pradesh, 533106, India');
      } else {
        grievWrap.style.display = 'none';
      }
    }
  }

  function execLegalCmd(cmd) {
    const visualEl = document.getElementById('legal-visual-editor');
    if (!visualEl) return;
    visualEl.focus();
    document.execCommand(cmd, false, null);
    syncVisualToHtml();
  }

  function execLegalBlock(tag) {
    const visualEl = document.getElementById('legal-visual-editor');
    if (!visualEl) return;
    visualEl.focus();
    document.execCommand('formatBlock', false, tag);
    syncVisualToHtml();
  }

  function toggleLegalSourceMode() {
    legalSourceMode = !legalSourceMode;
    const visualEl = document.getElementById('legal-visual-editor');
    const sourceEl = document.getElementById('legal-field-content');
    const btn = document.getElementById('btn-legal-source-toggle');
    if (!visualEl || !sourceEl) return;

    if (legalSourceMode) {
      sourceEl.value = visualEl.innerHTML;
      visualEl.style.display = 'none';
      sourceEl.style.display = 'block';
      if (btn) btn.innerHTML = `<i data-lucide="eye"></i><span>Visual Editor</span>`;
    } else {
      visualEl.innerHTML = sourceEl.value;
      sourceEl.style.display = 'none';
      visualEl.style.display = 'block';
      if (btn) btn.innerHTML = `<i data-lucide="code"></i><span>HTML Source</span>`;
    }
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function syncVisualToHtml() {
    const visualEl = document.getElementById('legal-visual-editor');
    const sourceEl = document.getElementById('legal-field-content');
    if (visualEl && sourceEl) {
      sourceEl.value = visualEl.innerHTML;
    }
  }

  function syncHtmlToVisual() {
    const visualEl = document.getElementById('legal-visual-editor');
    const sourceEl = document.getElementById('legal-field-content');
    if (visualEl && sourceEl) {
      visualEl.innerHTML = sourceEl.value;
    }
  }

  function saveLegalDocument() {
    const getVal = id => document.getElementById(id)?.value?.trim() || '';
    const active = document.getElementById('legal-field-active')?.checked !== false;
    const heading = getVal('legal-field-heading');
    const effectiveDate = getVal('legal-field-date');
    const subtitle = getVal('legal-field-subtitle');

    const visualEl = document.getElementById('legal-visual-editor');
    const sourceEl = document.getElementById('legal-field-content');
    const contentHtml = legalSourceMode ? (sourceEl?.value || '') : (visualEl?.innerHTML || sourceEl?.value || '');

    draftData.legalDocuments = draftData.legalDocuments || {};
    const doc = draftData.legalDocuments[activeLegalKey] = draftData.legalDocuments[activeLegalKey] || {};
    doc.id = activeLegalKey;
    doc.title = heading;
    doc.heading = heading;
    doc.effectiveDate = effectiveDate;
    doc.subtitle = subtitle;
    doc.content = contentHtml;
    doc.active = active;
    doc.updatedAt = new Date().toISOString();

    if (activeLegalKey === 'grievance') {
      doc.officerName = getVal('grievance-officer-name');
      doc.designation = getVal('grievance-officer-role');
      doc.companyName = getVal('grievance-company');
      doc.email = getVal('grievance-email');
      doc.phone = getVal('grievance-phone');
      doc.hours = getVal('grievance-hours');
      doc.address = getVal('grievance-address');

      draftData.pages = draftData.pages || {};
      draftData.pages.contact = draftData.pages.contact || { sections: {} };
      draftData.pages.contact.sections = draftData.pages.contact.sections || {};
      const gSec = draftData.pages.contact.sections.grievance = draftData.pages.contact.sections.grievance || {};
      gSec.enabled = active;
      gSec.heading = heading;
      gSec.description = subtitle;
      gSec.officerName = doc.officerName;
      gSec.designation = doc.designation;
      gSec.companyName = doc.companyName;
      gSec.email = doc.email;
      gSec.officerEmail = doc.email;
      gSec.phone = doc.phone;
      gSec.officerPhone = doc.phone;
      gSec.hours = doc.hours;
      gSec.address = doc.address;
      gSec.content = contentHtml;

      const gPage = draftData.pages.grievance = draftData.pages.grievance || { sections: {} };
      gPage.sections = gPage.sections || {};
      const gHero = gPage.sections.hero = gPage.sections.hero || {};
      gHero.visible = active;
      gHero.active = active;
      gHero.heading = heading;
      gHero.effectiveDate = effectiveDate;
      gHero.subheading = subtitle;
      gHero.contentHtml = contentHtml;
    } else {
      draftData.pages = draftData.pages || {};
      const pObj = draftData.pages[activeLegalKey] = draftData.pages[activeLegalKey] || {};
      pObj.heading = heading;
      pObj.effectiveDate = effectiveDate;
      pObj.subtitle = subtitle;
      pObj.content = contentHtml;
      pObj.active = active;
      pObj.sections = pObj.sections || {};
      const hSec = pObj.sections.hero = pObj.sections.hero || {};
      hSec.visible = active;
      hSec.active = active;
      hSec.heading = heading;
      hSec.effectiveDate = effectiveDate;
      hSec.subheading = subtitle;
      hSec.contentHtml = contentHtml;

      if (activeLegalKey === 'api') {
        draftData.legalDocuments['api-policy'] = doc;
        draftData.pages['api-policy'] = pObj;
      }
    }

    // Synchronize visibility of matching legal links in draftData.footer
    if (draftData.footer) {
      const matchRoute = LEGAL_ROUTES[activeLegalKey] || `${activeLegalKey}.html`;
      if (Array.isArray(draftData.footer.legalLinks)) {
        draftData.footer.legalLinks.forEach(l => {
          if (l && ((l.href && l.href.includes(matchRoute)) || (l.id && l.id.includes(activeLegalKey)))) {
            l.visible = active;
          }
        });
      }
      if (Array.isArray(draftData.footer.bottomLinks)) {
        draftData.footer.bottomLinks.forEach(l => {
          if (l && ((l.href && l.href.includes(matchRoute)) || (l.id && l.id.includes(activeLegalKey)))) {
            l.visible = active;
          }
        });
      }
    }

    markDirty();
    showToast(`${LEGAL_NAMES[activeLegalKey] || 'Legal Document'} saved to draft!`, 'success');
  }

  async function saveLegalAndPublish() {
    saveLegalDocument();
    await publishToLive();
  }

  function previewCurrentLegalDoc() {
    saveLegalDocument();
    const pageMap = {
      privacy: 'privacy-policy.html',
      terms: 'terms-of-service.html',
      refund: 'cancellation-refund.html',
      api: 'api-policy.html',
      grievance: 'contact.html'
    };
    openLivePreviewPage(pageMap[activeLegalKey] || 'privacy-policy.html');
  }

  // ── 16. APP LINKS MANAGEMENT MODULE ────────────────────────────────────────
  function renderAppLinksModule() {
    const g = draftData.global || {};
    const al = g.appLinks || {};
    const vp = draftData.pages?.partner?.sections?.['vendor-partnership'] || {};
    const dp = draftData.pages?.partner?.sections?.['delivery-partnership'] || {};
    const dl = draftData.pages?.home?.sections?.download || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setVal('app-cust-play', g.playStoreUrl || al.playStore || '');
    setVal('app-cust-apple', g.appStoreUrl || al.appStore || '');
    setVal('app-vendor-play', vp.googlePlayUrl || vp.playStoreUrl || g.vendorPlayStoreUrl || al.vendorPlayStore || '');
    setVal('app-vendor-apple', vp.appStoreUrl || g.vendorAppStoreUrl || al.vendorAppStore || '');
    setVal('app-delivery-play', dp.googlePlayUrl || dp.playStoreUrl || g.deliveryPlayStoreUrl || al.deliveryPlayStore || '');

    setCheck('app-coming-soon-mode', al.comingSoonMode !== false);
    setVal('app-coming-soon-msg', al.comingSoonMessage || 'The MITTAI BANDI Mobile App is launching soon on Google Play and the Apple App Store!');
    const dlBannerImg = dl.bgImage || dl.bannerImage || 'assets/images/Playstore.jpeg';
    setVal('app-download-banner-img', dlBannerImg);
    updateThumbPreview('app-download-banner-img', 'preview-app-download-banner');
  }

  function saveAppLinksModule() {
    const getVal = id => document.getElementById(id)?.value?.trim() || '';
    const getCheck = id => !!document.getElementById(id)?.checked;
    const custPlay = getVal('app-cust-play');
    const custApple = getVal('app-cust-apple');
    const vendorPlay = getVal('app-vendor-play');
    const vendorApple = getVal('app-vendor-apple');
    const deliveryPlay = getVal('app-delivery-play');
    const comingSoonMode = getCheck('app-coming-soon-mode');
    const comingSoonMsg = getVal('app-coming-soon-msg') || 'The MITTAI BANDI Mobile App is launching soon on Google Play and the Apple App Store!';
    const dlBannerImg = getVal('app-download-banner-img') || 'assets/images/Playstore.jpeg';

    draftData.global = draftData.global || {};
    draftData.global.playStoreUrl = custPlay;
    draftData.global.appStoreUrl = custApple;
    draftData.global.vendorPlayStoreUrl = vendorPlay;
    draftData.global.vendorAppStoreUrl = vendorApple;
    draftData.global.deliveryPlayStoreUrl = deliveryPlay;

    draftData.global.appLinks = {
      playStore: custPlay,
      appStore: custApple,
      vendorPlayStore: vendorPlay,
      vendorAppStore: vendorApple,
      deliveryPlayStore: deliveryPlay,
      comingSoonMode: comingSoonMode,
      comingSoonMessage: comingSoonMsg
    };

    if (draftData.pages?.home?.sections?.app) {
      draftData.pages.home.sections.app.googlePlayUrl = custPlay;
      draftData.pages.home.sections.app.appStoreUrl = custApple;
    }
    if (draftData.pages?.home?.sections?.download) {
      draftData.pages.home.sections.download.playStoreUrl = custPlay;
      draftData.pages.home.sections.download.appStoreUrl = custApple;
      draftData.pages.home.sections.download.bgImage = dlBannerImg;
      draftData.pages.home.sections.download.bannerImage = dlBannerImg;
    }
    if (draftData.pages?.partner?.sections?.['vendor-partnership']) {
      draftData.pages.partner.sections['vendor-partnership'].googlePlayUrl = vendorPlay;
      draftData.pages.partner.sections['vendor-partnership'].playStoreUrl = vendorPlay;
      draftData.pages.partner.sections['vendor-partnership'].appStoreUrl = vendorApple;
    }
    if (draftData.pages?.partner?.sections?.['delivery-partnership']) {
      draftData.pages.partner.sections['delivery-partnership'].googlePlayUrl = deliveryPlay;
      draftData.pages.partner.sections['delivery-partnership'].playStoreUrl = deliveryPlay;
      draftData.pages.partner.sections['delivery-partnership'].androidOnly = true;
    }

    markDirty();
    showToast('All App Store & Google Play links updated!', 'success');
  }

  async function saveAppLinksAndPublish() {
    saveAppLinksModule();
    await publishToLive();
  }

  // Public Interface
  return {
    switchModule,
    openPageShortcut,
    switchPage,
    saveDraft,
    publishToLive,
    renderHeroModule,
    renderHeroInlinePreview,
    saveHeroModule,
    saveHeroAndPublish,
    handleHeroYouTubeInput,
    setHeroPreviewMode,
    handleHeroVideoUpload,
    renderImageLibraryModule,
    setImageLibraryFilter,
    syncWebsiteImagesIntoLibrary,
    openImageLightbox,
    openUploadModalForField,
    openReplaceImageModal,
    handleUploadModalFileSelect,
    handleUploadModalUrlInput,
    confirmImageUploadAndSave,
    openEditImageDetailsModal,
    saveImageDetailsModal,
    renderPartnerCmsModule,
    savePartnerModule,
    savePartnerAndPublish,
    renderContactCmsModule,
    saveContactModule,
    saveContactAndPublish,
    switchLegalDoc,
    renderLegalDocsModule,
    execLegalCmd,
    execLegalBlock,
    toggleLegalSourceMode,
    syncVisualToHtml,
    syncHtmlToVisual,
    saveLegalDocument,
    saveLegalAndPublish,
    previewCurrentLegalDoc,
    renderAppLinksModule,
    saveAppLinksModule,
    saveAppLinksAndPublish,
    openLivePreviewPage,
    saveBrandingModule,
    savePreloaderModule,
    saveDesignModule,
    saveHeaderModule,
    saveFooterModule,
    renderBannersModule,
    filterBanners,
    setBannerStatusFilter,
    toggleBannerBtn2Fields,
    openBannerEditor,
    saveBannerForm,
    saveBannerAndPublish,
    publishBannersLive,
    toggleBannerActive,
    reorderBanner,
    deleteBanner,
    resetBannersToDefault,
    handleBannerImageUpload,
    setBannerPreviewDevice,
    adminPreviewNext,
    adminPreviewPrev,
    savePageSEO,
    savePolicyPage,
    save404Page,
    addNavLink,
    editNavLink,
    moveNavLink,
    deleteNavLink,
    addFooterLink,
    editFooterLink,
    moveFooterLink,
    deleteFooterLink,
    moveSection,
    toggleSection,
    editSectionModal,
    saveSectionModal,
    addSectionItem,
    moveSectionItem,
    deleteSectionItem,
    filterMedia,
    handleMediaUpload,
    addMediaByUrl,
    deleteMediaItem,
    openMediaPicker,
    selectPickerMedia,
    filterSubmissionsTab,
    renderSubmissionsModule,
    viewSubmissionModal,
    deleteSubmission,
    exportSubmissionsCSV,
    handleChangePasswordSubmit,
    exportBackupJSON,
    importBackupJSON,
    resetToDefaults,
    openLivePreview,
    setPreviewDevice,
    changePreviewPage,
    closeModal,
    updateThumbPreview,
    copyToClipboard
  };
})();

