// auth.js - log in, sign up, forgot password, the account block, and idle sign-out.

window.GAP = window.GAP || {};

GAP.auth = (() => {
  const { $, $$, h, icon, setError, fieldError, toast, withBusy, copyWithToast } = GAP.ui;
  const api = GAP.api;
  const IDLE_MS = 20 * 60 * 1000;

  let returnTo = null;
  let resetToken = null;
  let lastActivity = Date.now();
  const PANELS = ['login', 'signup', 'welcome', 'forgot', 'reset'];
  const TITLES = { login: 'Log in', signup: 'Create your account', welcome: 'Welcome to GAP Compiler', forgot: 'Reset your password', reset: 'Choose a new password' };

  const retryText = (err) => {
    if (!err.retryAfter) return err.message;
    const mins = Math.ceil(err.retryAfter / 60);
    return `${err.message} Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`;
  };

  function show(panel, notice) {
    for (const p of PANELS) $(`#panel-${p}`).hidden = p !== panel;
    const tabbed = panel === 'login' || panel === 'signup';
    $('#auth-tabs').hidden = !tabbed;
    for (const t of $$('#auth-tabs .tab')) {
      const on = t.dataset.tab === panel;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    $('#h-auth').textContent = TITLES[panel];
    const n = $('#auth-notice');
    n.textContent = notice || '';
    n.hidden = !notice;
    for (const e of $$('#view-auth .error')) setError(e, '');
    for (const i of $$('#view-auth input[aria-invalid]')) i.removeAttribute('aria-invalid');
    const first = { login: '#login-id', signup: '#su-name', forgot: '#fp-id', reset: '#rp-pw' }[panel];
    if (first) setTimeout(() => $(first).focus(), 0);
  }

  // Send a signed-out visitor to the login page and bring them back afterwards.
  function require(route, message) {
    returnTo = route;
    GAP.auth.pendingNotice = message || null;
    location.hash = '#/login';
  }

  function finish() {
    const dest = returnTo || '#/playground';
    returnTo = null;
    location.hash = dest;
  }

  // ---------- log in ----------
  async function onLogin(e) {
    e.preventDefault();
    const id = $('#login-id');
    const pw = $('#login-pw');
    setError($('#login-form-err'), '');
    fieldError(id, id.value.trim() ? '' : 'Enter your Student ID.');
    fieldError(pw, pw.value ? '' : 'Enter your password.');
    if (!id.value.trim() || !pw.value) return;
    const shared = $('#login-shared').checked;
    await withBusy($('#btn-login'), 'Logging in', async () => {
      try {
        const res = await api.login({ studentId: id.value.trim(), password: pw.value, shared });
        pw.value = '';
        toast(`Welcome back, ${res.student.fullName.split(' ')[0]}.`, 'success');
        api.setSession(res.token, res.student, shared); // the router sends them on from here
      } catch (err) {
        setError($('#login-form-err'), retryText(err));
        pw.value = '';
        pw.focus();
      }
    });
  }

  // ---------- sign up ----------
  async function onSignup(e) {
    e.preventDefault();
    const name = $('#su-name'), mobile = $('#su-mobile'), pw = $('#su-pw'), pw2 = $('#su-pw2');
    setError($('#su-form-err'), '');
    const digits = mobile.value.replace(/[\s\-().+]/g, '');
    const problems = [
      [name, name.value.trim().length >= 2 ? '' : 'Enter your full name.'],
      [mobile, /^\d{10,15}$/.test(digits) && /^[+\d\s\-().]+$/.test(mobile.value) ? '' : 'Enter a valid mobile number, 10 to 15 digits.'],
      [pw, pw.value.length >= 8 ? '' : 'Use at least 8 characters.'],
      [pw2, pw2.value === pw.value ? '' : 'Passwords do not match.']
    ];
    problems.forEach(([input, msg]) => fieldError(input, msg));
    const firstBad = problems.find(([, msg]) => msg);
    if (firstBad) { firstBad[0].focus(); return; }

    await withBusy($('#btn-signup'), 'Creating account', async () => {
      try {
        const res = await api.register({
          fullName: name.value.trim(), mobile: mobile.value.trim(), password: pw.value, confirmPassword: pw2.value
        });
        for (const i of [pw, pw2, mobile, name]) i.value = '';
        $('#welcome-id').textContent = res.student.studentId;
        show('welcome'); // before setSession so the router does not redirect away
        api.setSession(res.token, res.student, true);
        $('#h-auth').focus();
      } catch (err) {
        const target = { mobile, password: pw, confirmPassword: pw2 }[err.field];
        if (target) { fieldError(target, err.message); target.focus(); }
        else setError($('#su-form-err'), retryText(err));
      }
    });
  }

  // ---------- forgot password ----------
  async function onForgot(e) {
    e.preventDefault();
    const id = $('#fp-id'), mobile = $('#fp-mobile');
    setError($('#fp-form-err'), '');
    if (!id.value.trim() || !mobile.value.trim()) {
      setError($('#fp-form-err'), 'Enter both your Student ID and your registered mobile number.');
      return;
    }
    await withBusy($('#btn-forgot'), 'Verifying', async () => {
      try {
        const res = await api.recoverVerify({ studentId: id.value.trim(), mobile: mobile.value.trim() });
        resetToken = res.resetToken;
        $('#panel-forgot').dataset.id = id.value.trim();
        mobile.value = '';
        show('reset');
      } catch (err) {
        setError($('#fp-form-err'), retryText(err));
      }
    });
  }

  async function onReset(e) {
    e.preventDefault();
    const pw = $('#rp-pw'), pw2 = $('#rp-pw2');
    setError($('#rp-form-err'), '');
    if (pw.value.length < 8) { setError($('#rp-form-err'), 'Use at least 8 characters.'); pw.focus(); return; }
    if (pw.value !== pw2.value) { setError($('#rp-form-err'), 'Passwords do not match.'); pw2.focus(); return; }
    await withBusy($('#btn-reset'), 'Saving', async () => {
      try {
        await api.recoverReset({ resetToken, newPassword: pw.value, confirmPassword: pw2.value });
        resetToken = null;
        pw.value = pw2.value = '';
        $('#login-id').value = $('#panel-forgot').dataset.id || '';
        toast('Password updated.', 'success');
        GAP.auth.pendingNotice = 'Your password was changed. Log in with the new one.';
        location.hash = '#/login';
      } catch (err) {
        if (err.data && err.data.code === 'RESET_EXPIRED') {
          resetToken = null;
          show('forgot');
          setError($('#fp-form-err'), err.message);
        } else {
          setError($('#rp-form-err'), retryText(err));
        }
      }
    });
  }

  // ---------- account block ----------
  function renderAccount() {
    const student = api.student();
    const rail = $('#account-rail');
    const top = $('#account-top');
    rail.replaceChildren();
    top.replaceChildren();

    if (!student) {
      rail.append(h('div', { class: 'account-card' },
        h('div', { class: 'account-note' }, 'Sign in to use My Zone, create share codes and post to the board.'),
        h('div', { class: 'account-actions' },
          h('a', { class: 'btn btn-primary btn-sm', href: '#/login' }, 'Log in'),
          h('a', { class: 'btn btn-secondary btn-sm', href: '#/signup' }, 'Sign up'))));
      top.append(h('a', { class: 'btn btn-primary btn-sm', href: '#/login' }, 'Log in'));
      return;
    }
    const out = () => logout();
    rail.append(h('div', { class: 'account-card' },
      h('div', {},
        h('div', { class: 'account-name' }, student.fullName),
        h('div', { class: 'account-id' }, student.studentId)),
      api.isShared() ? h('div', { class: 'account-note' }, 'Signs out after 20 minutes of inactivity.') : null,
      h('div', { class: 'account-actions' },
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: out }, icon('logout'), h('span', {}, 'Log out')))));
    top.append(h('div', { class: 'account-actions' },
      h('span', { class: 'pill', title: student.fullName }, student.studentId),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Log out', onclick: out }, icon('logout'))));
  }

  function logout() {
    api.clearSession('logout');
    toast('You are logged out.', 'info');
    location.hash = '#/playground';
  }

  // ---------- idle sign-out for shared computers ----------
  function startIdleWatch() {
    const bump = () => { lastActivity = Date.now(); };
    for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, bump, { passive: true });
    setInterval(() => {
      if (api.isSignedIn() && api.isShared() && Date.now() - lastActivity >= IDLE_MS) api.clearSession('idle');
    }, 15000);
  }

  function init() {
    $('#panel-login').addEventListener('submit', onLogin);
    $('#panel-signup').addEventListener('submit', onSignup);
    $('#panel-forgot').addEventListener('submit', onForgot);
    $('#panel-reset').addEventListener('submit', onReset);
    $('#btn-copy-id').addEventListener('click', () => copyWithToast($('#welcome-id').textContent, 'Student ID'));
    $('#btn-welcome-continue').addEventListener('click', finish);
    $('#auth-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (t) location.hash = `#/${t.dataset.tab}`;
    });
    $('#auth-tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      location.hash = location.hash === '#/signup' ? '#/login' : '#/signup';
      setTimeout(() => $('#auth-tabs .tab[aria-selected="true"]').focus(), 0);
    });
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle-pw]');
      if (!t) return;
      const input = document.getElementById(t.dataset.togglePw);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      t.setAttribute('aria-pressed', String(reveal));
      t.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      t.replaceChildren(icon(reveal ? 'eye-off' : 'eye'));
    });
    api.onChange((e) => {
      renderAccount();
      if (e.reason === 'expired') toast('Your session ended. Log in again.', 'info');
      if (e.reason === 'idle') toast('Logged out after 20 minutes of inactivity.', 'info');
    });
    renderAccount();
    startIdleWatch();
  }

  return {
    init, show, require, finish, renderAccount, pendingNotice: null,
    setReturn: (r) => { returnTo = r; }
  };
})();
