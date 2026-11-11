/* Noyau : utilitaires, stockage local, reglages, etat, voix */
(function () {
  'use strict';
  var CD = window.CD = {};

  CD.$ = function (id) { return document.getElementById(id); };
  CD.qsa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  CD.el = function (tag, props) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'text') e.textContent = props[k];
      else if (k === 'class') e.className = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  };

  // ---- Stockage local (reste dans le navigateur de cet appareil) ----
  CD.store = {
    get: function (k, d) { try { var v = localStorage.getItem('cd.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('cd.' + k, JSON.stringify(v)); } catch (e) {} },
    clear: function () {
      try {
        Object.keys(localStorage).filter(function (k) { return k.indexOf('cd.') === 0; })
          .forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) {}
    }
  };

  // ---- Evenements ----
  var LS = {};
  CD.on = function (e, f) { (LS[e] = LS[e] || []).push(f); };
  CD.emit = function (e, a) { (LS[e] || []).slice().forEach(function (f) { try { f(a); } catch (x) { console.error(e, x); } }); };

  // ---- Reglages ----
  var DEFAULTS = {
    units: 'kmh', alertOn: false, alertLimit: 90, voiceOn: true, voiceVol: 100, demoSpeed: 55,
    layers: { labels: false, buildings: false, parks: false, water: false }, tilt: false, mapTheme: 'auto', poi: { fuel: false, parking: false, charging: false },
    appleToken: '', sceneForce: '', sceneHour: '', autoLimit: true, dangerZones: true, trafficOn: false, trafficRoute: true, incidentsOn: false, trafficKey: '',
    theme: 'clear', wake: true, paint: 'blue', odo: 0, volume: 80, mode: 'demo',
    demoStart: { lat: 48.8566, lon: 2.3522, label: 'Paris (par défaut)' }
  };
  CD.settings = Object.assign({}, DEFAULTS, CD.store.get('settings', {}));
  CD.saveSettings = function () { CD.store.set('settings', CD.settings); };
  CD.resetSettings = function () { CD.settings = Object.assign(CD.settings, JSON.parse(JSON.stringify(DEFAULTS))); };

  CD.themes = {
    clear: { name: 'Clair',  car: '#8a8f9c', deep: '#3a3e48', accent: '#d6dbe6', ta: 'rgba(255,255,255,.34)', tb: 'rgba(255,255,255,.12)' },
    azur:  { name: 'Bleu',   car: '#1f4a8f', deep: '#14305f', accent: '#5b93e6', ta: 'rgba(86,148,255,.62)', tb: 'rgba(24,70,190,.40)' },
    rouge: { name: 'Rouge',  car: '#8f1f2a', deep: '#5f141c', accent: '#e8707d', ta: 'rgba(235,90,105,.60)', tb: 'rgba(150,30,45,.40)' }
  };
  if (!CD.themes[CD.settings.theme]) CD.settings.theme = 'clear';   // ancien reglage (bleu) : on passe au verre clair
  CD.applyTheme = function () {
    var t = CD.themes[CD.settings.theme] || CD.themes.clear, r = document.documentElement.style;
    r.setProperty('--car', t.car); r.setProperty('--car-deep', t.deep); r.setProperty('--accent', t.accent);
    r.setProperty('--tint', 'linear-gradient(160deg,' + t.ta + ',' + t.tb + ')');
  };

  // ---- Etat du vehicule ----
  CD.settings.volume = 100;      // plus de barre de son : le volume se regle avec les boutons de l'iPad
  CD.settings.mode = 'gps';      // version de production : toujours le vrai GPS
  CD.state = {
    mode: CD.settings.mode, speed: 0, heading: 0, alt: null, acc: null,
    lat: CD.settings.demoStart.lat, lon: CD.settings.demoStart.lon,
    dist: 0, max: 0, t0: Date.now()
  };

  // ---- Unites et formats ----
  CD.spd = function (kmh) { return CD.settings.units === 'mph' ? kmh * 0.621371 : kmh; };
  CD.unitLabel = function () { return CD.settings.units === 'mph' ? 'MPH' : 'KM/H'; };
  CD.pad = function (n) { return (n < 10 ? '0' : '') + n; };
  CD.fmtDist = function (m) {
    if (m < 1000) return (m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 10) * 10) + ' m';
    var k = m / 1000;
    return (k < 10 ? k.toFixed(1) : Math.round(k).toString()).replace('.', ',') + ' km';
  };
  CD.fmtSpoken = function (m) {
    if (m < 1000) return (Math.max(50, Math.round(m / 50) * 50)) + ' mètres';
    return (m / 1000).toFixed(1).replace('.', ',') + ' kilomètres';
  };
  CD.fmtDur = function (s) {
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + CD.pad(m % 60);
  };
  CD.fmtNum = function (n, d) { return Number(n).toFixed(d == null ? 0 : d).replace('.', ','); };

  // ---- Geographie ----
  CD.rad = function (d) { return d * Math.PI / 180; };
  CD.dist = function (a, b) {
    var R = 6371000, dLat = CD.rad(b.lat - a.lat), dLon = CD.rad(b.lon - a.lon);
    var q = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(CD.rad(a.lat)) * Math.cos(CD.rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(q));
  };
  CD.bearing = function (a, b) {
    var p1 = CD.rad(a.lat), p2 = CD.rad(b.lat), dl = CD.rad(b.lon - a.lon);
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  // ---- Petit message ----
  CD.toast = function (t) {
    var d = CD.el('div', { class: 'toast', text: t });
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3200);
  };

  // ---- Voix et bip ----
  CD.speak = function (text) {
    if (!CD.settings.voiceOn || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR'; u.volume = CD.settings.voiceVol / 100;
      var vs = window.speechSynthesis.getVoices();
      for (var i = 0; i < vs.length; i++) if (/^fr/i.test(vs[i].lang)) { u.voice = vs[i]; break; }
      u.onstart = function () { CD.emit('duck', true); };
      u.onend = u.onerror = function () { CD.emit('duck', false); };
      window.speechSynthesis.speak(u);
    } catch (e) {}
  };
  var actx = null;
  CD.beep = function () {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.12;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.25);
    } catch (e) {}
  };

  CD.confirmBtn = function (btn, action) {
    var orig = btn.textContent, armed = false, t = null;
    function reset() { armed = false; btn.textContent = orig; btn.classList.remove('armed'); }
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!armed) { armed = true; btn.textContent = 'Confirmer ?'; btn.classList.add('armed'); t = setTimeout(reset, 3500); }
      else { clearTimeout(t); reset(); action(); }
    });
  };
})();
