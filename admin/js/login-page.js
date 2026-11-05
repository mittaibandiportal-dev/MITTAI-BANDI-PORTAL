/**
 * MITTAI BANDI — Admin Login Page Controller
 * Uses MB_AUTH (Firebase Authentication). No credentials are stored or checked locally.
 */
(function () {
  'use strict';

  if (window.lucide) lucide.createIcons();

  const form = document.getElementById('admin-login-form');
  const alertBox = document.getElementById('login-alert');
  const submitBtn = document.getElementById('btn-login-submit');
  const emailInput = document.getElementById('login-email');
  const pwdInput = document.getElementById('login-password');
  const togglePwdBtn = document.getElementById('toggle-pwd-btn');
  const arrowIcon = document.getElementById('login-arrow-icon');
  const spinner = document.getElementById('login-spinner');

  const forgotModal = document.getElementById('forgot-modal');
  const forgotForm = document.getElementById('forgot-form');
  const forgotEmail = document.getElementById('forgot-email');
  const forgotAlert = document.getElementById('forgot-alert');
  const forgotBtn = document.getElementById('btn-forgot-submit');

  function showAlert(box, message, type) {
    box.textContent = message;
    box.className = 'login-alert ' + type;
    box.style.display = 'flex';
  }
  function hideAlert(box) {
    box.style.display = 'none';
    box.className = 'login-alert';
  }
  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    if (arrowIcon) arrowIcon.style.display = isLoading ? 'none' : 'inline-block';
    if (spinner) spinner.style.display = isLoading ? 'inline-block' : 'none';
  }

  const authCtrl = window.MB_AUTH || (typeof MB_AUTH !== 'undefined' ? MB_AUTH : null);

  if (!authCtrl || (typeof authCtrl.isInitialized === 'function' && !authCtrl.isInitialized())) {
    const origErr = authCtrl && typeof authCtrl.getInitError === 'function' ? authCtrl.getInitError() : null;
    const errDetails = origErr ? ` (${origErr.name}: ${origErr.message})` : '';
    console.error('[Login Page] Authentication controller unavailable:', origErr || 'window.MB_AUTH is undefined');
    showAlert(alertBox, `Authentication service failed to load${errDetails}. Please refresh or check network connectivity.`, 'error');
    submitBtn.disabled = true;
    return;
  }

  // Messages passed via redirect
  const reason = new URLSearchParams(window.location.search).get('reason');
  if (reason === 'unauthorized') {
    showAlert(alertBox, 'Your account is not authorized to access the CMS.', 'error');
  }

  // Skip the form if an admin session is already active (persisted by Firebase)
  authCtrl.redirectIfAuthenticated();

  togglePwdBtn.addEventListener('click', () => {
    const isPwd = pwdInput.type === 'password';
    pwdInput.type = isPwd ? 'text' : 'password';
    togglePwdBtn.textContent = isPwd ? 'Hide' : 'Show';
  });

  // ── Forgot password ────────────────────────────────────────────────────────
  document.getElementById('trigger-forgot-modal').addEventListener('click', () => {
    hideAlert(forgotAlert);
    forgotEmail.value = emailInput.value.trim();
    forgotModal.classList.add('active');
    forgotEmail.focus();
  });
  document.getElementById('close-forgot-modal').addEventListener('click', () => {
    forgotModal.classList.remove('active');
  });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(forgotAlert);
    const email = forgotEmail.value.trim();
    if (!email) {
      showAlert(forgotAlert, 'Please enter your email address.', 'error');
      return;
    }
    forgotBtn.disabled = true;
    forgotBtn.textContent = 'Sending...';
    try {
      const res = await authCtrl.sendPasswordReset(email);
      showAlert(forgotAlert, res.message, res.success ? 'success' : 'error');
    } catch (err) {
      showAlert(forgotAlert, 'Could not send reset email. Please try again.', 'error');
    } finally {
      forgotBtn.disabled = false;
      forgotBtn.textContent = 'Send Password Reset Link';
    }
  });

  // ── Sign in ────────────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertBox);

    const email = emailInput.value.trim();
    const pass = pwdInput.value;
    const remember = document.getElementById('remember-me-check').checked;

    if (!email || !pass) {
      showAlert(alertBox, 'Please enter both email and password.', 'error');
      return;
    }

    setLoading(true);
    try {
      const result = await authCtrl.login(email, pass, remember);
      if (result.success) {
        showAlert(alertBox, 'Signed in successfully. Loading dashboard...', 'success');
        window.location.replace('/admin/index.html');
      } else {
        showAlert(alertBox, result.message, 'error');
        pwdInput.value = '';
        pwdInput.focus();
        setLoading(false);
      }
    } catch (err) {
      showAlert(alertBox, 'Unexpected error during sign-in. Please try again.', 'error');
      setLoading(false);
    }
  });
})();

