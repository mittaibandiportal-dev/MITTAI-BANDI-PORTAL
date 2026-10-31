/**
 * MITTAI BANDI — Cloudinary Media Integration
 * Powered by GURMITRAA Technologies Pvt. Ltd.
 *
 * Safe client-side Cloudinary helper.
 * ✅ Uses: Cloud Name (public) + API Key (public)
 * ❌ Never exposes: API Secret (server-side only)
 *
 * Image assets are served via Cloudinary CDN for:
 *  • Auto-format (WebP/AVIF where supported)
 *  • Auto-quality optimisation
 *  • Responsive resizing
 *  • Global CDN delivery
 *
 * For uploads from the browser, an UNSIGNED upload preset is required.
 * Create one at: Cloudinary Console → Settings → Upload → Upload Presets
 * Set it to "Unsigned" and paste the preset name below.
 */

// ── Cloudinary Configuration (PUBLIC values only) ────────────────────────────
const CLOUDINARY_CONFIG = {
  cloudName:     'gxiycfwv',
  apiKey:        '842848915258761', // public — safe in browser
  // apiSecret NEVER goes here — server-side only
  uploadPreset:  'mittaibandi_unsigned', // ← Create this unsigned preset in Cloudinary Console
  folder:        'mittaibandi',          // folder inside your Cloudinary account
};

// ── Local-to-Cloudinary asset map ─────────────────────────────────────────────
// Maps local image filenames → Cloudinary public IDs.
// After uploading images to Cloudinary, populate these IDs.
// Format: 'local-filename.png': 'cloudinary/public-id'
const ASSET_MAP = {
  'logo.png':                  'mittaibandi/logo',
  'favicon.png':               'mittaibandi/favicon',
  'hero_sweets_bg.png':        'mittaibandi/hero_sweets_bg',
  'artisan_making_sweets.png': 'mittaibandi/artisan_making_sweets',
  'traditional_sweets.png':    'mittaibandi/traditional_sweets',
  'ghee_sweets.png':           'mittaibandi/ghee_sweets',
  'bengali_sweets.png':        'mittaibandi/bengali_sweets',
  'wedding_sweets.png':        'mittaibandi/wedding_sweets',
};

// ── Core URL Builder ──────────────────────────────────────────────────────────
/**
 * Generate an optimised Cloudinary URL.
 *
 * @param {string} publicId   - Cloudinary public ID (e.g. 'mittaibandi/logo')
 * @param {Object} options    - Transformation options
 * @param {number} [options.width]    - Resize width (px)
 * @param {number} [options.height]   - Resize height (px)
 * @param {string} [options.crop]     - Crop mode: 'fill' | 'fit' | 'scale' | 'thumb'
 * @param {string} [options.gravity]  - Crop gravity: 'auto' | 'face' | 'center'
 * @param {string|number} [options.quality]  - 'auto' or 1-100
 * @param {string} [options.format]   - 'auto' | 'webp' | 'avif' | 'png' | 'jpg'
 * @param {string[]} [options.effects] - Array of effect strings e.g. ['e_sharpen']
 * @returns {string} Full Cloudinary URL
 */
function cloudinaryUrl(publicId, options = {}) {
  const {
    width,
    height,
    crop    = 'fill',
    gravity = 'auto',
    quality = 'auto',
    format  = 'auto',
    effects = [],
  } = options;

  const parts = [];

  if (width || height) {
    const dims = [];
    if (width)   dims.push(`w_${width}`);
    if (height)  dims.push(`h_${height}`);
    dims.push(`c_${crop}`, `g_${gravity}`);
    parts.push(dims.join(','));
  }

  parts.push(`q_${quality}`);
  parts.push(`f_${format}`);

  if (effects.length) {
    effects.forEach(e => parts.push(e));
  }

  const transforms = parts.join('/');
  return `https://res.cloudinary.com/${CLOUDINARY_CONFIG.cloudName}/image/upload/${transforms}/${publicId}`;
}

/**
 * Resolve a local asset filename to a Cloudinary-optimised URL.
 * Falls back to the local path if the asset isn't in ASSET_MAP yet.
 *
 * @param {string} filename   - e.g. 'logo.png'
 * @param {Object} [options]  - Same options as cloudinaryUrl()
 * @returns {string}
 */
