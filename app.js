(function () {
  'use strict';

  var HCPS = window.HCPS || [];
  var CALLS = window.CALLS || { brick: {}, territory: {} };
  var SCS = { s1: (window.SCENARIOS || {})['scenario-1'], s2: (window.SCENARIOS || {})['scenario-2'] };   // scenario data by switch id

  // muted, corporate palette; scenario territories keep the colour of the baseline territory they evolve from
  var BASE_COLORS = { '101': '#2563b0', '102': '#0f9d8f', '103': '#7c5cc4', '104': '#e0912f', '105': '#c2467a', '106': '#3d9a5b', '107': '#5a6c87' };
  var NEUTRAL = '#2f6db5', GREY = '#8896a6';

  var state = { sc: 'base', main: true, terr: true, hidden: {}, area: '' };
  var fx = { area: 1 };   // animated visual parameters

  var $ = function (id) { return document.getElementById(id); };
  var raf = window.requestAnimationFrame.bind(window);
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var nf = function (d) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var fmt = function (n, d) { return nf(d).format(n); };

  // ---- colour + animation helpers -------------------------------------------
  function hex2rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgb(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function lighten(c, k) { return rgb(mix(c, [255, 255, 255], k)); }
  var ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 4); };

  var tokens = {};
  function tween(channel, ms, step, done, fn) {
    var tok = tokens[channel] = {}, t0 = performance.now(), e = fn || ease;
    function frame(t) {
      if (tokens[channel] !== tok) return;
      var k = Math.min(1, (t - t0) / ms);
      step(e(k));
      if (k < 1) raf(frame); else if (done) done();
    }
    raf(frame);
  }
  function countTo(el, to, dec, ms) {
    var from = el._v == null ? 0 : el._v; el._v = to;
    var t0 = performance.now(), tok = el._tok = {}; ms = ms || 900;
    (function f(t) {
      if (el._tok !== tok) return;
      var k = Math.min(1, (t - t0) / ms), v = from + (to - from) * easeOut(k);
      el.textContent = fmt(v, dec);
      if (k < 1) raf(f);
    })(t0);
  }

  // ---- scenario helpers ----------------------------------------------------------
  var isS1 = function () { return state.sc === 's1'; };
  var isS2 = function () { return state.sc === 's2'; };   // geographic figures only: no HCPs
  var SC = null;                                          // data of the selected scenario (null for the baseline)
  function fromOf(code) {
    if (!SC) return code;
    var t = SC.territories.filter(function (x) { return x.id === code; })[0];
    return t ? t.from : null;
  }
  var colorOf = function (code) { return BASE_COLORS[fromOf(code)] || GREY; };
  var terrOfHcp = function (h) { return isS1() ? h.t1 : h.t; };
  var isMoved = function (h) { return isS1() && !!h.t1 && fromOf(h.t1) !== h.t; };

  var kamByCode = {};
  HCPS.forEach(function (h) { if (!kamByCode[h.t]) kamByCode[h.t] = h.kam; });

  function terrInfo() {
    var list;      // v: the figure the bars and the deviation are based on (calls per month, or H2 planned visits in scenario 2)
    if (isS2()) {
      list = SC.territories.map(function (t) { return { code: t.id, from: t.from, name: fmt(t.n_bricks) + ' bricks', c: t, v: t.h2 }; });
    } else if (isS1()) {
      list = SC.territories.map(function (t) { var c = SC.calls.territory[t.id] || {}; return { code: t.id, from: t.from, name: 'from ' + t.from, c: c, v: c.calls_per_month }; });
    } else {
      list = Object.keys(CALLS.territory).sort().map(function (k) { return { code: k, from: k, name: kamByCode[k] || '', c: CALLS.territory[k], v: CALLS.territory[k].calls_per_month }; });
    }
    var avg = list.reduce(function (s, t) { return s + t.v; }, 0) / list.length;
    list.forEach(function (t) { t.dev = (t.v - avg) / avg; });
    list.avg = avg;
    return list;
  }

  // ---- map -------------------------------------------------------------------------
  var map = L.map('map', { zoomControl: false, maxBoundsViscosity: 1, preferCanvas: true, zoomSnap: .25, zoomDelta: .5, wheelPxPerZoomLevel: 90 }).setView([51.2, 10.4], 6);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  var mainG = L.featureGroup().addTo(map);

  // ---- dot styles (driven by h._c, the current animated colour, and fx) ----------------
  function mainStyle(h) {
    return { radius: 5, color: '#fff', weight: 1.2, fillColor: rgb(h._c), fillOpacity: .95 };
  }

  function targetColor(h) {
    if (!state.terr) return hex2rgb(NEUTRAL);
    var t = terrOfHcp(h);
    return hex2rgb(t ? colorOf(t) : GREY);
  }

  function restyleAll() {
    HCPS.forEach(function (h) {
      if (h._m) h._m.setStyle(mainStyle(h));
    });
    paintGroups();
  }
  function recolor(animated) {
    HCPS.forEach(function (h) { h._f = h._c || targetColor(h); h._to = targetColor(h); });
    if (!animated) { HCPS.forEach(function (h) { h._c = h._to; }); restyleAll(); return; }
    tween('color', 750, function (k) { HCPS.forEach(function (h) { h._c = mix(h._f, h._to, k); }); restyleAll(); });
  }

  // ---- popups ------------------------------------------------------------------------------
  function chipT(code) { return '<span class="chip"><i style="background:' + colorOf(code) + '"></i>Territory ' + esc(code) + '</span>'; }
  function hcpHead(h) {
    var t = terrOfHcp(h), mv = isMoved(h);
    return '<div class="pp-title">' + esc(h.n) + '</div><div class="pp-sub">' + esc(h.sp) + '</div>' +
      '<div class="pp-chips">' + (t ? chipT(t) : '') + '<span class="chip">Prio ' + esc(h.pr) + '</span>' +
      (mv ? '<span class="chip move">' + esc(h.t) + ' &rarr; ' + esc(h.t1) + '</span>' : '') + '</div>' +
      (!isS1() && h.kam ? '<div class="pp-sub">' + esc(h.kam) + '</div>' : '') + (h.pd ? '<div class="pp-sub">' + esc(h.pd) + '</div>' : '');
  }
  function place(title, p) {
    return '<div class="pp-place"><small>' + esc(title) + '</small>' + esc(p.a) + '<br>' + esc(p.z) + ' ' + esc(p.c) +
      (p.m && p.m !== 'house' ? '<div class="pp-warn">' + (p.m === 'not_found' ? 'location not found' : 'approximate location (' + esc(p.m) + ' match)') + '</div>' : '') + '</div>';
  }

  HCPS.forEach(function (h) {
    h._c = targetColor(h);
    var hasPt = h.main.lat != null;
    h._m = hasPt ? L.circleMarker([h.main.lat, h.main.lon], Object.assign({ bubblingMouseEvents: false }, mainStyle(h))).bindTooltip(function () { return esc(h.n) + '<br><small>' + esc(h.sp) + '</small>'; }, { direction: 'top', offset: [0, -4] })
      .bindPopup(function () { return hcpHead(h) + place('Workplace', h.main); }, { className: 'xpop', maxWidth: 300 }) : null;
  });


  // ---- combined dots: HCPs at exactly the same coordinates ---------------------------------------
  var groupMap = {}, groupList = [];
  HCPS.forEach(function (h) {
    if (!h._m) return;
    var k = h.main.lat + ',' + h.main.lon;
    (groupMap[k] = groupMap[k] || { members: [], latlng: [h.main.lat, h.main.lon], vis: [] }).members.push(h);
    h._g = groupMap[k];
  });
  Object.keys(groupMap).forEach(function (k) {
    var g = groupMap[k];
    if (g.members.length < 2) { g.members[0]._g = null; return; }
    g.marker = L.marker(g.latlng, { icon: L.divIcon({ className: 'cluster-wrap', html: '<div class="cluster"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), keyboard: true, riseOnHover: true })
      .bindTooltip(function () {
        var p = g.members[0].main;
        return '<b>' + g.vis.length + ' HCPs</b> at this address<br><small>' + esc(p.a) + ', ' + esc(p.z) + ' ' + esc(p.c) + ' \u00b7 click to ' + (spider && spider.g === g ? 'collapse' : 'spread') + '</small>';
      }, { direction: 'top', offset: [0, -12] });
    g.marker.on('click', function () { toggleSpider(g); });
    groupList.push(g);
  });

  function paintGroups() {
    groupList.forEach(function (g) {
      var el = g.marker.getElement(), n = g.vis.length;
      if (!el || n < 2) return;
      var d = el.firstChild, cnt = {}, order = [], open = spider && spider.g === g;
      g.vis.forEach(function (h) { var c = rgb(h._c); if (!(c in cnt)) { cnt[c] = 0; order.push(c); } cnt[c]++; });
      var bg = order[0];
      if (order.length > 1) {   // mixed territories: pie of their colours
        var acc = 0;
        bg = 'conic-gradient(' + order.map(function (c) { var a = acc / n * 100; acc += cnt[c]; return c + ' ' + a.toFixed(1) + '% ' + (acc / n * 100).toFixed(1) + '%'; }).join(',') + ')';
      }
      d.style.background = bg;
      d.textContent = open ? '\u00d7' : n;
      d.classList.toggle('open', !!open);
    });
  }

  var clustered = false, lodZoom = null;   // lodZoom: zoom from which stacked HCPs become a numbered dot
  var spider = null, spiderG = L.featureGroup().addTo(map);
  function spreadOffsets(n) {
    var out = [], i, a;
    if (n <= 20) { var r = Math.max(30, n * 18 / (2 * Math.PI)); for (i = 0; i < n; i++) { a = -Math.PI / 2 + i * 2 * Math.PI / n; out.push(L.point(Math.cos(a) * r, Math.sin(a) * r)); } }
    else for (i = 0; i < n; i++) { a = i * .9; out.push(L.point(Math.cos(a) * (30 + 4.6 * a), Math.sin(a) * (30 + 4.6 * a))); }
    return out;
  }
  function toggleSpider(g) {
    if (spider && spider.g === g) { collapseSpider(); return; }
    collapseSpider(true); openSpider(g);
  }
  function openSpider(g) {
    var members = g.vis.slice(), c = map.latLngToLayerPoint(g.latlng), ll = L.latLng(g.latlng);
    var targets = spreadOffsets(members.length).map(function (p) { return map.layerPointToLatLng(c.add(p)); });
    var lines = members.map(function () { var l = L.polyline([ll, ll], { color: '#44546a', weight: 1.2, opacity: .6, interactive: false }); spiderG.addLayer(l); return l; });
    members.forEach(function (h) { h._m.setLatLng(ll); spiderG.addLayer(h._m); });
    spider = { g: g, members: members, lines: lines };
    paintGroups(); g.marker.closeTooltip();
    tween('spider', 520, function (k) {
      members.forEach(function (h, i) {
        var p = L.latLng(ll.lat + (targets[i].lat - ll.lat) * k, ll.lng + (targets[i].lng - ll.lng) * k);
        h._m.setLatLng(p); lines[i].setLatLngs([ll, p]);
      });
    }, null, function (t) { var c1 = 1.70158 * 1.4; return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); });   // easeOutBack
  }
  function collapseSpider(instant) {
    if (!spider) return;
    var s = spider, ll = L.latLng(s.g.latlng); spider = null;
    var from = s.members.map(function (h) { return h._m.getLatLng(); });
    var done = function () {
      s.members.forEach(function (h) { h._m.setLatLng(ll); });
      spiderG.clearLayers(); paintGroups();
    };
    paintGroups();
    if (instant) { tokens.spider = {}; done(); return; }
    tween('spider', 280, function (k) {
      s.members.forEach(function (h, i) {
        var p = L.latLng(from[i].lat + (ll.lat - from[i].lat) * k, from[i].lng + (ll.lng - from[i].lng) * k);
        h._m.setLatLng(p); s.lines[i].setLatLngs([ll, p]);
      });
    }, done);
  }
  map.on('click zoomstart', function () { collapseSpider(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { collapseSpider(); closeModal(); } });

  // ---- area layers -----------------------------------------------------------------------------
  var LEVEL_DEFS = [
    { id: '', label: 'None', icon: '<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>' },
    { id: 'plz', label: 'ZIP codes', weight: .6, icon: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>' },
    { id: 'grossegment_x_territory', label: 'Bricks by territory', weight: 1.3, icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 14l16-6M12 4v16"/>' },
    { id: 'brick', label: 'Bricks', weight: .8, icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 14l16-6M12 4v16"/>' },
    { id: 'territory', label: 'Territories', weight: 2.2, icon: '<path d="M12 3c4 0 7 3 7 7 0 5-7 11-7 11S5 15 5 10c0-4 3-7 7-7z"/><circle cx="12" cy="10" r="2.5"/>' }
  ];
  var levelById = {}; LEVEL_DEFS.forEach(function (l) { levelById[l.id] = l; });
  var LEVELS = [];   // the tiles offered in the current scenario: scenario 2 has its own bricks instead of the bricks by territory
  function setLevels() {
    LEVELS = LEVEL_DEFS.filter(function (l) { return l.id === 'brick' ? isS2() : l.id === 'grossegment_x_territory' ? !isS2() : true; });
  }
  var areaLayers = {}, loading = {}, activeKey = null;

  var layerKey = function (level) { return level === 'territory' && SC ? 'territory@' + state.sc : level; };

  // territory an area belongs to in the current scenario (null when it spans several)
  function terrOfArea(level, p) {
    if (!SC) {
      if (level === 'territory') return p.id;
      if (p.territory) return p.territory;
      return p.territories && p.territories.indexOf(',') < 0 ? p.territories : null;
    }
    var v = level === 'plz' ? SC.plz[p.plz] : level === 'grossegment_x_territory' ? SC.brick[p.id] : level === 'brick' ? p.territory : p.id;
    return v && v.indexOf(',') < 0 ? v : null;
  }
  function areaStyle(level) {
    var w = levelById[level].weight;
    return function (f) {
      var t = state.terr && terrOfArea(level, f.properties);
      return t ? { color: '#44546a', opacity: .7, weight: w, fillColor: colorOf(t), fillOpacity: .26 * fx.area }
               : { color: '#44546a', opacity: .7, weight: w, fillColor: '#000', fillOpacity: 0 };
    };
  }
  function areaTip(level, p) {
    var t = terrOfArea(level, p), n = function (v) { return fmt(Number(v) || 0); };
    var terrTxt = t ? 'Territory ' + esc(t) : '';
    switch (level) {
      case 'plz': return esc(p.name || p.plz) + '<br><small>' + terrTxt + (p.gs_name && !isS2() ? ' · ' + esc(p.gs_name) : '') + '</small>';
      case 'brick': return esc(p.name) + '<br><small>' + terrTxt + ' · ID ' + esc(p.id) + '</small>';
      case 'territory': return esc('Territory ' + p.id) + '<br><small>' + n(p.n_plz) + ' PLZ</small>';
      default: return esc(p.name) + '<br><small>' + terrTxt + ' · ' + n(p.n_plz) + ' PLZ</small>';
    }
  }

  // scenario 2: new frequency and H2 planned visits (a missing value in the workbook is shown as "-")
  function visitsPopup(level, p) {
    var isT = level === 'territory', t = isT ? SC.territories.filter(function (x) { return x.id === p.id; })[0] : p, head, chips, note;
    var num = function (v, label) { return '<div><b' + (v == null ? '>-' : ' data-count="' + v + '">0') + '</b><small>' + label + '</small></div>'; };
    if (isT) {
      head = '<div class="pp-title">Territory ' + esc(p.id) + '</div><div class="pp-sub">' + fmt(t.n_bricks) + ' bricks</div>';
      chips = chipT(p.id) + '<span class="chip">' + fmt(t.n_plz) + ' PLZ</span>';
      note = 'Sums over the bricks that have a value: ' + fmt(t.n_freq) + ' of ' + fmt(t.n_bricks) + ' bricks have a new frequency, ' + fmt(t.n_h2) + ' have H2 planned visits.';
    } else {
      head = '<div class="pp-title">' + esc(p.name) + '</div><div class="pp-sub">Brick ID ' + esc(p.id) + '</div>';
      chips = chipT(p.territory) + '<span class="chip">' + fmt(p.n_plz) + ' PLZ</span><span class="chip">' + fmt(p.km2, 1) + ' km²</span>';
      note = p.freq == null || p.h2 == null ? 'A "-" means the workbook has no value for this brick.' : '';
    }
    return head + '<div class="pp-chips">' + chips + '</div>' +
      '<div class="pp-grid two">' + num(t.freq, isT ? 'New frequency (sum)' : 'New frequency') + num(t.h2, isT ? 'H2 planned visits (sum)' : 'H2 planned visits') + '</div>' +
      (note ? '<div class="pp-note">' + note + '</div>' : '');
  }

  function callsPopup(level, p) {
    if (level === 'brick' || (isS2() && level === 'territory')) return visitsPopup(level, p);
    var isT = level === 'territory', t = terrOfArea(level, p), info = terrInfo();
    var c, head, chips = '', note = '';
    if (isT) {
      var row = info.filter(function (x) { return x.code === p.id; })[0];
      c = row ? row.c : { A: 0, B: 0, C: 0, hcps: 0, calls_per_month: 0, calls_h2: 0, bricks: 0 };
      head = '<div class="pp-title">Territory ' + esc(p.id) + '</div><div class="pp-sub">' + esc(isS1() ? 'evolved from territory ' + p.from : kamByCode[p.id] || '') + '</div>';
      chips = chipT(p.id) + '<span class="chip">' + fmt(c.bricks || 0) + ' bricks with HCPs</span>' + (row ? '<span class="chip">' + (row.dev >= 0 ? '+' : '−') + fmt(Math.abs(row.dev) * 100, 1) + '% vs avg</span>' : '');
    } else {
      c = CALLS.brick[p.id] || { A: 0, B: 0, C: 0, hcps: 0, calls_per_month: 0, calls_h2: 0 };
      var was = p.territory;
      head = '<div class="pp-title">' + esc(p.name) + '</div><div class="pp-sub">Brick · ' + fmt(p.n_plz) + ' PLZ</div>';
      chips = chipT(t || was) + (isS1() && t && fromOf(t) !== was ? '<span class="chip move">was ' + esc(was) + '</span>' : '');
    }
    return head + '<div class="pp-chips">' + chips + '</div>' +
      '<div class="pp-hero"><b data-count="' + c.calls_h2 + '">0</b><span>planned calls in H2</span></div>' +
      '<div class="pp-sub"><b data-count="' + c.calls_per_month + '" data-dec="1">0</b> per month</div>' +
      '<div class="pp-grid"><div><b data-count="' + c.hcps + '">0</b><small>HCPs</small></div><div><b data-count="' + c.A + '">0</b><small>Prio A</small></div>' +
      '<div><b data-count="' + c.B + '">0</b><small>Prio B</small></div><div><b data-count="' + c.C + '">0</b><small>Prio C</small></div></div>' +
      '<div class="pp-note">A = 2, B = 1, C = 0.5 calls per month &times; 6 months</div>';
  }
  map.on('popupopen', function (e) {
    var el = e.popup.getElement(); if (!el) return;
    Array.prototype.forEach.call(el.querySelectorAll('[data-count]'), function (n) { countTo(n, parseFloat(n.getAttribute('data-count')), parseInt(n.getAttribute('data-dec') || '0', 10), 1000); });
  });

  function loadScript(src) {
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { delete loading[src]; fail(new Error(src)); };
      document.head.appendChild(s);
    });
    return loading[src];
  }

  function buildArea(level, geojson) {
    var clickable = level === 'grossegment_x_territory' || level === 'brick' || level === 'territory';
    return L.geoJSON(geojson, {
      style: areaStyle(level),
      onEachFeature: function (f, layer) {
        if (clickable) layer.bindPopup(function () { return callsPopup(level, f.properties); }, { className: 'xpop', maxWidth: 300 });
        layer.on('mouseover', function (e) {
          if (!layer.getTooltip()) layer.bindTooltip(function () { return areaTip(level, f.properties); }, { sticky: true, direction: 'top' }).openTooltip(e.latlng);
          var s = areaStyle(level)(f);
          layer.setStyle({ weight: s.weight + 1.2, fillColor: s.fillOpacity ? s.fillColor : '#0b6bcb', fillOpacity: Math.max(s.fillOpacity + .16, .12), opacity: 1 });
        });
        layer.on('mouseout', function () { layer.setStyle(areaStyle(level)(f)); });
      }
    });
  }

  function showArea(level) {
    var note = $('area-note');
    if (activeKey && areaLayers[activeKey]) map.removeLayer(areaLayers[activeKey]);
    state.area = level; activeKey = null; note.hidden = true;
    if (!level) return;
    var key = layerKey(level), isOwn = key.indexOf('@') > 0;
    var ready = function () {
      if (state.area !== level || layerKey(level) !== key) return;
      var lay = areaLayers[key], big = lay.getLayers().length > 1500;
      activeKey = key; lay.addTo(map); restack();
      if (!big) { fx.area = 0; lay.setStyle(areaStyle(level)); tween('area', 650, function (k) { fx.area = k; lay.setStyle(areaStyle(level)); }); }
      else { fx.area = 1; lay.setStyle(areaStyle(level)); }
    };
    if (areaLayers[key]) return ready();
    if (isOwn) { areaLayers[key] = buildArea(level, SC.territoryGeo); return ready(); }
    note.textContent = 'Loading ' + levelById[level].label.toLowerCase() + '…'; note.hidden = false;
    loadScript('data/area-' + level + '.js').then(function () {
      areaLayers[key] = buildArea(level, window.AREAS[level]); note.hidden = true; ready();
    }).catch(function () {
      note.textContent = 'Could not load data/area-' + level + '.js (run build_data.py).';
      state.area = ''; renderAreaTiles();
    });
  }

  function restack() {
    if (activeKey && areaLayers[activeKey] && map.hasLayer(areaLayers[activeKey])) areaLayers[activeKey].bringToBack();
    mainG.bringToFront();
  }

  // ---- refresh dots ------------------------------------------------------------------------------------
  function refresh() {
    collapseSpider(true);
    clustered = lodZoom != null && map.getZoom() >= lodZoom - 1e-6;
    mainG.clearLayers();
    groupList.forEach(function (g) { g.vis = []; });
    var shown = 0, noLoc = 0, spots = 0;
    HCPS.forEach(function (h) {
      if (isS2() || state.hidden[terrOfHcp(h)] || !state.main) return;
      if (!h._m) { noLoc++; return; }
      shown++;
      if (h._g) h._g.vis.push(h); else { mainG.addLayer(h._m); spots++; }
    });
    groupList.forEach(function (g) {
      if (g.vis.length === 1) { mainG.addLayer(g.vis[0]._m); spots++; }
      else if (g.vis.length > 1) {
        spots++;
        if (clustered) mainG.addLayer(g.marker);                                        // numbered dot, only when zoomed in far enough
        else g.vis.forEach(function (h) { mainG.addLayer(h._m); });                      // otherwise plain dots, exactly on top of each other
      }
    });
    restack(); paintGroups();
    var hint = $('show-hint');
    if (hint) hint.textContent = isS2() ? 'No HCP data in this scenario' : state.main ? fmt(shown) + ' HCPs at ' + fmt(spots) + ' locations' + (noLoc ? ' \u00b7 ' + noLoc + ' without location' : '') : 'Hidden';
  }

  // ---- UI: switches ----------------------------------------------------------------------------------------
  function setSwitch(btn, on) { btn.setAttribute('aria-checked', on ? 'true' : 'false'); }
  function bindRow(row, get, set) {
    var btn = row.querySelector('.switch');
    row.addEventListener('click', function (e) {
      if (row.classList.contains('disabled')) return;
      e.preventDefault();
      var v = !get(); set(v); setSwitch(btn, v);
    });
  }


  bindRow($('row-main'), function () { return state.main; }, function (v) {
    state.main = v; refresh();
  });
  bindRow($('row-terr'), function () { return state.terr; }, function (v) {
    state.terr = v; recolor(true);
    Object.keys(areaLayers).forEach(function (k) { areaLayers[k].setStyle(areaStyle(k.replace(/@.*/, ''))); });
    renderTerrList(false);
  });

  // ---- UI: area tiles ---------------------------------------------------------------------------------------
  function renderAreaTiles() {
    var box = $('areas'); box.innerHTML = '';
    LEVELS.forEach(function (l) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'tile'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', state.area === l.id ? 'true' : 'false'); b.tabIndex = state.area === l.id ? 0 : -1;
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + l.icon + '</svg><span>' + l.label + '</span>';
      b.addEventListener('click', function () {
        if (state.area === l.id) return;
        state.area = l.id; Array.prototype.forEach.call(box.children, function (c, i) {
          var on = LEVELS[i].id === l.id; c.setAttribute('aria-checked', on); c.tabIndex = on ? 0 : -1;
        });
        showArea(l.id);
      });
      b.addEventListener('keydown', function (e) {
        var i = LEVELS.indexOf(l), d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return; e.preventDefault();
        var n = box.children[(i + d + LEVELS.length) % LEVELS.length]; n.focus(); n.click();
      });
      box.appendChild(b);
    });
  }

  // ---- UI: territory list + KPIs -----------------------------------------------------------------------------
  function hcpBounds(code) {
    var pts = [];
    HCPS.forEach(function (h) { if (h._m && terrOfHcp(h) === code) pts.push([h.main.lat, h.main.lon]); });
    return pts.length ? L.latLngBounds(pts) : null;
  }
  function padOpts() {
    var w = $('dock').classList.contains('collapsed') || window.innerWidth <= 760 ? 40 : 372 + 40;
    return { paddingTopLeft: [w, 40], paddingBottomRight: [40, window.innerWidth <= 760 ? Math.round(innerHeight * .56) : 40] };
  }
  function pulse(code) {
    var set = HCPS.filter(function (h) { return h._m && terrOfHcp(h) === code; });
    tween('pulse', 1100, function (k) {
      var r = 5 + Math.sin(k * Math.PI) * 4;
      set.forEach(function (h) { h._m.setRadius(r); });
    }, function () { set.forEach(function (h) { h._m.setRadius(5); }); }, function (k) { return k; });
  }

  function renderTerrList(animate) {
    var info = terrInfo(), box = $('terr-list'), top = Math.max.apply(null, info.map(function (t) { return t.v; })) * 1.12, s2 = isS2();
    box.innerHTML = '<div class="thead"><span></span><span></span><span class="r">HCPs</span><span class="r">' + (s2 ? 'H2 visits' : 'Calls / mo') + '</span><span></span></div>';
    info.forEach(function (t, i) {
      var row = document.createElement('div'); row.className = 'trow' + (state.hidden[t.code] ? ' off' : ''); row.tabIndex = 0; row.style.animationDelay = (i * 50) + 'ms';
      var col = state.terr ? colorOf(t.code) : GREY;
      var dev = (t.dev >= 0 ? '+' : '−') + fmt(Math.abs(t.dev) * 100, 1) + '%';
      row.innerHTML = '<span class="tdot" style="background:' + col + '"></span>' +
        '<div><div class="ttitle"><b>' + esc(t.code) + '</b><span>' + esc(t.name) + '</span></div>' +
        '<div class="tbar"><i style="background:' + col + '"></i><u style="left:' + Math.min(100, info.avg / top * 100) + '%"></u></div></div>' +
        '<div class="thcp">' + (s2 ? '-' : fmt(t.c.hcps)) + '</div><div class="tnum"><b>' + fmt(t.v, s2 ? 0 : 1) + '</b><small>' + dev + '</small></div>' +
        (s2 ? '<span></span>' : '<button type="button" class="switch sm" role="switch" aria-checked="' + !state.hidden[t.code] + '" aria-label="Show territory ' + esc(t.code) + '"><i></i></button>');
      var bar = row.querySelector('.tbar i'), w = t.v / top * 100;
      if (animate === false) bar.style.width = w + '%'; else raf(function () { raf(function () { bar.style.width = w + '%'; }); });
      var sw = row.querySelector('.switch');
      if (sw) sw.addEventListener('click', function (e) {
        e.stopPropagation(); state.hidden[t.code] = !state.hidden[t.code];
        setSwitch(sw, !state.hidden[t.code]); row.classList.toggle('off', !!state.hidden[t.code]); refresh();
      });
      var go = function () {
        var b = s2 ? L.geoJSON(SC.territoryGeo.features.filter(function (f) { return f.properties.id === t.code; })).getBounds() : hcpBounds(t.code);
        if (!b || !b.isValid()) return;
        if (sw) { state.hidden[t.code] = false; setSwitch(sw, true); row.classList.remove('off'); refresh(); }
        map.flyToBounds(b, Object.assign({ duration: 1.3, easeLinearity: .2, maxZoom: 9 }, padOpts()));
        if (!s2) map.once('moveend', function () { pulse(t.code); });
      };
      row.addEventListener('click', go);
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.appendChild(row);
    });
    $('terr-all').parentNode.style.display = s2 ? 'none' : '';
    $('legend-note').textContent = s2 ? 'Bars show H2 planned visits; the line marks the average across territories.' : isS1()
      ? 'Bars show calls per month; the line marks the average. Colours follow the baseline territory each one evolves from.'
      : 'Bars show calls per month; the line marks the average across territories.';
  }

  function renderKpis() {
    var info = terrInfo();
    var calls = info.reduce(function (s, t) { return s + t.v; }, 0);
    var dev = Math.max.apply(null, info.map(function (t) { return Math.abs(t.dev); })) * 100;
    $('kl-calls').textContent = isS2() ? 'H2 planned visits' : 'Calls / month';
    if (isS2()) { $('k-hcps')._tok = {}; $('k-hcps')._v = 0; $('k-hcps').textContent = '-'; } else countTo($('k-hcps'), HCPS.length, 0);
    countTo($('k-calls'), calls, isS2() ? 0 : 1);
    countTo($('k-terr'), info.length, 0); countTo($('k-dev'), dev, 1);
    if (isS1()) {
      var n = HCPS.filter(isMoved).length;
      mmN = n; $('mm-p').textContent = fmt(n / HCPS.length * 100, 1) + '%';
    }
  }

  // ---- scenario info modal --------------------------------------------------------------------------------------------
  var mmN = 0, modalFrom = null;
  function openModal() {
    var m = $('modal'); $('mm-n')._v = 0; m.classList.remove('closing'); m.hidden = false;
    modalFrom = document.activeElement; $('modal-ok').focus();
    setTimeout(function () { countTo($('mm-n'), mmN, 0, 1100); }, 250);
  }
  function closeModal() {
    var m = $('modal'); if (m.hidden || m.classList.contains('closing')) return;
    m.classList.add('closing');
    setTimeout(function () { m.hidden = true; m.classList.remove('closing'); if (modalFrom && modalFrom.focus) modalFrom.focus(); }, 260);
  }
  Array.prototype.forEach.call(document.querySelectorAll('#modal [data-close]'), function (el) { el.addEventListener('click', closeModal); });

  // ---- scenario switch ----------------------------------------------------------------------------------------------
  function applyScenario(id, instant) {
    if (id === state.sc && !instant) return;
    var was2 = isS2();
    state.sc = id; SC = SCS[id] || null; state.hidden = {};
    var seg = $('scenario'); seg.style.setProperty('--i', { base: 0, s1: 1, s2: 2 }[id]);
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) { b.setAttribute('aria-checked', b.getAttribute('data-v') === id); });
    if (was2 !== isS2()) {   // the brick layer differs between scenario 2 and the others
      if (state.area === 'grossegment_x_territory' && isS2()) state.area = 'brick';
      else if (state.area === 'brick' && !isS2()) state.area = 'grossegment_x_territory';
      setLevels(); renderAreaTiles();
    }
    $('row-main').classList.toggle('disabled', isS2());
    renderKpis(); renderTerrList(true); refresh(); recolor(!instant);
    if (state.area) showArea(state.area);
    if (id === 's1' && !instant) openModal();
  }
  Array.prototype.forEach.call($('scenario').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { applyScenario(b.getAttribute('data-v')); });
  });
  ['s1', 's2'].forEach(function (k) { if (!SCS[k]) $('scenario').querySelector('[data-v="' + k + '"]').disabled = true; });

  $('terr-all').addEventListener('click', function () { state.hidden = {}; renderTerrList(false); refresh(); });
  $('terr-none').addEventListener('click', function () { terrInfo().forEach(function (t) { state.hidden[t.code] = true; }); renderTerrList(false); refresh(); });
  $('dock-toggle').addEventListener('click', function () {
    var c = $('dock').classList.toggle('collapsed');
    $('dock-toggle').setAttribute('aria-expanded', !c); $('dock-toggle').setAttribute('aria-label', c ? 'Expand panel' : 'Collapse panel');
  });

  // fit-to-data control
  var FitControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      var d = L.DomUtil.create('div', 'leaflet-bar'), a = L.DomUtil.create('a', '', d);
      a.href = '#'; a.title = 'Fit to all HCPs'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'Fit to all HCPs');
      a.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" style="vertical-align:-3px"><path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); fitAll(true); });
      return d;
    }
  });
  map.addControl(new FitControl());

  function dataBounds() {
    var pts = HCPS.filter(function (h) { return h._m; }).map(function (h) { return [h.main.lat, h.main.lon]; });
    return pts.length ? L.latLngBounds(pts) : null;
  }
  function fitAll(animate) {
    var b = dataBounds(); if (!b) return;
    map.fitBounds(b, Object.assign({ animate: !!animate, duration: 1.2 }, padOpts()));
  }

  // The default view, plus EXTRA_ZOOM_OUT levels of room, is the widest the map can show and the area it can be moved in:
  // no zooming out past it, no panning away from the HCP data.
  var EXTRA_ZOOM_OUT = 1.5;      // zoom levels the user may go out beyond the default view
  var CLUSTER_ZOOM_CLICKS = 4;   // numbered dots appear after this many presses of the + button
  function lockView() {
    var b = dataBounds(); if (!b) return;
    map.setMaxBounds(null); map.setMinZoom(0);
    fitAll(false);
    var z0 = map.getZoom(), c0 = map.getCenter();
    lodZoom = z0 + CLUSTER_ZOOM_CLICKS * map.options.zoomDelta;
    map.setMinZoom(z0 - EXTRA_ZOOM_OUT);                       // a little room around the default view, so popups near the edge can open fully
    map.setView(c0, z0 - EXTRA_ZOOM_OUT, { animate: false }); map.setMaxBounds(map.getBounds());
    map.setView(c0, z0, { animate: false });
    refresh();
  }
  map.on('zoomend', function () {
    if (lodZoom == null) return;
    if ((map.getZoom() >= lodZoom - 1e-6) !== clustered) refresh();
  });
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(lockView, 250); });

  // ---- init ---------------------------------------------------------------------------------------------------------------
  setLevels(); renderAreaTiles(); renderKpis(); renderTerrList(true); refresh(); lockView();
  $('seg-base-sub').textContent = Object.keys(CALLS.territory).length + ' territories';
  if (SCS.s1) $('seg-s1-sub').textContent = SCS.s1.territories.length + ' territories';
  if (SCS.s2) $('seg-s2-sub').textContent = SCS.s2.territories.length + ' territories';
})();
