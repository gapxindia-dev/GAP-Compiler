// api.js - talks to the GAP Compiler server and owns the sign-in session.

window.GAP = window.GAP || {};

GAP.api = (() => {
  const KEY = 'gap_session';
  const events = new EventTarget();
  let session = readSession();

  class ApiError extends Error {
    constructor(status, message, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
      this.retryAfter = data.retryAfter;
      this.field = data.field;
    }
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  // shared=true keeps the token in sessionStorage so closing the tab signs the student out.
  function setSession(token, student, shared) {
    clearStorage();
    session = { token, student, shared: !!shared };
    try { (shared ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(session)); } catch { /* storage blocked */ }
    events.dispatchEvent(new Event('change'));
  }
  function clearStorage() {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
  function clearSession(reason) {
    const had = !!session;
    session = null;
    clearStorage();
    if (had) events.dispatchEvent(Object.assign(new Event('change'), { reason }));
  }

  async function request(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session) headers.Authorization = `Bearer ${session.token}`;
    let res;
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && data.code === 'AUTH_REQUIRED' && session) clearSession('expired');
      throw new ApiError(res.status, data.error || `Request failed (${res.status}).`, data);
    }
    return data;
  }

  async function download(url, filename) {
    let res;
    try { res = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } }); }
    catch { throw new ApiError(0, 'Could not reach the server. Check your connection and try again.'); }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) clearSession('expired');
      throw new ApiError(res.status, data.error || 'Download failed.', data);
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  const qs = (params) => {
    const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return s ? `?${s}` : '';
  };

  return {
    ApiError,
    onChange: (fn) => events.addEventListener('change', fn),
    isSignedIn: () => !!session,
    student: () => (session ? session.student : null),
    isShared: () => !!(session && session.shared),
    setSession, clearSession, download,

    register: (b) => request('POST', '/api/auth/register', b),
    login: (b) => request('POST', '/api/auth/login', b),
    me: () => request('GET', '/api/auth/me'),
    recoverVerify: (b) => request('POST', '/api/auth/recover/verify', b),
    recoverReset: (b) => request('POST', '/api/auth/recover/reset', b),

    getZone: () => request('GET', '/api/zone'),
    saveQuery: (id, b) => (id ? request('PUT', `/api/zone/queries/${id}`, b) : request('POST', '/api/zone/queries', b)),
    deleteQuery: (id) => request('DELETE', `/api/zone/queries/${id}`),
    saveNote: (id, b) => (id ? request('PUT', `/api/zone/notes/${id}`, b) : request('POST', '/api/zone/notes', b)),
    deleteNote: (id) => request('DELETE', `/api/zone/notes/${id}`),
    exportZone: (format, filename) => download(`/api/zone/export/${format}`, filename),

    createShare: (b) => request('POST', '/api/share', b),
    myShares: () => request('GET', '/api/share'),
    getShare: (code) => request('GET', `/api/share/${encodeURIComponent(code)}`),
    deleteShare: (code) => request('DELETE', `/api/share/${encodeURIComponent(code)}`),

    getBoard: (params) => request('GET', `/api/community${qs(params || {})}`),
    post: (b) => request('POST', '/api/community', b),
    editPost: (id, b) => request('PUT', `/api/community/${id}`, b),
    deletePost: (id) => request('DELETE', `/api/community/${id}`),
    toggleLike: (id) => request('POST', `/api/community/${id}/like`),

    getCurrentAcademicYear: () => request('GET', '/api/academic-year/current'),
    getAdminOverview: (key) => request('GET', '/api/admin/overview', undefined, key ? { 'X-Admin-Key': key } : {}),
    advanceAcademicYear: (b, key) => request('POST', '/api/admin/academic-year/advance', b, key ? { 'X-Admin-Key': key } : {}),
    getAdminStudents: (key) => request('GET', '/api/admin/students', undefined, key ? { 'X-Admin-Key': key } : {}),
    updateStudent: (id, b, key) => request('PUT', `/api/admin/students/${id}`, b, key ? { 'X-Admin-Key': key } : {})
  };
})();
