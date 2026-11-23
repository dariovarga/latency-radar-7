// Latency Radar dashboard — reads window.RADAR (written by main.ts), no network.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('meta').textContent = 'No radar data found (data.js missing).';
    return;
  }
  var rows = R.rows;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(d) {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }

  var state = { q: '', chain: '', cat: '', sort: 'value', minTvl: 0, pre: false, watch: false, detail: null };

  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  var hash = readHash();
  if (hash.p) state.detail = hash.p;
  if (hash.pre === '1') state.pre = true;
  if (hash.watch === '1') state.watch = true;
  if (hash.sort) state.sort = hash.sort;
  if (hash.q) state.q = hash.q;
  if (hash.chain) state.chain = hash.chain;
  if (hash.cat) state.cat = hash.cat;
  if (hash.min) state.minTvl = Number(hash.min) || 0;

  // Controls.
  var qEl = document.getElementById('q');
  var chainEl = document.getElementById('chain');
  var catEl = document.getElementById('category');
  var sortEl = document.getElementById('sort');
  var minEl = document.getElementById('mintvl');
  var preEl = document.getElementById('preonly');
  var watchEl = document.getElementById('watchonly');

  var chains = {};
  var cats = {};
  rows.forEach(function (r) {
    r.chains.forEach(function (c) { chains[c] = 1; });
    if (r.category) cats[r.category] = 1;
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainEl.appendChild(o);
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  qEl.value = state.q; chainEl.value = state.chain; catEl.value = state.cat;
  sortEl.value = state.sort; minEl.value = String(state.minTvl);
  preEl.checked = state.pre; watchEl.checked = state.watch;

  // Header meta + stats.
  var hot = rows.filter(function (r) { return r.latency === 'HOT'; }).length;
  var medFarm = rows.map(function (r) { return r.farm_minutes; }).sort(function (a, b) { return a - b; })[Math.floor(rows.length / 2)];
  document.getElementById('meta').textContent =
    'Snapshot ' + R.as_of + ' · ' + R.total + ' protocols · ' + R.pre_token + ' pre-token\n' +
    'Watchlist floor ' + usd(R.floor_usd) + ' · ' + R.watchlist_size + ' on the watchlist · ' + hot + ' HOT signals';
  document.getElementById('stats').innerHTML =
    '<span><b>' + R.total + '</b> protocols scored</span>' +
    '<span><b>' + R.pre_token + '</b> record no token</span>' +
    '<span><b>' + hot + '</b> HOT right now</span>' +
    '<span><b>' + medFarm + ' min</b> median time to first farm</span>' +
    '<span><b>' + R.watchlist_size + '</b> on the watchlist — the floor, never the ceiling</span>';
  document.getElementById('farm-time').textContent =
    'median ' + medFarm + ' minutes from zero to first on-chain action; HOT rows first in the ticker above';

  // Fastest-signals ticker: top pre-token movers by 7-day change.
  var movers = rows.filter(function (r) { return !r.has_token && r.change_7d !== null; })
    .sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 8);
  var tick = movers.map(function (r) {
    return '<span><b>' + esc(r.name) + '</b> <span class="up">' + pct(r.change_7d) + ' 7d</span> · ' + usd(r.implied_value_usd) + ' implied</span>';
  }).join('');
  document.getElementById('ticker').innerHTML = tick + tick;

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.pre && r.has_token) return false;
      if (state.watch && !r.on_watchlist) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      value: function (a, b) { return a.implied_value_usd - b.implied_value_usd; },
      change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      age: function (a, b) { return (b.signal_age_days === null ? -1 : b.signal_age_days) - (a.signal_age_days === null ? -1 : a.signal_age_days); },
      farm: function (a, b) { return a.farm_minutes - b.farm_minutes || a.implied_value_usd - b.implied_value_usd; }
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    if (state.sort === 'value') return list.slice().sort(function (a, b) { return a.rank - b.rank; });
    return list.slice().sort(by);
  }

  function render() {
    var list = filtered();
    var html = list.map(function (r) {
      var chg = r.change_7d === null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
      var chips = r.chains.slice(0, 3).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
      var tags = (r.has_token ? '<span class="badge live">LIVE</span>' : '') + (r.on_watchlist ? '<span class="badge watch">WATCH</span>' : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="open"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + ' ' + tags + '</span></td>' +
        '<td>' + chips + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td>' + age(r.signal_age_days) + '</td>' +
        '<td><span class="badge ' + r.latency + '">' + r.latency + '</span></td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b></td>' +
        '<td>' + r.farm_minutes + ' min</td></tr>';
    }).join('');
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="9">No protocols match this filter.</td></tr>';
    document.getElementById('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' protocols. Click any row for its detail view and farm plan.';
    renderDetail();
  }

  function factorBar(label, value, lo, hi) {
    var w = Math.max(2, Math.min(100, ((value - lo) / (hi - lo)) * 100));
    return '<div class="factor"><div class="f-label"><span>' + label + '</span><b>×' + value.toFixed(2) + '</b></div>' +
      '<div class="bar"><i style="width:' + w.toFixed(0) + '%"></i></div></div>';
  }

  function renderDetail() {
    var box = document.getElementById('detail');
    var backdrop = document.getElementById('backdrop');
    var r = null;
    if (state.detail) {
      for (var i = 0; i < rows.length; i++) if (rows[i].slug === state.detail) { r = rows[i]; break; }
    }
    if (!r) { box.hidden = true; backdrop.hidden = true; return; }
    box.hidden = false;
    backdrop.hidden = false;
    document.getElementById('d-name').textContent = '#' + r.rank + ' — ' + r.name;
    document.getElementById('d-sub').textContent =
      (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · TVL ' + usd(r.tvl_usd) +
      ' · 7d ' + pct(r.change_7d) + ' · listed ' + (r.listed_at || 'unknown') +
      ' · ' + (r.has_token ? 'token already trades' + (r.symbol ? ' (' + r.symbol + ')' : '') + (r.mcap_usd ? ', mcap ' + usd(r.mcap_usd) : '') : 'no token recorded — not proof it has none') +
      (r.on_watchlist ? ' · on the watchlist' : '');
    var f = r.factors;
    var basis = Math.min(r.tvl_usd, 5000000000);
    document.getElementById('d-math').textContent =
      usd(basis) + (r.tvl_usd > 5000000000 ? ' (TVL winsorized at $5B)' : '') + ' × 1.2% × ' + f.momentum.toFixed(2) + ' × ' + f.patience.toFixed(2) + ' × ' +
      f.breadth.toFixed(2) + ' × ' + f.category.toFixed(2) + ' × ' + f.preToken.toFixed(2) + ' × ' + f.launchFit.toFixed(2) +
      ' = ' + usd(r.implied_value_usd);
    document.getElementById('d-factors').innerHTML =
      factorBar('Momentum — 7-day TVL velocity', f.momentum, 0.4, 4) +
      factorBar('Patience — days listed with no token', f.patience, 1, 1.6) +
      factorBar('Breadth — chain spread', f.breadth, 1, 1.42) +
      factorBar('Category prior — snapshot medians', f.category, 0.8, 1.25) +
      factorBar('Pre-token — 1.00, or 0.12 once a token trades', f.preToken, 0.12, 1) +
      factorBar('Launch fit — 1.00, or down to 0.006 for an exchange / wrapped / bridged product', f.launchFit, 0.006, 1);
    document.getElementById('d-cost').textContent =
      '· about $' + r.farm_cost_usd + ' all-in · first action in ' + r.farm_minutes + ' min';
    document.getElementById('d-steps').innerHTML =
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
  }

  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = tr.getAttribute('data-slug');
    try { history.replaceState(null, '', '#p=' + state.detail); } catch (err) { /* file URL */ }
    render();
  });
  document.getElementById('backdrop').addEventListener('click', function () {
    state.detail = null;
    try { history.replaceState(null, '', '#'); } catch (err) { /* file URL */ }
    render();
  });
  document.getElementById('close-detail').addEventListener('click', function () {
    state.detail = null;
    try { history.replaceState(null, '', '#'); } catch (err) { /* file URL */ }
    render();
  });
  qEl.addEventListener('input', function () { state.q = qEl.value; render(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; render(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; render(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; render(); });
  minEl.addEventListener('change', function () { state.minTvl = Number(minEl.value) || 0; render(); });
  preEl.addEventListener('change', function () { state.pre = preEl.checked; render(); });
  watchEl.addEventListener('change', function () { state.watch = watchEl.checked; render(); });

  render();
})();
