/**
 * MITTAI BANDI — Core Interactions v2.0
 * Powered by GURMITRAA Technologies Pvt. Ltd.
 */

/* ═══════════════════════════════════════════════
   HERO REVEAL (Immediate display on load)
═══════════════════════════════════════════════ */
function initHeroReveal() {
  document.querySelectorAll('.hero .reveal, .hero .reveal-left, .hero .reveal-right').forEach(el => {
    el.classList.add('visible');
  });
}

/* ═══════════════════════════════════════════════
   SMOOTH SCROLL (for anchor links)
═══════════════════════════════════════════════ */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();

      // Close mobile menu if open
      const toggle = document.querySelector('.nav-toggle');
      const mobileMenu = document.querySelector('.nav-mobile-menu');
      if (toggle && mobileMenu) {
        toggle.classList.remove('open');
        mobileMenu.classList.remove('open');
      }

      const navHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 76;
      const targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight;

      window.scrollTo({ top: targetTop, behavior: 'smooth' });

      // Update active nav link
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      const activeLink = document.querySelector(`.nav-link[href="${href}"]`);
      if (activeLink) activeLink.classList.add('active');
    });
  });
}

/* ═══════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════ */
function initNavigation() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  const toggle = document.querySelector('.nav-toggle');
  const mobileMenu = document.querySelector('.nav-mobile-menu');

  // Scroll behavior — transparent on hero, dark on scroll
  const handleScroll = () => {
    const scrolled = window.scrollY > 60;
    nav.classList.toggle('scrolled', scrolled);
    nav.classList.toggle('transparent', !scrolled);
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Set initial state

  // Active section detection on scroll
  const sections = document.querySelectorAll('section[id], div[id]');
  const navLinks = document.querySelectorAll('.nav-link[href^="#"]');

  if (sections.length && navLinks.length) {
    const navHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 76;

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
          });
        }
      });
    }, { rootMargin: `-${navHeight}px 0px -60% 0px`, threshold: 0 });

    sections.forEach(s => sectionObserver.observe(s));
  }

  // Mobile menu toggle
  if (toggle && mobileMenu) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.classList.contains('open');
      toggle.classList.toggle('open', !isOpen);
      toggle.setAttribute('aria-expanded', String(!isOpen));
      mobileMenu.classList.toggle('open', !isOpen);
    });
  }

  // Active link for non-anchor (page) links
  const rawPath = window.location.pathname.replace(/\/$/, '') || '/';
  const cleanPath = rawPath.replace(/\.html$/, '');
  document.querySelectorAll('.nav-link[href]:not([href^="#"])').forEach(link => {
    let href = link.getAttribute('href') || '';
    if (href.startsWith('http')) {
      try { href = new URL(href).pathname; } catch (_) {}
    }
    const cleanHref = href.replace(/\/$/, '').replace(/\.html$/, '') || '/';
    if (cleanHref === cleanPath || (cleanPath === '/' && (cleanHref === '/' || cleanHref === '/index'))) {
      link.classList.add('active');
    }
  });
}

/* ═══════════════════════════════════════════════
   SCROLL REVEAL
═══════════════════════════════════════════════ */
function initScrollReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => {
      el.classList.add('visible');
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.05,
    rootMargin: '0px 0px -20px 0px',
  });

  document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => observer.observe(el));
}

/* ═══════════════════════════════════════════════
   PARALLAX
═══════════════════════════════════════════════ */
function initParallax() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const elements = document.querySelectorAll('[data-parallax]');
  if (!elements.length) return;

  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        elements.forEach(el => {
          const speed = parseFloat(el.dataset.parallax) || 0.15;
          const rect = el.getBoundingClientRect();
          const center = rect.top + rect.height / 2 - window.innerHeight / 2;
          el.style.transform = `translateY(${center * speed}px)`;
        });
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

