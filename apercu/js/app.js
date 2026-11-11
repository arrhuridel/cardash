/* Ecrans, accueil, voiture (carnet), reglages */
(function () {
  'use strict';
  var CD = window.CD, $ = CD.$, S = CD.state, ST = CD.settings, el = CD.el;
  var MAXV = 200, lastBeep = 0, wakeLock = null, screen = 'home';

  // ====================== NAVIGATION ENTRE ECRANS ======================
  function go(name) {
    screen = name;
    CD.qsa('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 's-' + name); });
    CD.qsa('.dock [data-go]').forEach(function (b) { b.classList.toggle('on', b.dataset.go === name); });
    CD.nav.onShow(name);
    if (name === 'music') CD.music.onShow();
    if (name === 'settings') { renderSettings(); renderCar(); }
    if (name === 'map' && !CD.nav.isGuiding()) CD.nav.focusSearch();
    CD.store.set('screen', name);
  }
  CD.go = go;
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-go]') : null;
    if (t) go(t.dataset.go);
  });

  // ====================== ACCUEIL ======================
  function pad(n) { return CD.pad(n); }
  function clock() {
    var d = new Date();
    $('time').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('date').textContent = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    $('gTime').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('gDate').textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  var CARDS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  function renderHome() {
    var u = CD.spd(S.speed);
    var vtxt = Math.max(0, Math.round(u));
    CD.qsa('[data-speed]').forEach(function (e) { e.textContent = vtxt; });
    $('dist').textContent = S.dist.toFixed(1);
    var s = Math.floor((Date.now() - S.t0) / 1000);
    $('dur').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    $('max').textContent = Math.round(CD.spd(S.max));
    $('alt').textContent = S.alt == null ? '--' : Math.round(S.alt);
    var lim = (ST.autoLimit && S.limit) ? S.limit : (ST.alertOn ? ST.alertLimit : null);
    CD.qsa('[data-lim]').forEach(function (e) { e.classList.toggle('hidden', !lim); if (lim) e.textContent = Math.round(CD.spd(lim)); });
    var over = !!lim && ST.alertOn && S.speed > lim + 0.5;
    CD.qsa('.spd').forEach(function (e) { e.classList.toggle('over', over); });
    if (over && Date.now() - lastBeep > 8000) { lastBeep = Date.now(); CD.beep(); }
  }
  function renderUnits() {
    CD.qsa('[data-unit]').forEach(function (e) { e.textContent = CD.unitLabel(); });
    $('maxU').textContent = CD.unitLabel().toLowerCase();

  }
  function endTrip(ev) {
    if (ev) ev.stopPropagation();
    var secs = Math.floor((Date.now() - S.t0) / 1000);
    if (S.dist >= 0.1) {
      var trips = CD.store.get('trips', []);
      trips.unshift({ id: Date.now(), date: new Date().toISOString(), km: +S.dist.toFixed(2), secs: secs, max: Math.round(S.max), demo: S.mode === 'demo' });
      CD.store.set('trips', trips.slice(0, 100));
      CD.toast('Trajet enregistré : ' + S.dist.toFixed(1).replace('.', ',') + ' km');
    } else CD.toast('Trajet trop court pour être enregistré');
    S.dist = 0; S.max = 0; S.t0 = Date.now();
    if (screen === 'car' || screen === 'settings') renderTrips();
  }
  $('btnEndTrip2').addEventListener('click', endTrip);

  // ====================== VOITURE : onglets ======================
  function showCTab(t) {
    CD.qsa('[data-ctab]').forEach(function (b) { b.classList.toggle('on', b.dataset.ctab === t); });
    ['fuel', 'maint', 'trips'].forEach(function (k) { $('cp-' + k).classList.toggle('hidden', k !== t); });
    CD.store.set('ctab', t);
  }
  CD.qsa('[data-ctab]').forEach(function (b) { b.onclick = function () { showCTab(b.dataset.ctab); }; });

  // ---- Kilometrage ----
  $('odoSave').onclick = function () {
    var v = parseFloat($('odoInput').value);
    if (isNaN(v) || v < 0) { CD.toast('Saisis un kilométrage valide'); return; }
    ST.odo = Math.round(v); CD.saveSettings(); CD.toast('Kilométrage enregistré'); renderFuel(); renderMaint();
  };
  CD.on('odo', function (km) { ST.odo += km; if (Math.random() < 0.05) CD.saveSettings(); });

  // ---- Pleins ----
  function fuel() { return CD.store.get('fuel', []); }
  function renderFuel() {
    $('odoInput').value = Math.round(ST.odo) || '';
    var list = fuel().slice().sort(function (a, b) { return a.km - b.km; });
    var kp = $('fuelKpis'); kp.innerHTML = '';
    var totL = 0, totKm = 0, totP = 0;
    list.forEach(function (f, i) { if (i > 0) { totL += f.litres; totKm += f.km - list[i - 1].km; } totP += f.price; });
    var avg = totKm > 0 ? totL / totKm * 100 : null;
    [['Conso moyenne', avg == null ? '--' : CD.fmtNum(avg, 1) + ' L/100'], ['Dépensé', CD.fmtNum(totP, 0) + ' €'], ['Pleins', String(list.length)]].forEach(function (k) {
      kp.appendChild(el('div', { class: 'kpi' }, el('div', { class: 'label', text: k[0] }), el('div', { style: 'font-size:20px;margin-top:4px', text: k[1] })));
    });
    var ul = $('fuelList'); ul.innerHTML = '';
    if (!list.length) { ul.appendChild(el('li', { class: 'empty', text: 'Aucun plein enregistré. Ajoute le premier ci-dessus.' })); return; }
    list.slice().reverse().forEach(function (f) {
      var i = list.indexOf(f), c = i > 0 && f.km > list[i - 1].km ? CD.fmtNum(f.litres / (f.km - list[i - 1].km) * 100, 1) + ' L/100' : '--';
      var rm = el('button', { class: 'btn small', text: 'Supprimer' });
      CD.confirmBtn(rm, function () { CD.store.set('fuel', fuel().filter(function (x) { return x.id !== f.id; })); renderFuel(); });
      ul.appendChild(el('li', { class: 'li' }, el('div', {},
        el('div', { class: 't1', text: new Date(f.date).toLocaleDateString('fr-FR') + ' · ' + f.km.toLocaleString('fr-FR') + ' km' }),
        el('div', { class: 't2', text: CD.fmtNum(f.litres, 2) + ' L · ' + CD.fmtNum(f.price, 2) + ' € · ' + CD.fmtNum(f.price / f.litres, 3) + ' €/L · ' + c })), rm));
    });
  }
  $('fAdd').onclick = function () {
    var km = parseFloat($('fKm').value), l = parseFloat($('fL').value), p = parseFloat($('fP').value);
    if (isNaN(km) || isNaN(l) || isNaN(p) || l <= 0 || p <= 0) { CD.toast('Remplis km, litres et prix'); return; }
    var a = fuel(); a.push({ id: Date.now(), date: new Date().toISOString(), km: Math.round(km), litres: l, price: p });
    CD.store.set('fuel', a);
    if (km > ST.odo) { ST.odo = Math.round(km); CD.saveSettings(); }
    $('fKm').value = $('fL').value = $('fP').value = ''; renderFuel(); renderMaint();
  };

  // ---- Entretien ----
  function maint() {
    var m = CD.store.get('maint', null);
    if (!m) {
      m = [
        { id: 1, name: 'Vidange moteur', everyKm: 15000, everyMonths: 12, lastKm: null, lastDate: null },
        { id: 2, name: 'Contrôle technique', everyKm: 0, everyMonths: 24, lastKm: null, lastDate: null },
        { id: 3, name: 'Pneus', everyKm: 0, everyMonths: 0, lastKm: null, lastDate: null },
        { id: 4, name: 'Freins', everyKm: 0, everyMonths: 0, lastKm: null, lastDate: null },
        { id: 5, name: 'Distribution', everyKm: 0, everyMonths: 0, lastKm: null, lastDate: null }
      ];
      CD.store.set('maint', m);
    }
    return m;
  }
  function saveMaint(m) { CD.store.set('maint', m); }
  function renderMaint() {
    var box = $('maintList'); box.innerHTML = '';
    var all = maint();
    all.forEach(function (it) {
      var txt = 'À renseigner : touche « Fait aujourd’hui »', cls = '';
      if (it.lastDate || it.lastKm != null) {
        var parts = [], worst = 0, bad = false, warn = false;
        if (it.everyKm && it.lastKm != null) {
          var r = it.lastKm + it.everyKm - ST.odo;
          parts.push(r >= 0 ? 'dans ' + Math.round(r).toLocaleString('fr-FR') + ' km' : 'en retard de ' + Math.round(-r).toLocaleString('fr-FR') + ' km');
          if (r < 0) bad = true; else if (r < it.everyKm * 0.1) warn = true;
        }
        if (it.everyMonths && it.lastDate) {
          var due = new Date(it.lastDate); due.setMonth(due.getMonth() + it.everyMonths);
          var days = Math.round((due - new Date()) / 86400000);
          parts.push(days >= 0 ? 'dans ' + days + ' jours' : 'en retard de ' + (-days) + ' jours');
          if (days < 0) bad = true; else if (days < 30) warn = true;
        }
        txt = parts.length ? 'Prochain : ' + parts.join(' · ') : 'Fait le ' + (it.lastDate ? new Date(it.lastDate).toLocaleDateString('fr-FR') : '') + ' (aucun intervalle défini)';
        cls = bad ? 'bad' : warn ? 'warn' : 'ok';
      }
      var done = el('button', { class: 'btn small primary', text: 'Fait aujourd’hui', onclick: function () {
        it.lastKm = Math.round(ST.odo); it.lastDate = new Date().toISOString(); saveMaint(all); renderMaint();
      } });
      var rm = el('button', { class: 'btn small', text: 'Supprimer' });
      CD.confirmBtn(rm, function () { saveMaint(all.filter(function (x) { return x.id !== it.id; })); renderMaint(); });
      var ik = el('input', { class: 'inp', type: 'number', inputmode: 'numeric', value: it.everyKm || '', placeholder: 'km' });
      var im = el('input', { class: 'inp', type: 'number', inputmode: 'numeric', value: it.everyMonths || '', placeholder: 'mois' });
      ik.onchange = function () { it.everyKm = parseInt(ik.value, 10) || 0; saveMaint(all); renderMaint(); };
      im.onchange = function () { it.everyMonths = parseInt(im.value, 10) || 0; saveMaint(all); renderMaint(); };
      box.appendChild(el('div', { class: 'mi' },
        el('div', { class: 'top' }, el('span', { class: 'nm', text: it.name }), el('div', { class: 'srow' }, done, rm)),
        el('div', { class: 'stt ' + cls, text: txt }),
        el('div', { class: 'inl' }, 'Tous les', ik, 'km, ou tous les', im, 'mois')));
    });
  }
  $('mAdd').onclick = function () {
    var n = $('mName').value.trim();
    if (!n) { CD.toast('Donne un nom à l’entretien'); return; }
    var a = maint(); a.push({ id: Date.now(), name: n, everyKm: 0, everyMonths: 0, lastKm: null, lastDate: null });
    saveMaint(a); $('mName').value = ''; renderMaint();
  };

  // ---- Trajets ----
  function renderTrips() {
    var trips = CD.store.get('trips', []);
    var km = 0, secs = 0; trips.forEach(function (t) { km += t.km; secs += t.secs; });
    var kp = $('tripKpis'); kp.innerHTML = '';
    [['Trajets', String(trips.length)], ['Distance', CD.fmtNum(km, 1) + ' km'], ['Temps', Math.floor(secs / 3600) + ' h ' + pad(Math.floor(secs % 3600 / 60))]].forEach(function (k) {
      kp.appendChild(el('div', { class: 'kpi' }, el('div', { class: 'label', text: k[0] }), el('div', { style: 'font-size:20px;margin-top:4px', text: k[1] })));
    });
    var ul = $('tripList'); ul.innerHTML = '';
    if (!trips.length) { ul.appendChild(el('li', { class: 'empty', text: 'Aucun trajet. Sur l’accueil, touche « Terminer le trajet ».' })); return; }
    trips.forEach(function (t) {
      var d = new Date(t.date), avg = t.secs > 0 ? t.km / (t.secs / 3600) : 0;
      var rm = el('button', { class: 'btn small', text: 'Supprimer' });
      CD.confirmBtn(rm, function () { CD.store.set('trips', CD.store.get('trips', []).filter(function (x) { return x.id !== t.id; })); renderTrips(); });
      ul.appendChild(el('li', { class: 'li' }, el('div', {},
        el('div', { class: 't1', text: d.toLocaleDateString('fr-FR') + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · ' + CD.fmtNum(t.km, 1) + ' km' + (t.demo ? ' (démo)' : '') }),
        el('div', { class: 't2', text: Math.floor(t.secs / 60) + ' min · moyenne ' + Math.round(avg) + ' km/h · max ' + t.max + ' km/h' })), rm));
    });
  }
  function renderCar() { renderFuel(); renderMaint(); renderTrips(); }

  // ====================== REGLAGES ======================
  function setSw(id, on) { $(id).classList.toggle('on', !!on); $(id).setAttribute('aria-checked', on ? 'true' : 'false'); }
  function renderSettings() {
    $('demoStartLbl').textContent = 'Départ actuel : ' + ST.demoStart.label;
    $('demoSpeed').value = ST.demoSpeed; $('demoSpeedV').textContent = Math.round(CD.spd(ST.demoSpeed)) + ' ' + CD.unitLabel().toLowerCase();
    CD.qsa('#unitSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.unit === ST.units); });
    $('alertLimit').value = Math.round(CD.spd(ST.alertLimit));
    setSw('swAutoLimit', ST.autoLimit); setSw('swDanger', ST.dangerZones); setSw('swTraffic', ST.trafficOn); $('appleToken').value = ST.appleToken || '';  setSw('swTrafficRoute', ST.trafficRoute); $('trafficKey').value = ST.trafficKey || '';
    setSw('swAlert', ST.alertOn); setSw('swVoice', ST.voiceOn); setSw('swWake', ST.wake);
    $('voiceVol').value = ST.voiceVol;
    var tb = $('themes'); tb.innerHTML = '';
    Object.keys(CD.themes).forEach(function (k) {
      var t = CD.themes[k];
      tb.appendChild(el('button', { class: 'dot' + (ST.theme === k ? ' on' : ''), title: t.name, 'aria-label': t.name,
        style: 'background:linear-gradient(135deg,' + t.car + ',' + t.accent + ')', onclick: function () { ST.theme = k; CD.saveSettings(); CD.applyTheme(); renderSettings(); } }));
    });
  }
  function bindSettings() {
    $('demoSpeed').oninput = function () { ST.demoSpeed = +this.value; CD.saveSettings(); $('demoSpeedV').textContent = Math.round(CD.spd(ST.demoSpeed)) + ' ' + CD.unitLabel().toLowerCase(); };
    CD.qsa('#unitSeg button').forEach(function (b) {
      b.onclick = function () { ST.units = b.dataset.unit; CD.saveSettings(); renderUnits(); renderSettings(); };
    });
    $('alertLimit').onchange = function () {
      var v = parseFloat(this.value); if (isNaN(v) || v < 10) { renderSettings(); return; }
      ST.alertLimit = ST.units === 'mph' ? v / 0.621371 : v; CD.saveSettings(); renderUnits(); renderSettings();
    };
    $('swAutoLimit').onclick = function () { ST.autoLimit = !ST.autoLimit; if (!ST.autoLimit) S.limit = null; CD.saveSettings(); renderSettings(); };
    $('swDanger').onclick = function () { ST.dangerZones = !ST.dangerZones; CD.saveSettings(); renderSettings(); };
    $('appleToken').onchange = function () { ST.appleToken = this.value.trim(); CD.saveSettings(); CD.toast(ST.appleToken ? 'Jeton enregistré : recharge la page pour l’utiliser' : 'Jeton effacé : recharge la page'); };
    $('swTrafficRoute').onclick = function () { ST.trafficRoute = !ST.trafficRoute; CD.saveSettings(); renderSettings(); };
    $('swTraffic').onclick = function () {
      if (!ST.trafficOn && !ST.trafficKey) { CD.toast('Colle d\u2019abord ta cl\u00e9 TomTom'); return; }
      ST.trafficOn = !ST.trafficOn; CD.saveSettings(); renderSettings(); CD.nav.applyTraffic();
    };
    $('trafficKey').onchange = function () { ST.trafficKey = this.value.trim(); if (!ST.trafficKey) ST.trafficOn = false; CD.saveSettings(); renderSettings(); CD.nav.applyTraffic(); };
    $('swAlert').onclick = function () { ST.alertOn = !ST.alertOn; CD.saveSettings(); renderUnits(); renderSettings(); };
    $('swVoice').onclick = function () { ST.voiceOn = !ST.voiceOn; CD.saveSettings(); renderSettings(); CD.emit('settings'); };
    $('voiceVol').oninput = function () { ST.voiceVol = +this.value; CD.saveSettings(); };
    $('voiceTest').onclick = function () { var was = ST.voiceOn; ST.voiceOn = true; CD.speak('Dans trois cents mètres, tournez à droite'); ST.voiceOn = was; };
    $('swWake').onclick = function () { ST.wake = !ST.wake; CD.saveSettings(); renderSettings(); applyWake(); };
    $('demoStartBtn').onclick = function () {
      var q = $('demoStartInp').value.trim(); if (!q) { CD.toast('Écris une ville ou une adresse'); return; }
      CD.geocode(q).then(function (r) { CD.setDemoStart(r.lat, r.lon, r.label); renderSettings(); CD.toast('Départ de la démo : ' + r.label); })
        .catch(function () { CD.toast('Adresse introuvable ou pas de connexion'); });
    };
    $('demoStartInp').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('demoStartBtn').click(); });
    $('demoHere').onclick = function () {
      if (!navigator.geolocation) { CD.toast('Position indisponible'); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        CD.setDemoStart(p.coords.latitude, p.coords.longitude, 'Ma position'); renderSettings(); CD.toast('Départ de la démo : ma position');
      }, function () { CD.toast('Position refusée ou indisponible'); }, { timeout: 15000 });
    };
    CD.confirmBtn($('wipe'), function () {
      CD.store.clear(); CD.resetSettings(); CD.applyTheme(); CD.saveSettings();
      renderUnits(); renderSettings(); renderCar(); CD.toast('Données effacées');
    });
  }

  // ---- Ecran toujours allume ----
  function applyWake() {
    try {
      if (ST.wake && navigator.wakeLock && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
      } else if (!ST.wake && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) applyWake(); });

  // ====================== DEMARRAGE ======================
  CD.applyTheme();
  bindSettings(); renderUnits(); clock(); setInterval(clock, 1000);
  CD.on('tick', renderHome);
  showCTab(CD.store.get('ctab', 'fuel'));
  applyWake();
  var start = CD.store.get('screen', 'home'); if (!document.getElementById('s-' + start)) start = 'home';
  if (start !== 'home') go(start); else CD.nav.onShow('home');
})();

// Ecran toujours allume pendant la conduite (si l'appareil le permet)
(function () {
  var lock = null;
  function ask() { try { if (navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {}); } catch (e) {} }
  document.addEventListener('visibilitychange', ask); ask();
})();
