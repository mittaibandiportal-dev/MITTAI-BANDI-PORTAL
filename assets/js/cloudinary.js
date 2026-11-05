// ============================================
// MITTAI BANDI — UNIFIED MEDIA & IMAGE STORAGE ENGINE
// Reliable Client-Side Optimization + Firebase RTDB Persistence
// Eliminates Cloudinary 400 Preset Errors & LocalStorage Quota Failures
// ============================================

const MB_CLOUDINARY = (function () {
  'use strict';

  const MAX_DIMENSION = 1280;
  const DEFAULT_QUALITY = 0.78;
  const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB max input

  /**
   * Checks if an image drawn on a canvas has any non-opaque (transparent) pixels.
   */
  function hasTransparentPixels(ctx, width, height) {
    try {
      // Sample a grid of pixels for speed
      const stepX = Math.max(1, Math.floor(width / 40));
      const stepY = Math.max(1, Math.floor(height / 40));
      const imgData = ctx.getImageData(0, 0, width, height).data;
      for (let y = 0; y < height; y += stepY) {
        for (let x = 0; x < width; x += stepX) {
          const alphaIdx = (y * width + x) * 4 + 3;
          if (imgData[alphaIdx] < 250) {
            return true;
          }
        }
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  /**
   * Read a File/Blob directly as a Data URL
   */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('Failed to read file from disk.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Optimizes and compresses an image file via HTML5 Canvas for reliable,
   * fast persistence in Firebase Realtime Database without 400 errors.
   */
  function optimizeImageFile(file, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!file) {
          return reject(new Error('No file provided for upload.'));
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return reject(new Error('File size exceeds 15MB limit. Please choose a smaller file.'));
        }

        const mime = (file.type || '').toLowerCase();
        const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();

        // For SVG, ICO, GIF, or very small files (< 80KB), preserve exact original Data URL
        if (
          mime === 'image/svg+xml' ||
          mime === 'image/gif' ||
          mime === 'image/x-icon' ||
          ext === 'svg' ||
          ext === 'ico' ||
          ext === 'gif'
        ) {
          const dataUrl = await readFileAsDataURL(file);
          return resolve({
            secure_url: dataUrl,
            url: dataUrl,
            public_id: 'mb_asset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            format: ext || 'svg',
            width: 0,
            height: 0,
            bytes: file.size,
            original_filename: file.name,
            storage: 'firebase-rtdb'
          });
        }

        // For video files, enforce reasonable size for RTDB or suggest path/URL
        if (mime.startsWith('video/')) {
          if (file.size > 4 * 1024 * 1024) {
            return reject(new Error('Video file is over 4MB. Please use a compressed MP4/WebM clip or enter a video URL/path.'));
          }
          const dataUrl = await readFileAsDataURL(file);
          return resolve({
            secure_url: dataUrl,
            url: dataUrl,
            public_id: 'mb_video_' + Date.now(),
            format: ext || 'mp4',
            width: 1920,
            height: 1080,
            bytes: file.size,
            original_filename: file.name,
            storage: 'firebase-rtdb'
          });
        }

        // Raster image processing (JPEG, PNG, WEBP, AVIF, etc.)
        const rawDataUrl = await readFileAsDataURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const origW = img.naturalWidth || img.width || 800;
            const origH = img.naturalHeight || img.height || 600;
            const maxDim = options.maxDimension || MAX_DIMENSION;

            let targetW = origW;
            let targetH = origH;

            if (origW > maxDim || origH > maxDim) {
              if (origW >= origH) {
                targetW = maxDim;
                targetH = Math.round((origH * maxDim) / origW);
              } else {
                targetH = maxDim;
                targetW = Math.round((origW * maxDim) / origH);
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');

            // High-quality bicubic-like smoothing
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, targetW, targetH);

            // Detect transparency for PNG/WebP
            const isPngOrWebp = mime.includes('png') || mime.includes('webp');
            const needsAlpha = isPngOrWebp && hasTransparentPixels(ctx, targetW, targetH);

            let outputMime = 'image/jpeg';
            let outputFormat = 'jpg';
            let quality = options.quality || DEFAULT_QUALITY;

            // Try WebP first if transparency is needed (much smaller than PNG), fallback to PNG
            if (needsAlpha) {
              const webpTest = canvas.toDataURL('image/webp', quality);
              if (webpTest && webpTest.startsWith('data:image/webp')) {
                outputMime = 'image/webp';
                outputFormat = 'webp';
              } else {
                outputMime = 'image/png';
                outputFormat = 'png';
              }
            } else {
              // Opaque image: use WebP or JPEG for optimal size & crispness
              const webpTest = canvas.toDataURL('image/webp', quality);
              if (webpTest && webpTest.startsWith('data:image/webp')) {
                outputMime = 'image/webp';
                outputFormat = 'webp';
              } else {
                outputMime = 'image/jpeg';
                outputFormat = 'jpg';
              }
            }

            let optimizedDataUrl = canvas.toDataURL(outputMime, quality);

            // If original file was already small (< 120KB) and optimized is larger, keep original
            if (file.size < 120 * 1024 && rawDataUrl.length < optimizedDataUrl.length) {
              optimizedDataUrl = rawDataUrl;
              outputFormat = ext || outputFormat;
            }

            const approxBytes = Math.round((optimizedDataUrl.length * 3) / 4);

            resolve({
              secure_url: optimizedDataUrl,
              url: optimizedDataUrl,
              public_id: 'mb_img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              format: outputFormat,
              width: targetW,
              height: targetH,
              bytes: approxBytes,
              original_filename: file.name,
              storage: 'firebase-rtdb'
            });
          } catch (canvasErr) {
            // Fallback to raw DataURL if canvas fails
            resolve({
              secure_url: rawDataUrl,
              url: rawDataUrl,
              public_id: 'mb_img_' + Date.now(),
              format: ext || 'jpg',
              width: img.naturalWidth || 800,
              height: img.naturalHeight || 600,
              bytes: file.size,
              original_filename: file.name,
              storage: 'firebase-rtdb'
            });
          }
        };

        img.onerror = () => {
          reject(new Error('Invalid or corrupted image file. Please select a valid PNG, JPG, WEBP, or SVG image.'));
        };

        img.src = rawDataUrl;
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Upload a File or Blob and report progress smoothly.
   * Uses our unified client-side optimizer + Firebase RTDB storage engine.
   *
   * @param {File|Blob} file - The file from an <input type="file"> or drag-drop
   * @param {Object} options - Optional { folder, resourceType, onProgress }
   * @returns {Promise<Object>} Resolves with { secure_url, public_id, format, width, height, bytes, original_filename }
   */
  async function uploadFile(file, options = {}) {
    if (!file) {
      throw new Error('No file provided for upload.');
    }

    if (typeof options.onProgress === 'function') {
      options.onProgress(15);
    }

    const result = await optimizeImageFile(file, options);

    if (typeof options.onProgress === 'function') {
      options.onProgress(100);
    }

    return result;
  }

  /**
   * Normalizes an asset URL so it displays properly in both Admin (/admin/) and Public (/) pages.
   */
  function resolveAssetUrl(url, isAdminContext = false) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('blob:')
    ) {
      return trimmed;
    }
    // Clean leading ../ or /
    const cleanRel = trimmed.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
    if (isAdminContext) {
      return '../' + cleanRel;
    }
    return cleanRel;
  }

  /**
   * Opens a native file dialog, processes the selected image/video, and passes the URL to callback
   */
  function openUploadAndAssign(inputElOrCallback, accept = 'image/*') {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = accept;
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      document.body.removeChild(fileInput);
      if (!file) return;

      try {
        const result = await uploadFile(file);
        if (typeof inputElOrCallback === 'function') {
          inputElOrCallback(result.secure_url, result);
        } else if (inputElOrCallback && inputElOrCallback.value !== undefined) {
          inputElOrCallback.value = result.secure_url;
          inputElOrCallback.dispatchEvent(new Event('input', { bubbles: true }));
          inputElOrCallback.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (err) {
        console.error('[Media Upload] Error:', err);
        alert('Upload failed: ' + err.message);
      }
    });

    fileInput.click();
  }

  return {
    uploadFile,
    optimizeImageFile,
    resolveAssetUrl,
    openUploadAndAssign,
    STORAGE_ENGINE: 'firebase-rtdb'
  };
})();

window.MB_CLOUDINARY = MB_CLOUDINARY;
window.MB_Cloudinary = MB_CLOUDINARY;

