// app.js - routing, theme and start-up.

window.GAP = window.GAP || {};

(() => {
  const { $, $$, h, toast } = GAP.ui;
  const api = GAP.api;

  const ROUTES = {
    playground: { title: 'SQL Playground', nav: 'playground' },
    zone: { title: 'My Zone', nav: 'zone', show: () => GAP.zone.show() },
    share: { title: 'Quick Share', nav: 'share', show: () => GAP.share.show() },
    board: { title: 'Class Board', nav: 'board', show: () => GAP.board.show() },
    viva: { title: 'Viva', nav: 'viva' },
    login: { title: 'Log in', auth: 'login' },
    signup: { title: 'Sign up', auth: 'signup' },
    forgot: { title: 'Reset password', auth: 'forgot' }
  };

  let firstRender = true;

  function currentRoute() {
    const name = (location.hash.replace(/^#\/?/, '') || 'playground').split('?')[0];
    return { name, def: ROUTES[name] };
  }

  function render() {
    const { name, def } = currentRoute();
    const viewName = !def ? 'missing' : def.auth ? 'auth' : name;

    // Signed-in people have no reason to see log in / sign up again.
    if (def && def.auth && api.isSignedIn() && name !== 'forgot' && $('#panel-welcome').hidden) {
      GAP.auth.finish();
      return;
    }

    for (const v of $$('.view')) v.hidden = v.id !== `view-${viewName}`;
    for (const a of $$('.nav a')) {
      if (def && def.nav === a.dataset.route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = `${def ? def.title : 'Page not found'} - GAP Compiler`;

    if (def && def.auth) {
      const welcome = !$('#panel-welcome').hidden && api.isSignedIn();
      const notice = GAP.auth.pendingNotice;
      GAP.auth.pendingNotice = null;
      if (!welcome) GAP.auth.show(def.auth, notice);
    }
    if (def && def.show) def.show();

    if (!firstRender) {
      const heading = $(`#view-${viewName} h1`);
      window.scrollTo(0, 0);
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
    firstRender = false;
  }

  function initViva() {
    $('#viva-list').replaceChildren(...GAP.vivaQuestions.map((item) => {
      const answer = h('div', { class: 'answer' });
      answer.innerHTML = item.a; // trusted static text from viva.js
      return h('details', {}, h('summary', {}, item.q), answer);
    }));
  }

  function initTheme() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-action="toggle-theme"]')) return;
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('gap_theme', next); } catch { /* storage blocked */ }
      $('meta[name="theme-color"]').setAttribute('content', next === 'dark' ? '#10151c' : '#f3f5f8');
    });
  }

  // Old Quick Beam links (?beam=CODE) and new ones (?share=CODE) both open Quick Share.
  function handleShareLink() {
    const params = new URLSearchParams(location.search);
    const code = params.get('share') || params.get('beam');
    if (!code) return;
    history.replaceState(null, '', `${location.pathname}#/share`); // drops ?share= and moves to Quick Share
    render(); // replaceState does not fire hashchange
    GAP.share.openCode(code);
  }

  async function validateSession() {
    if (!api.isSignedIn()) return;
    try { await api.me(); GAP.zone.refresh(); } catch { /* an expired session clears itself */ }
  }

  function boot() {
    GAP.ui.initDialogs();
    initTheme();
    initViva();
    GAP.auth.init();
    GAP.playground.init();
    GAP.zone.init();
    GAP.share.init();
    GAP.board.init();

    window.addEventListener('hashchange', render);
    // When the session changes (log in, log out, expiry) redraw the current page.
    api.onChange((e) => {
      const { def } = currentRoute();
      if (!api.isSignedIn() && e.reason !== 'logout' && def && !def.auth && (def.nav === 'zone')) { /* gate card shows */ }
      render();
      if (api.isSignedIn()) GAP.zone.refresh();
    });
    render();
    handleShareLink();
    validateSession();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