/* ═══════════════════════════════════════════════
   PAGE TRANSITIONS (for non-anchor page links)
═══════════════════════════════════════════════ */
function initPageTransitions() {
  const overlay = document.querySelector('.page-transition');
  if (!overlay) return;

  overlay.classList.add('exiting');
  setTimeout(() => { overlay.style.display = 'none'; }, 600);

  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') ||
        href.startsWith('tel:') || href.startsWith('http') ||
        link.hasAttribute('target')) return;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      overlay.style.display = 'block';
      overlay.classList.remove('exiting');
      overlay.classList.add('entering');
      setTimeout(() => { window.location.href = href; }, 480);
    });
  });
}

/* ═══════════════════════════════════════════════
   COUNTERS
═══════════════════════════════════════════════ */
function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const duration = parseInt(el.dataset.duration, 10) || 1800;
  const suffix = el.dataset.suffix || '';
  const start = Date.now();

  const update = () => {
    const progress = Math.min((Date.now() - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function initCounters() {
  const counters = document.querySelectorAll('[data-counter]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
}

/* ═══════════════════════════════════════════════
   FORM VALIDATION
═══════════════════════════════════════════════ */
function validateField(group) {
  const input = group.querySelector('input, select, textarea');
  const error = group.querySelector('.form-error');
  group.classList.remove('error');

  if (!input || !input.value.trim()) {
    group.classList.add('error');
    if (error) error.textContent = 'This field is required.';
    return false;
  }
  if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
    group.classList.add('error');
    if (error) error.textContent = 'Please enter a valid email address.';
    return false;
  }
  if (input.type === 'tel' && !/^[\d\s\+\-\(\)]{6,}$/.test(input.value)) {
    group.classList.add('error');
    if (error) error.textContent = 'Please enter a valid phone number.';
    return false;
  }
  return true;
}

function validateForm(form) {
  let valid = true;
  form.querySelectorAll('.form-group[data-required]').forEach(group => {
    if (!validateField(group)) valid = false;
  });
  return valid;
}

function initForms() {
  document.querySelectorAll('[data-form]').forEach(form => {
    // Real-time validation on blur
    form.querySelectorAll('.form-group[data-required] input, .form-group[data-required] textarea, .form-group[data-required] select').forEach(input => {
      input.addEventListener('blur', () => {
        validateField(input.closest('.form-group'));
      });
      input.addEventListener('input', () => {
        const group = input.closest('.form-group');
        if (group?.classList.contains('error')) validateField(group);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(form)) {
        showToast('Please fill all required fields correctly.', 'error');
        return;
      }

      const submitBtn = form.querySelector('[type="submit"]');
      const originalText = submitBtn?.textContent || 'Submit';
      const successEl = form.nextElementSibling?.classList.contains('form-success')
        ? form.nextElementSibling : null;

      if (submitBtn) {
        submitBtn.textContent = 'Opening WhatsApp…';
        submitBtn.disabled = true;
      }

      const rawData = Object.fromEntries(new FormData(form).entries());
      const formType = form.getAttribute('data-form') || 'contact';

      // ── Background Firebase RTDB attempt (non-blocking) ──
      const firebase = window.MB_Firebase;
      if (firebase) {
        try {
          if (formType === 'partner-registration') {
            firebase.savePartnerRegistration(rawData);
          } else {
            firebase.saveContactSubmission(rawData);
          }
        } catch (err) {
          console.warn('[MITTAI BANDI] Background RTDB save skipped:', err);
        }
      }

      // ── Build WhatsApp message ──
      const typeTitle = formType === 'partner-registration'
        ? 'MITTAI BANDI – Partner Registration'
        : 'MITTAI BANDI – Contact Enquiry';

      const lines = [
        `*${typeTitle}*`,
        '--------------------------------'
      ];

      const fieldLabels = {
        businessName: 'Business Name',
        ownerName: 'Owner / Contact Person',
        name: 'Full Name',
        phone: 'Mobile Number',
        email: 'Email Address',
        location: 'Business Location',
        category: 'Business Category',
        subject: 'Subject',
        description: 'Business Description',
        message: 'Message'
      };

      for (const [key, value] of Object.entries(rawData)) {
        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (trimmed) {
          const label = fieldLabels[key] || (key.charAt(0).toUpperCase() + key.slice(1));
          lines.push(`• *${label}:* ${trimmed}`);
        }
      }

      lines.push('--------------------------------');
      lines.push('Submitted via www.mittaibandi.com');

      const waMessage = lines.join('\n');
      const waNumber = '919490532121';
      const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(waMessage)}`;

      showToast('Opening WhatsApp to send your enquiry to +91 94905 32121...', 'success');

      // Update success message UI
      if (successEl) {
        successEl.innerHTML = `
          <div style="text-align:center; padding: 1.5rem 0;">
            <div style="width:54px; height:54px; border-radius:50%; background:rgba(22,139,50,0.12); color:#168B32; display:inline-flex; align-items:center; justify-content:center; margin-bottom:1rem;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h3 class="display-sm" style="margin-bottom:0.5rem; color:var(--color-text-primary,#111827);">Ready to Send via WhatsApp</h3>
            <p class="body-base" style="max-width:440px; margin:0 auto 1.25rem; color:#4A3B43;">Your details have been prefilled. If WhatsApp did not open automatically, click the button below to send your message to <strong>+91 94905 32121</strong>.</p>
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.5rem; text-decoration:none;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.04 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 15 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67Z"/></svg>
              Send via WhatsApp (+91 94905 32121)
            </a>
          </div>
        `;
        form.style.display = 'none';
        successEl.classList.add('visible');
      }

      // Open WhatsApp in new tab/window
      try {
        window.open(waUrl, '_blank');
      } catch (err) {
        console.warn('[MITTAI BANDI] window.open failed:', err);
      }

      setTimeout(() => {
        if (submitBtn) {
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
        }
      }, 2000);
    });
  });
}

/* ═══════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════ */
function showToast(message, type = 'info') {
  const colors = { success: '#16A34A', error: '#C9003D', info: '#111827' };
  const toast = Object.assign(document.createElement('div'), { textContent: message });
  toast.style.cssText = `
    position:fixed; bottom:2rem; left:50%; transform:translateX(-50%) translateY(12px);
    background:${colors[type] || colors.info}; color:#FAF7F0;
    padding:0.875rem 1.75rem; border-radius:9999px;
    font-family:'Manrope',sans-serif; font-size:0.875rem; font-weight:500;
    box-shadow:0 8px 32px rgba(0,0,0,0.2); z-index:99999;
    opacity:0; transition:all 0.4s cubic-bezier(0.16,1,0.3,1);
    max-width:90vw; text-align:center;
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  }));
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(12px)';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

/* ═══════════════════════════════════════════════
   HERO VIDEO
═══════════════════════════════════════════════ */
function initHeroVideo() {
  const video = document.querySelector('.hero-video');
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');

  const attemptPlay = () => {
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        const onFirstInteract = () => {
          video.play().catch(() => {});
          ['click', 'touchstart', 'scroll', 'keydown'].forEach(evt => {
            document.removeEventListener(evt, onFirstInteract);
          });
        };
        ['click', 'touchstart', 'scroll', 'keydown'].forEach(evt => {
          document.addEventListener(evt, onFirstInteract, { once: true, passive: true });
        });
      });
    }
  };

  attemptPlay();
}

/* ═══════════════════════════════════════════════
   BUTTON HOVER — Subtle lift only
═══════════════════════════════════════════════ */
function initButtonEffects() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // No magnetic or tilt — replaced with CSS-only hover effects
}

/* ═══════════════════════════════════════════════
   INITIALIZE
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initHeroReveal();
  initNavigation();
  initSmoothScroll();
  initScrollReveal();
  initParallax();
  initPageTransitions();
  initCounters();
  initForms();
  initHeroVideo();
  initButtonEffects();

  if (typeof initAppDownloadButtons === 'function') initAppDownloadButtons();
  if (typeof initSocialLinks === 'function') initSocialLinks();
});

window.showToast = showToast;
window.validateForm = validateForm;