function assetUrl(filename, options = {}) {
  const publicId = ASSET_MAP[filename];
  if (!publicId) {
    // Not yet uploaded to Cloudinary — use local fallback
    console.warn(`[Cloudinary] "${filename}" not in ASSET_MAP. Using local fallback.`);
    return `assets/images/${filename}`;
  }
  return cloudinaryUrl(publicId, options);
}

/**
 * Generate a responsive srcset string for an image.
 *
 * @param {string} filename   - local asset filename
 * @param {number[]} widths   - array of widths e.g. [400, 800, 1200]
 * @param {Object} [options]  - base transformation options (minus width)
 * @returns {string}          - srcset value
 */
function srcset(filename, widths = [400, 800, 1200, 1600], options = {}) {
  const publicId = ASSET_MAP[filename];
  if (!publicId) return '';
  return widths
    .map(w => `${cloudinaryUrl(publicId, { ...options, width: w })} ${w}w`)
    .join(', ');
}

// ── Unsigned Upload (browser → Cloudinary directly) ───────────────────────────
/**
 * Upload a file directly from the browser to Cloudinary using an unsigned preset.
 * NOTE: You must create an unsigned upload preset named 'mittaibandi_unsigned'
 *       in your Cloudinary Console → Settings → Upload → Upload Presets.
 *
 * @param {File}   file           - File object from <input type="file">
 * @param {Object} [uploadOptions]
 * @param {string} [uploadOptions.folder]   - Override default folder
 * @param {string} [uploadOptions.preset]   - Override default upload preset
 * @param {Function} [uploadOptions.onProgress] - (percent: number) => void
 * @returns {Promise<Object>} Cloudinary upload response
 */
async function uploadFile(file, uploadOptions = {}) {
  const {
    folder   = CLOUDINARY_CONFIG.folder,
    preset   = CLOUDINARY_CONFIG.uploadPreset,
    onProgress,
  } = uploadOptions;

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', preset);
  formData.append('api_key', CLOUDINARY_CONFIG.apiKey);
  formData.append('folder', folder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const response = JSON.parse(xhr.responseText);
        console.info(`[Cloudinary] Uploaded: ${response.public_id} → ${response.secure_url}`);
        resolve(response);
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.open('POST', endpoint);
    xhr.send(formData);
  });
}

// ── Auto-enhance all <img> tags on the page ──────────────────────────────────
/**
 * Scans all <img> elements with src pointing to assets/images/*.
 * Replaces them with optimised Cloudinary URLs + srcset where mapped.
 * Call this after DOMContentLoaded.
 */
function enhancePageImages() {
  const imgs = document.querySelectorAll('img[src^="assets/images/"]');
  let enhanced = 0;

  imgs.forEach(img => {
    const filename = img.src.split('/').pop();
    const publicId = ASSET_MAP[filename];
    if (!publicId) return;

    const w = img.naturalWidth || img.width || 800;

    // Replace src with optimised Cloudinary URL
    img.src = cloudinaryUrl(publicId, { width: Math.min(w * 2, 1600), quality: 'auto', format: 'auto' });

    // Add srcset for responsive delivery
    const ss = srcset(filename, [400, 800, 1200, 1600]);
    if (ss) {
      img.srcset = ss;
      img.sizes = img.sizes || '(max-width: 768px) 100vw, 50vw';
    }

    enhanced++;
  });

  if (enhanced > 0) {
    console.info(`%c[Cloudinary] Enhanced ${enhanced} image(s) with CDN delivery ✓`, 'color:#C99D3D;font-weight:600;');
  }
}

// ── Expose on window ──────────────────────────────────────────────────────────
window.MB_Cloudinary = {
  config:       CLOUDINARY_CONFIG,
  url:          cloudinaryUrl,
  assetUrl,
  srcset,
  uploadFile,
  enhancePageImages,
};

// Auto-enhance images when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enhancePageImages);
} else {
  enhancePageImages();
}

console.info('%c[MITTAI BANDI] Cloudinary CDN initialised ✓', 'color:#C99D3D;font-weight:600;');
