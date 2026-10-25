/*
 * DEADVERSE API address.
 *
 * The API ships with the site, so the page asks the origin it was loaded from:
 * deadverse.ir, www.deadverse.ir, *.vercel.app and every preview URL answer /api
 * themselves. Same origin needs no CORS entry and no ALLOWED_ORIGINS change, so
 * pointing a new domain at the project is enough — no redeploy, no code edit.
 *
 *  - opening the files locally   -> dev server on 127.0.0.1:3000
 *  - a static-only host (Pages)  -> append ?api=https://<api-host>/api to the URL
 */
(function () {
  function resolve() {
    var query = new URLSearchParams(window.location.search).get('api');
    if (query) return query.replace(/\/+$/, '');

    var host = window.location.hostname;
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:3000/api';
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:3000/api';
    return '/api';
  }

  function toResult(response) {
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
  }

  function authHeaders(path, extra) {
    var headers = Object.assign({}, extra || {});
    // Two kinds of credential, never mixed: the panel's admin token lives in this
    // tab only, a reader's token survives restarts because it only unlocks articles.
    var token = /^\/admin(\/|$)/.test(path) ? window.DEADVERSE.token() : window.DEADVERSE.memberToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  window.DEADVERSE = {
    apiBase: resolve(),
    /**
     * Which copy the browser is really running. People keep mixing the local
     * files with the deployed site, so the pages show this instead of guessing.
     */
    environment: function () {
      var base = window.DEADVERSE.apiBase;
      if (/127\.0\.0\.1|localhost/.test(base)) return 'local';
      if (base === '/api') return 'production';
      return 'external';
    },
    // GET with no auth; every other call goes through request().
    get: function (path) {
      return window.DEADVERSE.request(path, { method: 'GET' });
    },
    request: function (path, options) {
      var opts = options || {};
      var headers = authHeaders(path, opts.headers);
      if (opts.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

      return fetch(window.DEADVERSE.apiBase + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store'
      }).then(toResult);
    },
    /** Pictures upload as the raw file bytes; JSON would only inflate them. */
    postMedia: function (blob) {
      return fetch(window.DEADVERSE.apiBase + '/admin/media', {
        method: 'POST',
        headers: authHeaders('/admin/media', { 'Content-Type': blob.type || 'application/octet-stream' }),
        body: blob
      }).then(toResult);
    },
    /**
     * A stored picture is either an absolute https URL or "/api/media/<id>" —
     * bytes living in the database. The second form is resolved against apiBase
     * so the same record works on GitHub Pages, on Vercel and on localhost.
     */
    mediaSrc: function (url) {
      var value = typeof url === 'string' ? url.trim() : '';
      if (/^https:\/\//i.test(value)) return value;
      if (value.indexOf('/api/') === 0) return window.DEADVERSE.apiBase + value.slice('/api'.length);
      return '';
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
    /**
     * Reader session. Deliberately in localStorage: a fan who signs up to read
     * articles should still be signed in tomorrow, and this token can open
     * nothing but the gated pages. `dv_member` is only the name the header shows —
     * the API never trusts it.
     */
    memberToken: function () {
      try {
        return window.localStorage.getItem('dv_member_token') || '';
      } catch (error) {
        return '';
      }
    },
    member: function () {
      try {
        return JSON.parse(window.localStorage.getItem('dv_member') || 'null');
      } catch (error) {
        return null;
      }
    },
    setMember: function (token, profile) {
      try {
        if (token) {
          window.localStorage.setItem('dv_member_token', token);
          window.localStorage.setItem('dv_member', JSON.stringify(profile || null));
        } else {
          window.localStorage.removeItem('dv_member_token');
          window.localStorage.removeItem('dv_member');
        }
      } catch (error) {
        /* private mode: the gated pages simply ask to sign in again */
      }
    },
    /** The address of one record's own page, shared by every listing. */
    pageHref: function (type, item) {
      var segment = { comic: 'comics', article: 'articles', movie: 'movies', character: 'characters' }[type];
      if (!segment || !item) return '';
      return '/' + segment + '/' + encodeURIComponent(item.slug || item.id || '');
    },
    /** Field-level messages, ready to show under the form. */
    fieldErrors: function (error) {
      if (!error || !Array.isArray(error.details)) return {};
      var map = {};
      error.details.forEach(function (issue) {
        if (issue && issue.field) map[issue.field] = issue.message;
      });
      return map;
    },
    /**
     * Article bodies as an ordered list of blocks — paragraphs and pictures —
     * which is how the panel lays an article out and how the page renders it.
     * The stored form stays plain text, one picture per line as [[img:<url>]],
     * so an article written before this existed reads as a single paragraph
     * block and needs no migration.
     *
     * This mirrors server/blocks.js; tests/blocks.test.js feeds both the same
     * corpus, because a difference between them would show up as the panel and
     * the page disagreeing about where a picture goes.
     */
    blocks: (function () {
      var IMAGE_LINE = /^\[\[img:([^\]\s]+)\]\]$/;
      var ESCAPED_LINE = /^\\\[\[img:/;

      function isImageSrc(value) {
        if (typeof value !== 'string') return false;
        if (/^https:\/\/[^\s<>"'`]+$/i.test(value)) return true;
        return /^\/api\/media\/md_[0-9a-z]+$/.test(value);
      }

      function unescapeLine(line) {
        return ESCAPED_LINE.test(line) ? line.slice(1) : line;
      }

      function escapeLine(line) {
        return IMAGE_LINE.test(line) ? '\\' + line : line;
      }

      function parse(text) {
        var blocks = [];
        String(text || '').trim().split(/\n{2,}/).forEach(function (chunk) {
          if (!chunk.trim()) return;
          var match = IMAGE_LINE.exec(chunk.trim());
          if (match && isImageSrc(match[1])) blocks.push({ kind: 'image', url: match[1] });
          else blocks.push({ kind: 'text', text: chunk.split('\n').map(unescapeLine).join('\n') });
        });
        return blocks;
      }

      function serialize(blocks) {
        return (blocks || [])
          .map(function (block) {
            if (block.kind === 'image') return isImageSrc(block.url) ? '[[img:' + block.url + ']]' : '';
            return String(block.text || '')
              .trim()
              .split('\n')
              .map(escapeLine)
              .join('\n');
          })
          .filter(function (chunk) { return chunk !== ''; })
          .join('\n\n');
      }

      function images(text) {
        return parse(text)
          .filter(function (block) { return block.kind === 'image'; })
          .map(function (block) { return block.url; });
      }

      /** A marker line the admin typed by hand that is not a loadable address. */
      function badImages(text) {
        return String(text || '')
          .split('\n')
          .map(function (line) { return line.trim(); })
          .filter(function (line) { return /^\[\[img:/.test(line) && !line.startsWith('\\['); })
          .filter(function (line) {
            var match = IMAGE_LINE.exec(line);
            return !match || !isImageSrc(match[1]);
          });
      }

      return {
        IMAGE_LINE: IMAGE_LINE,
        isImageSrc: isImageSrc,
        parse: parse,
        serialize: serialize,
        images: images,
        badImages: badImages,
        max: 24
      };
    })()
  };
})();
