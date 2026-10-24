/*
 * DEADVERSE API address — the ONE place to edit after deploying.
 *
 * Rule of thumb:
 *  - site + API both on Vercel          -> nothing to change ("/api" same origin)
 *  - GitHub Pages site + Vercel API     -> set API_BASE to https://<project>.vercel.app/api
 *  - opening the files locally           -> uses the dev server on 127.0.0.1:3000
 *
 * Temporary override while testing: append ?api=https://your-api.vercel.app/api to the URL.
 */
(function () {
  var API_BASE = 'https://deadverse-eight.vercel.app/api';

  function resolve() {
    var query = new URLSearchParams(window.location.search).get('api');
    if (query) return query.replace(/\/+$/, '');

    var host = window.location.hostname;
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:3000/api';
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:3000/api';
    if (/(^|\.)(vercel\.app|netlify\.app)$/i.test(host)) return '/api';
    return API_BASE.replace(/\/+$/, '');
  }

  window.DEADVERSE = {
    apiBase: resolve(),
    // GET with no auth; every other call goes through request().
    get: function (path) {
      return window.DEADVERSE.request(path, { method: 'GET' });
    },
    request: function (path, options) {
      var opts = options || {};
      var headers = Object.assign({}, opts.headers || {});
      var token = window.DEADVERSE.token();
      if (token) headers['Authorization'] = 'Bearer ' + token;
      if (opts.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

      return fetch(window.DEADVERSE.apiBase + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store'
      }).then(function (response) {
        return response.text().then(function (text) {
          var payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch (error) {
            payload = null;
          }
          if (response.ok) return { ok: true, status: response.status, data: payload };

          var error = new Error((payload && payload.error && payload.error.message) || 'خطای ' + response.status);
          error.status = response.status;
          error.code = payload && payload.error ? payload.error.code : 'unknown';
          error.details = payload && payload.error ? payload.error.details : null;
          throw error;
        });
      });
    },
    token: function () {
      try {
        return window.sessionStorage.getItem('dv_token') || '';
      } catch (error) {
        return '';
      }
    },
    setToken: function (token) {
      try {
        if (token) window.sessionStorage.setItem('dv_token', token);
        else window.sessionStorage.removeItem('dv_token');
      } catch (error) {
        /* private mode: the panel simply asks again next time */
      }
    },
    /** Field-level messages, ready to show under the form. */
    fieldErrors: function (error) {
      if (!error || !Array.isArray(error.details)) return {};
      var map = {};
      error.details.forEach(function (issue) {
        if (issue && issue.field) map[issue.field] = issue.message;
      });
      return map;
    }
  };
})();
