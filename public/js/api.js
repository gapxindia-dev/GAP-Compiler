// api.js - REST Client for EduSQL Cloud Server

const ApiClient = (() => {
  const TOKEN_KEY = 'edusql_vault_token';
  const STUDENT_KEY = 'edusql_student_meta';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, studentMeta, useSessionStorage = false) {
    if (useSessionStorage) {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(STUDENT_KEY, JSON.stringify(studentMeta));
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(STUDENT_KEY);
    } else {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(STUDENT_KEY, JSON.stringify(studentMeta));
    }
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(STUDENT_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(STUDENT_KEY);
  }

  function getStudentMeta() {
    try {
      const raw = localStorage.getItem(STUDENT_KEY) || sessionStorage.getItem(STUDENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) {
      return null;
    }
  }

  async function request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(endpoint, {
        ...options,
        headers
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Server request failed with status ${res.status}`);
      }

      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  }

  return {
    getToken,
    setSession,
    clearSession,
    getStudentMeta,
    isAuthenticated: () => !!getToken(),

    // Vault Auth
    unlockVault: (studentId, pin, studentName, isLabMode) => {
      return request('/api/auth/vault', {
        method: 'POST',
        body: JSON.stringify({ studentId, pin, studentName })
      });
    },

    // Vault Data
    getVault: () => request('/api/vault'),
    saveQuery: (queryData) => request('/api/vault/query', {
      method: 'POST',
      body: JSON.stringify(queryData)
    }),
    deleteQuery: (id) => request(`/api/vault/query/${id}`, {
      method: 'DELETE'
    }),
    saveNote: (noteData) => request('/api/vault/note', {
      method: 'POST',
      body: JSON.stringify(noteData)
    }),
    deleteNote: (id) => request(`/api/vault/note/${id}`, {
      method: 'DELETE'
    }),

    // Quick Beam
    createBeam: (beamData) => request('/api/beam', {
      method: 'POST',
      body: JSON.stringify(beamData)
    }),
    getBeam: (code) => request(`/api/beam/${encodeURIComponent(code)}`),

    // Community
    getCommunity: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/api/community${query ? '?' + query : ''}`);
    },
    shareCommunity: (data) => request('/api/community', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    likeCommunity: (id) => request(`/api/community/${id}/like`, {
      method: 'POST'
    })
  };
})();
