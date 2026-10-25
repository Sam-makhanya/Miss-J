/*!
 * Growth Engine tracker – by Samukelo Tech
 * Add to the website with:
 *   <script src="growth.js" data-endpoint="YOUR_WEB_APP_URL" defer></script>
 *
 * Tracks: page visits (+ where they came from), WhatsApp / phone taps,
 * any WhatsApp booking message the site opens (e.g. the booking form),
 * and enquiry forms marked with data-growth-form.
 */
(function () {
  'use strict';
  var me = document.currentScript || document.querySelector('script[src*="growth.js"]');
  var ENDPOINT = (me && me.getAttribute('data-endpoint')) || window.GROWTH_ENDPOINT || '';
  var enabled = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(ENDPOINT);

  // ---------- storage helpers (never throw)
  function getLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getSS(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function setSS(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  // ---------- visitor id + source
  var vid = getLS('ge_vid');
  if (!vid) { vid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); setLS('ge_vid', vid); }

  function detectSource() {
    var q = new URLSearchParams(location.search);
    var s = q.get('src') || q.get('utm_source') || q.get('ref');
    if (s) return s.toLowerCase().slice(0, 40);
    var r = document.referrer || '';
    if (!r || r.indexOf(location.host) > -1) return '';
    var map = [['tiktok', 'tiktok'], ['instagram', 'instagram'], ['facebook', 'facebook'], ['fb.', 'facebook'],
               ['whatsapp', 'whatsapp'], ['wa.me', 'whatsapp'], ['google', 'google'], ['bing', 'bing'],
               ['t.co', 'twitter'], ['twitter', 'twitter'], ['x.com', 'twitter'], ['youtube', 'youtube'],
               ['linkedin', 'linkedin'], ['pinterest', 'pinterest']];
    for (var i = 0; i < map.length; i++) if (r.indexOf(map[i][0]) > -1) return map[i][1];
    try { return new URL(r).hostname.replace(/^www\./, ''); } catch (e) { return 'other'; }
  }
  var src = detectSource();
  if (src) { setSS('ge_src', src); if (!getLS('ge_first_src')) setLS('ge_first_src', src); }
  src = getSS('ge_src') || src || getLS('ge_first_src') || 'direct';

  var device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : (/iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'desktop');

  // ---------- send
  function send(data) {
    data.vid = vid; data.src = data.src || src; data.device = device;
    data.page = location.pathname + location.hash; data.ref = (document.referrer || '').slice(0, 200);
    if (!enabled) { if (window.console) console.info('[Growth Engine] (not connected yet)', data); return; }
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    try { fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: body }); } catch (e) {}
  }

  // ---------- 1. visit (once per page per session)
  var visitKey = 'ge_v_' + location.pathname;
  if (!getSS(visitKey)) { setSS(visitKey, '1'); send({ type: 'visit' }); }

  // ---------- 2. parse a WhatsApp message into booking fields
  function parseWhatsApp(url) {
    var u; try { u = new URL(url, location.href); } catch (e) { return null; }
    var isWa = /(^|\.)wa\.me$/.test(u.hostname) || /whatsapp\.com$/.test(u.hostname) || u.protocol === 'whatsapp:';
    if (!isWa) return null;
    var text = u.searchParams.get('text') || '';
    var out = { text: text, to: (u.pathname.replace(/\D/g, '') || u.searchParams.get('phone') || '') };
    var keys = { name: /^(full\s*)?name$/i, phone: /^(phone|cell|whatsapp|number|contact)( number)?$/i,
                 date: /^(date|day)$/i, time: /^time$/i, service: /^(style|service|services|treatment|nails?)$/i,
                 price: /^(price|total|estimated total)$/i };
    text.split(/\n/).forEach(function (line) {
      var m = line.match(/^\s*([^:]{2,30}):\s*(.+)$/);
      if (!m) return;
      for (var k in keys) if (keys[k].test(m[1].trim()) && !out[k]) out[k] = m[2].trim();
    });
    return out;
  }

  function trackWhatsApp(url, how) {
    var p = parseWhatsApp(url);
    if (!p) return false;
    if (p.name || p.service || p.date) {
      // a filled-in booking message → save as a lead
      send({ type: 'booking', name: p.name || '', phone: p.phone || '', service: p.service || '',
             date: p.date || '', time: p.time || '', price: p.price || '', message: p.text.slice(0, 400) });
    } else {
      send({ type: 'whatsapp_click', details: how || 'link' });
    }
    return true;
  }

  // ---------- 3. clicks on WhatsApp / phone links
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (/^tel:/i.test(href)) { send({ type: 'call_click', details: href }); return; }
    trackWhatsApp(a.href, (a.textContent || '').trim().slice(0, 60));
  }, true);

  // ---------- 4. WhatsApp opened from script (booking forms use window.open)
  var origOpen = window.open;
  window.open = function (url) {
    try { if (url) trackWhatsApp(String(url), 'form'); } catch (e) {}
    return origOpen.apply(window, arguments);
  };

  // ---------- 5. enquiry forms: <form data-growth-form data-whatsapp="27...">
  function wireForm(form) {
    if (form.__ge) return; form.__ge = true;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form), d = { type: 'lead' };
      fd.forEach(function (v, k) { d[k] = String(v).trim(); });
      if (d.website) return; // honeypot
      send(d);
      var to = form.getAttribute('data-whatsapp');
      var biz = form.getAttribute('data-business') || 'you';
      var msg = 'Hi! I would like to enquire with ' + biz + '.\n\n' +
        'Name: ' + (d.name || '') + '\n' + (d.phone ? 'Phone: ' + d.phone + '\n' : '') +
        (d.service ? 'Service: ' + d.service + '\n' : '') + (d.date ? 'Date: ' + d.date + '\n' : '') +
        (d.message ? '\n' + d.message : '');
      var thanks = form.querySelector('[data-growth-thanks]');
      if (thanks) { thanks.style.display = 'block'; }
      form.reset();
      if (to) origOpen.call(window, 'https://wa.me/' + to.replace(/\D/g, '') + '?text=' + encodeURIComponent(msg), '_blank');
    });
  }
  function wireAll() { document.querySelectorAll('form[data-growth-form]').forEach(wireForm); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireAll); else wireAll();

  window.Growth = { track: function (event, details) { send({ type: event, details: details || '' }); }, source: src };
})();
