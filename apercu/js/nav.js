/* Position (GPS ou demo), cartes, recherche, itineraire, guidage et voix */
(function () {
  'use strict';
  var CD = window.CD, $ = CD.$, S = CD.state, ST = CD.settings;
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';

  var route = null, alts = [], guiding = false, arrived = false, lanesKey = '';
  var maps = {}, layers = {}, markers = {}, markerAngle = { mini: 0, main: 0 };
  var follow = true, said = {}, offCount = 0, lastReroute = 0, idx = 0;
  var sim = { s: 0, t: 0 }, watchId = null, lastGps = null, lastPosEmit = 0, mainVisible = false, miniVisible = true;

  // ====================== CARTES (routes seules, style navigation) ======================
  var ML = window.maplibregl, ready = {}, destMk = {}, EMPTY = { type: 'FeatureCollection', features: [] };

  function palette(night) {
    return night
      ? { bg: '#141720', small: '#3a4152', mid: '#4d566a', big: '#677188', hwy: '#939eb8', casing: '#0b0d13', water: '#10263a', waterline: '#17405f', park: '#17261f', bld: '#2a303f', text: '#d3d9e6', halo: '#10131a' }
      : { bg: '#e9e7e1', small: '#ffffff', mid: '#ffffff', big: '#fff1c2', hwy: '#ffd36e', casing: '#bfc3cb', water: '#a9d3ee', waterline: '#8fc3e6', park: '#cfe6bf', bld: '#d9d5cc', text: '#3a3f4a', halo: '#ffffff' };
  }
  function isNight() {
    var t = ST.mapTheme;
    if (t === 'night') return true;
    if (t === 'day') return false;
    var h = new Date().getHours();
    return h < 7 || h >= 20;
  }
  var lastNight = null;

  function roadStyle() {
    function wd(stops, k, add) {
      var a = ['interpolate', ['exponential', 1.4], ['zoom']];
      stops.forEach(function (s) { a.push(s[0], s[1] * k + add); });
      return a;
    }
    var P = palette(isNight()), L = ST.layers || {};
    lastNight = isNight();
    document.documentElement.classList.toggle('mapday', !lastNight);   // commandes foncees quand la carte est claire
    function vis(key) { return L[key] ? 'visible' : 'none'; }
    var groups = [
      { id: 'small', cls: ['minor', 'service', 'track'], min: 11, w: [[11, .3], [14, 1.3], [16, 4.5], [18, 10], [20, 24]] },
      { id: 'mid', cls: ['tertiary', 'secondary'], min: 9, w: [[9, .4], [12, 1.4], [14, 3.2], [16, 7.5], [18, 15], [20, 32]] },
      { id: 'big', cls: ['primary', 'trunk'], min: 7, w: [[8, .5], [12, 2], [14, 4.5], [16, 9.5], [18, 19], [20, 38]] },
      { id: 'hwy', cls: ['motorway'], min: 5, w: [[6, .5], [10, 1.6], [14, 5.5], [16, 11], [18, 22], [20, 42]] }
    ];
    var layers = [{ id: 'bg', type: 'background', paint: { 'background-color': P.bg } }];
    layers.push({ id: 'x-park', type: 'fill', source: 'om', 'source-layer': 'park', layout: { visibility: vis('parks') }, paint: { 'fill-color': P.park } });
    layers.push({ id: 'x-water', type: 'fill', source: 'om', 'source-layer': 'water', layout: { visibility: vis('water') }, paint: { 'fill-color': P.water } });
    layers.push({ id: 'x-waterway', type: 'line', source: 'om', 'source-layer': 'waterway', layout: { visibility: vis('water') },
      paint: { 'line-color': P.waterline, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 4] } });
    layers.push({ id: 'x-building', type: 'fill-extrusion', source: 'om', 'source-layer': 'building', minzoom: 14, layout: { visibility: vis('buildings') },
      paint: { 'fill-extrusion-color': P.bld, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.92 } });
    function lyr(id, g, color, width) {
      return { id: id, type: 'line', source: 'om', 'source-layer': 'transportation', minzoom: g.min,
        filter: ['in', ['get', 'class'], ['literal', g.cls]],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width } };
    }
    groups.forEach(function (g) { layers.push(lyr('c-' + g.id, g, P.casing, wd(g.w, 1.5, 0.7))); });
    groups.forEach(function (g) { layers.push(lyr('f-' + g.id, g, P[g.id], wd(g.w, 1, 0))); });
    layers.push({ id: 'x-roadname', type: 'symbol', source: 'om', 'source-layer': 'transportation_name', minzoom: 13,
      layout: { visibility: vis('labels'), 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 14], 'text-letter-spacing': 0.02 },
      paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.6 } });
    layers.push({ id: 'x-place', type: 'symbol', source: 'om', 'source-layer': 'place', minzoom: 8,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter']]],
      layout: { visibility: vis('labels'), 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15], 'text-max-width': 8 },
      paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.8 } });
    return { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: { om: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } }, layers: layers };
  }

  function applyPalette() {
    var P = palette(isNight());
    ['mini', 'main'].forEach(function (k) {
      var m = maps[k];
      if (!m || !ready[k] || !m.getLayer('bg')) return;
      m.setPaintProperty('bg', 'background-color', P.bg);
      ['small', 'mid', 'big', 'hwy'].forEach(function (g) { m.setPaintProperty('f-' + g, 'line-color', P[g]); m.setPaintProperty('c-' + g, 'line-color', P.casing); });
      m.setPaintProperty('x-water', 'fill-color', P.water); m.setPaintProperty('x-waterway', 'line-color', P.waterline);
      m.setPaintProperty('x-park', 'fill-color', P.park); m.setPaintProperty('x-building', 'fill-extrusion-color', P.bld);
      ['x-roadname', 'x-place'].forEach(function (id) { m.setPaintProperty(id, 'text-color', P.text); m.setPaintProperty(id, 'text-halo-color', P.halo); });
    });
    lastNight = isNight();
    document.documentElement.classList.toggle('mapday', !lastNight);
  }
  function applyLayerVis() {
    var L = ST.layers, groups = { labels: ['x-roadname', 'x-place'], buildings: ['x-building'], parks: ['x-park'], water: ['x-water', 'x-waterway'] };
    ['mini', 'main'].forEach(function (k) {
      var m = maps[k];
      if (!m || !ready[k] || !m.getLayer('bg')) return;
      Object.keys(groups).forEach(function (key) { groups[key].forEach(function (id) { m.setLayoutProperty(id, 'visibility', L[key] ? 'visible' : 'none'); }); });
    });
  }

  function mkMap(el, interactive) {
    var m = new ML.Map({
      container: el, style: roadStyle(), center: [S.lon, S.lat], zoom: interactive ? 15 : 15.3, bearing: S.heading,
      attributionControl: false, interactive: interactive, dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0,
      pixelRatio: Math.min(window.devicePixelRatio || 1, interactive ? 1.5 : 1.25),   // moins de pixels a dessiner : carte plus fluide sur iPad 7
      refreshExpiredTiles: false, localIdeographFontFamily: false, maxTileCacheSize: 60
    });
    m.addControl(new ML.AttributionControl({ compact: true, customAttribution: 'OpenFreeMap © OpenMapTiles, données © OpenStreetMap' }), 'bottom-right');
    if (interactive) m.touchZoomRotate.disableRotation();
    return m;
  }
  function meEl() {
    var d = document.createElement('div');
    d.className = 'me';
    d.innerHTML = '<div class="me-pulse"></div><svg class="me-arrow" viewBox="-20 -20 40 40"><path d="M0 -17 L13 15 L0 8 L-13 15 Z" fill="#fff" stroke="#262b36" stroke-width="3" stroke-linejoin="round"/></svg>';
    return d;
  }
  function ensureMap(key) {
    if (maps[key]) return maps[key];
    var m = mkMap($(key === 'mini' ? 'mapMini' : 'mapMain'), key === 'main');
    maps[key] = m;
    markers[key] = new ML.Marker({ element: meEl(), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([S.lon, S.lat]).addTo(m);
    m.on('load', function () {
      m.addSource('routealt', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'route-alt', type: 'line', source: 'routealt', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#8b93a7', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 17, 10, 19, 16] } });
      m.addSource('route', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0a2a4a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 12, 17, 22, 19, 34] } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2fa8ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7, 17, 13, 19, 22] } });
      m.addSource('routejam', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'route-jam', type: 'line', source: 'routejam', layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7, 17, 13, 19, 22] } });
      ready[key] = true; drawRoute(key); applyTraffic(); applyLayerVis();
    });
    m.on('error', function (e) { console.warn('carte:', e && e.error && e.error.message); });
    if (key === 'main') { m.on('moveend', poiSoon); m.on('zoomend', function () { drawIncs(); }); }
    if (key === 'main') m.on('dragstart', function (e) { if (e.originalEvent) { follow = false; $('btnRecenter').classList.remove('on'); } });
    return m;
  }
  function drawRoute(key) {
    var m = maps[key];
    if (!m || !ready[key]) return;
    m.getSource('route').setData(route ? { type: 'Feature', geometry: { type: 'LineString', coordinates: route.ll } } : EMPTY);
    var altSrc = m.getSource('routealt');
    if (altSrc) altSrc.setData(route && alts.length > 1 ? { type: 'Feature', geometry: { type: 'MultiLineString',
      coordinates: alts.filter(function (r) { return r !== route; }).map(function (r) { return r.ll; }) } } : EMPTY);
    var jamSrc = m.getSource('routejam');
    if (jamSrc) jamSrc.setData(jamsGeo(route));
    if (destMk[key]) { destMk[key].remove(); destMk[key] = null; }
    if (route) {
      var d = document.createElement('div'); d.className = 'dest';
      destMk[key] = new ML.Marker({ element: d }).setLngLat([route.dest.lon, route.dest.lat]).addTo(m);
    }
  }
  function updMarker(key) {
    var mk = markers[key];
    if (!mk) return;
    mk.setLngLat([S.lon, S.lat]); mk.setRotation(S.heading);
  }
  function camera(key, dur) {
    var m = maps[key];
    if (!m) return;
    var o = { center: [S.lon, S.lat], bearing: S.heading, duration: dur, easing: function (t) { return t; },
      offset: [0, m.getContainer().clientHeight * 0.2], essential: true,
      pitch: (ST.tilt && (guiding || key === 'main')) ? 55 : 0 };
    if (key === 'mini') o.zoom = guiding ? 16.3 - Math.min(1.2, S.speed / 70) : 15.3;
    else if (guiding) o.zoom = 17.3 - Math.min(1.6, S.speed / 60);
    m.easeTo(o);
  }
  function updMaps() {
    if (!R.on) { updMarker('mini'); updMarker('main'); }     // sinon c'est la boucle d'animation qui deplace la voiture et la camera
  }
  // Animation fluide : a chaque image on rapproche la position affichee de la vraie position (10 Hz en demo, 1 Hz en GPS)
  var R = { on: false, lat: null, lon: null, hdg: 0, zoom: null, last: 0, a: {}, slow: 0, n: 0, skip: false, hgt: {} };
  function hdgDelta(a, b) { return ((((b - a) % 360) + 540) % 360) - 180; }   // plus court chemin entre deux caps, meme avec des angles negatifs ou tres grands
  function animFrame(ts) {
    window.addEventListener('resize', function () { R.hgt = {}; R.a = {}; });
  requestAnimationFrame(animFrame);
    var dt = Math.min(0.1, (ts - R.last) / 1000); R.last = ts;
    var key = miniVisible ? 'mini' : (mainVisible ? 'main' : null), m = key && maps[key];
    if (document.hidden || !m || S.lat == null) { R.on = false; return; }
    var tl = S.lat, tn = S.lon;
    if (S.mode === 'gps' && lastFixAt && S.speed > 1) {          // GPS : on prolonge le mouvement entre deux mesures
      var ex = Math.min(1.5, (Date.now() - lastFixAt) / 1000), dm = S.speed / 3.6 * ex, hr = S.heading * Math.PI / 180;
      tl += dm * Math.cos(hr) / 111320; tn += dm * Math.sin(hr) / (111320 * Math.cos(tl * Math.PI / 180));
    }
    if (R.lat == null || Math.abs(tl - R.lat) > 0.003 || Math.abs(tn - R.lon) > 0.003) { R.lat = tl; R.lon = tn; R.hdg = S.heading; R.zoom = null; }
    var kp = 1 - Math.exp(-dt * (S.mode === 'gps' ? 6 : 9)), kh = 1 - Math.exp(-dt * 6), kz = 1 - Math.exp(-dt * 2.5);
    R.lat += (tl - R.lat) * kp; R.lon += (tn - R.lon) * kp; R.hdg += hdgDelta(R.hdg, S.heading) * kh;      // angle continu (sans retour a 0) : evite le tour complet de la fleche
    R.on = true;
    // appareil lent (iPad 7) : si les images mettent trop de temps, la carte n'est mise a jour qu'une image sur deux
    R.slow += ((dt > 0.024 ? 1 : 0) - R.slow) * 0.02; R.n++;
    if (R.slow > 0.5 && (R.n & 1)) return;
    // rien n'a bouge depuis la derniere image : on ne redessine pas la carte
    var A = R.a, pitchT = (ST.tilt && (guiding || key === 'main')) ? 55 : 0;
    var ztT = key === 'mini' ? (guiding ? 16.3 - Math.min(1.2, S.speed / 70) : 15.3) : (guiding ? 17.3 - Math.min(1.6, S.speed / 60) : null);
    if (A.key === key && Math.abs(A.lat - R.lat) < 2e-7 && Math.abs(A.lon - R.lon) < 2e-7 && Math.abs(A.hdg - R.hdg) < 0.03 && A.pitch === pitchT &&
        (ztT == null || (R.zoom != null && Math.abs(ztT - R.zoom) < 0.002)) && A.follow === follow) return;
    A.key = key; A.lat = R.lat; A.lon = R.lon; A.hdg = R.hdg; A.pitch = pitchT; A.follow = follow;
    var mk = markers[key]; if (mk) { mk.setLngLat([R.lon, R.lat]); mk.setRotation(R.hdg); }
    if (key === 'main' && !follow) return;
    var zt = key === 'mini' ? (guiding ? 16.3 - Math.min(1.2, S.speed / 70) : 15.3) : (guiding ? 17.3 - Math.min(1.6, S.speed / 60) : null);
    var o = { center: [R.lon, R.lat], bearing: R.hdg, duration: 0, offset: [0, (R.hgt[key] || (R.hgt[key] = m.getContainer().clientHeight)) * 0.2], pitch: pitchT };
    if (zt != null) { R.zoom = R.zoom == null ? zt : R.zoom + (zt - R.zoom) * kz; o.zoom = R.zoom; }
    m.easeTo(o);
  }
  requestAnimationFrame(animFrame);
  function fitRoute(r) {
    var b = new ML.LngLatBounds(), m = ensureMap('main');
    r.ll.forEach(function (p) { b.extend(p); });
    m.stop(); m.fitBounds(b, { padding: { top: 80, bottom: 90, left: 440, right: 100 }, bearing: 0, duration: 700, maxZoom: 17 });
  }

  // ====================== POSITION ======================
  function pointAt(s) {
    var c = route.cum, n = c.length, lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (c[mid] <= s) lo = mid; else hi = mid; }
    var seg = c[hi] - c[lo], t = seg > 0 ? (s - c[lo]) / seg : 0;
    var a = route.coords[lo], b = route.coords[hi];
    return { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t,
      hdg: CD.bearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) };
  }
  function demoStep(dt) {
    sim.t += dt;
    var target;
    if (guiding && route) {
      target = ST.demoSpeed + 6 * Math.sin(sim.t / 5);
      var info = stepInfo(sim.s);
      if (info.dNext < 70) target = Math.min(target, 25);
      if (route.total - sim.s < 25 || arrived) target = 0;
    } else if (route) target = 0;
    else target = ST.demoSpeed + 8 * Math.sin(sim.t / 7);
    S.speed += (target - S.speed) * Math.min(1, dt * 0.8);
    if (target === 0 && S.speed < 0.5) S.speed = 0;
    var step = S.speed / 3.6 * dt;
    if (guiding && route) {
      sim.s = Math.min(route.total, sim.s + step);
      var p = pointAt(sim.s); S.lat = p.lat; S.lon = p.lon; S.heading = p.hdg;
    } else if (!route) {
      S.heading = (S.heading + Math.sin(sim.t / 11) * 4 * dt + 360) % 360;
      S.lat += step * Math.cos(CD.rad(S.heading)) / 111320;
      S.lon += step * Math.sin(CD.rad(S.heading)) / (111320 * Math.cos(CD.rad(S.lat)));
    }
    S.alt = 120 + 30 * Math.sin(sim.t / 20);
    S.dist += step / 1000;
    if (S.speed > S.max) S.max = S.speed;
  }
  var gpsPrev = null, lastFixAt = 0;
  function startGps() {
    if (!navigator.geolocation) { setStatus('GPS indisponible'); return; }
    setStatus('GPS : attente du signal');
    lastGps = null; gpsPrev = null; lastFixAt = 0;
    watchId = navigator.geolocation.watchPosition(function (p) {
      var c = p.coords, t = p.timestamp || Date.now(), pos = { lat: c.latitude, lon: c.longitude };
      if (c.accuracy > 150 && gpsPrev) return;                       // fix trop imprecis : on garde la derniere position
      lastFixAt = Date.now();
      var sp = (c.speed != null && !isNaN(c.speed)) ? c.speed * 3.6 : null;
      var hd = (c.heading != null && !isNaN(c.heading)) ? c.heading : null;
      var moved = true;
      if (gpsPrev) {
        var dt = (t - gpsPrev.t) / 1000, d = CD.dist(gpsPrev, pos);
        moved = d > Math.max(3, c.accuracy * 0.4);
        // iOS donne souvent vitesse et cap nuls : on les calcule a partir du deplacement
        if (sp == null) sp = (moved && dt > 0.2) ? Math.min(250, d / dt * 3.6) : 0;
        if (moved && (hd == null || sp < 3) && d > Math.max(5, c.accuracy * 0.5)) hd = CD.bearing(gpsPrev, pos);
      } else if (sp == null) sp = 0;
      if (moved) gpsPrev = { lat: pos.lat, lon: pos.lon, t: t };
      S.speed = S.speed * 0.4 + sp * 0.6;
      if (S.speed < 1.5) S.speed = 0;
      if (hd != null && sp >= 3) S.heading = hd; else if (hd != null && moved) S.heading = hd;
      S.alt = c.altitude; S.acc = c.accuracy;
      if (moved || !lastGps) {
        if (lastGps && c.accuracy < 50) {
          var dd = CD.dist(lastGps, pos);
          if (dd > 3) { S.dist += dd / 1000; CD.emit('odo', dd / 1000); }
        }
        S.lat = pos.lat; S.lon = pos.lon; if (c.accuracy < 50) lastGps = pos;
      }
      if (S.speed > S.max) S.max = S.speed;
      setStatus('GPS : précision ' + Math.round(c.accuracy) + ' m');
    }, function (e) {
      setStatus(e && e.code === 1 ? 'GPS refusé : autorise la position' : e && e.code === 3 ? 'GPS : signal lent' : 'GPS indisponible');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function stopGps() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
  function setStatus(t) { $('status').textContent = t; }

  function setMode(m) {
    S.mode = ST.mode = m; CD.saveSettings();
    stopGps(); S.speed = 0;
    if (m === 'gps') startGps();
    else { setStatus('Démo'); S.lat = S.lat || ST.demoStart.lat; }
    CD.qsa('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    document.documentElement.classList.toggle('isdemo', m === 'demo');
    if (guiding) stopGuidance(true);
    CD.emit('mode', m);
  }
  CD.setMode = setMode;

  CD.setDemoStart = function (lat, lon, label) {
    ST.demoStart = { lat: lat, lon: lon, label: label }; CD.saveSettings();
    if (S.mode === 'demo') {
      if (guiding) stopGuidance(true);
      route = null; drawRoute('mini'); drawRoute('main');
      S.lat = lat; S.lon = lon; S.speed = 0;
      if (maps.mini) maps.mini.jumpTo({ center: [lon, lat], zoom: 15.3 });
      if (maps.main) maps.main.jumpTo({ center: [lon, lat], zoom: 15 });
      updMarker('mini'); updMarker('main');
    }
  };

  var prev = Date.now();
  setInterval(function () {
    var now = Date.now(), dt = Math.min(0.5, (now - prev) / 1000); prev = now;
    if (S.mode === 'demo') demoStep(dt);
    else if (lastFixAt) {
      var age = now - lastFixAt;
      if (age > 8000 && age < 8200) setStatus('Signal GPS perdu');
      if (age > 15000) S.speed = 0;
    }
    CD.emit('tick');
    if (now - lastPosEmit > 700) { lastPosEmit = now; updMaps(); updateGuidance(); fastTick(); limitTick(); camsTick(); wxTick(); incTick(); if (lastNight !== null && isNight() !== lastNight) applyPalette(); CD.emit('pos'); }
  }, 100);

  // ====================== ITINERAIRE ======================
  var DIR = { 'left': 'à gauche', 'right': 'à droite', 'slight left': 'légèrement à gauche', 'slight right': 'légèrement à droite',
    'sharp left': 'franchement à gauche', 'sharp right': 'franchement à droite', 'straight': 'tout droit', 'uturn': 'demi-tour' };
  var ORD = ['', 'première', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'sixième', 'septième'];

  function stepText(s) {
    var m = s.m, t = m.type, mod = m.modifier || '', dir = DIR[mod] || '', on = s.name ? ' sur ' + s.name : '';
    if (t === 'depart') return 'Démarrez' + on;
    if (t === 'arrive') return 'Vous êtes arrivé';
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn' || t === 'exit roundabout' || t === 'exit rotary')
      return 'Au rond-point, prenez la ' + (ORD[m.exit] || 'prochaine') + ' sortie' + on;
    if (mod === 'uturn') return 'Faites demi-tour';
    if (t === 'turn' || t === 'end of road') return 'Tournez ' + dir + on;
    if (t === 'fork') return 'Serrez ' + (dir || 'à droite') + on;
    if (t === 'merge') return 'Insérez-vous ' + dir;
    if (t === 'on ramp' || t === 'off ramp') return 'Prenez la bretelle ' + dir;
    if ((t === 'new name' || t === 'continue') && mod && mod !== 'straight') return 'Tournez ' + dir + on;
    return 'Continuez tout droit' + on;
  }
  var ARROW = 'M12 20V5M7 10l5-5 5 5', FLAG = 'M6 21V4M6 4h11l-2 4 2 4H6', ROUND = 'M12 21v-5M12 16a4 4 0 1 1 4-4M16 8l-1.5 4H10.5';
  var ROT = { 'straight': 0, 'slight right': 40, 'right': 90, 'sharp right': 135, 'uturn': 180, 'slight left': -40, 'left': -90, 'sharp left': -135 };
  function iconFor(s) {
    var t = s.m.type, mod = s.m.modifier || 'straight';
    if (t === 'arrive') return { d: FLAG, rot: 0 };
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') return { d: ROUND, rot: 0 };
    return { d: ARROW, rot: ROT[mod] || 0 };
  }
  function setIcon(prefix, ic) {
    var svg = $(prefix + 'Svg'), p = $(prefix + 'Icon');
    p.setAttribute('d', ic.d); svg.style.transform = 'rotate(' + ic.rot + 'deg)';
  }

  function parseRoute(r, to) {
    var coords = r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
    var cum = [0], i;
    for (i = 1; i < coords.length; i++) cum.push(cum[i - 1] + CD.dist({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] }));
    var total = cum[cum.length - 1] || 1, steps = [], acc = 0;
    r.legs.forEach(function (leg) {
      leg.steps.forEach(function (s) {
        acc += s.distance;
        var ln = s.intersections && s.intersections[0] && s.intersections[0].lanes;
        steps.push({ m: s.maneuver, name: s.name || '', lanes: ln && ln.length > 1 ? ln : null, endCum: Math.min(total, acc / r.distance * total) });
      });
    });
    return { coords: coords, ll: r.geometry.coordinates, cum: cum, total: total, duration: r.duration, distance: r.distance, steps: steps, dest: to };
  }
  function fetchRoutes(from, to) {
    var url = OSRM + from.lon + ',' + from.lat + ';' + to.lon + ',' + to.lat + '?overview=full&geometries=geojson&steps=true&alternatives=true';
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.routes || !j.routes.length) throw new Error('aucun itinéraire');
      return j.routes.slice(0, 3).map(function (r) { return parseRoute(r, to); });
    });
  }
  function fetchRoute(from, to) { return fetchRoutes(from, to).then(function (a) { return a[0]; }); }

  function stepInfo(prog) {
    var st = route.steps, k = 0;
    while (k < st.length - 1 && st[k].endCum <= prog + 1) k++;
    return { k: k, next: k + 1 < st.length ? st[k + 1] : null, dNext: Math.max(0, st[k].endCum - prog),
      len: st[k].endCum - (k ? st[k - 1].endCum : 0) };
  }
  function projectSeg(p, a, b) {
    var kx = 111320 * Math.cos(CD.rad(p.lat)), ky = 110540;
    var ax = (a[1] - p.lon) * kx, ay = (a[0] - p.lat) * ky, bx = (b[1] - p.lon) * kx, by = (b[0] - p.lat) * ky;
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0, cx = ax + t * dx, cy = ay + t * dy;
    return { d: Math.sqrt(cx * cx + cy * cy), t: t };
  }
  function progressNow() {
    if (S.mode === 'demo') return sim.s;
    var best = Infinity, bi = idx, bt = 0, end = Math.min(route.coords.length - 2, idx + 80);
    for (var i = Math.max(0, idx - 2); i <= end; i++) {
      var r = projectSeg(S, route.coords[i], route.coords[i + 1]);
      if (r.d < best) { best = r.d; bi = i; bt = r.t; }
    }
    if (best > Math.max(80, (S.acc || 0) * 2)) { offCount++; if (offCount >= 4) reroute(); } else offCount = 0;
    idx = bi;
    return route.cum[bi] + bt * (route.cum[bi + 1] - route.cum[bi]);
  }
  var LANE_ROT = { 'left': -90, 'sharp left': -135, 'slight left': -40, 'straight': 0, 'slight right': 40, 'right': 90, 'sharp right': 135, 'uturn': 180 };
  function renderLanes(lanes, show) {
    var el = $('lanes');
    if (!lanes || !show) { el.classList.add('hidden'); lanesKey = ''; return; }
    var key = JSON.stringify(lanes.map(function (l) { return [l.valid, l.indications]; }));
    if (key !== lanesKey) {
      lanesKey = key; el.innerHTML = '';
      lanes.forEach(function (l) {
        var ind = (l.indications && l.indications[0]) || 'straight';
        if (ind === 'none') ind = 'straight';
        var d = document.createElement('div'); d.className = 'lane' + (l.valid ? ' ok' : '');
        d.innerHTML = '<svg viewBox="0 0 24 24" style="transform:rotate(' + (LANE_ROT[ind] || 0) + 'deg)"><path d="M12 20V5M7 10l5-5 5 5"/></svg>';
        el.appendChild(d);
      });
    }
    el.classList.remove('hidden');
  }
  function lowerFirst(t) { return t.charAt(0).toLowerCase() + t.slice(1); }
  function updatePreview() {
    var r = route;
    $('routeDest').textContent = r.dest.label;
    $('rsDur').textContent = CD.fmtDur(r.duration); $('rsDist').textContent = CD.fmtDist(r.distance);
    var e = new Date(Date.now() + r.duration * 1000); $('rsEta').textContent = 'arrivée ' + CD.pad(e.getHours()) + ':' + CD.pad(e.getMinutes()) + (r.traffic ? (r.delay >= 60 ? ' · dont ' + CD.fmtDur(r.delay) + ' de circulation' : ' · circulation fluide') +
      ((r.jams || []).some(function (j) { return j.cat === 'ROAD_WORK'; }) ? ' · travaux sur le trajet' : '') : '');
  }
  function renderAlts() {
    var box = $('altChips');
    box.innerHTML = '';
    if (alts.length < 2) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var base = alts[0].duration;
    alts.forEach(function (r, i) {
      var diff = Math.round((r.duration - base) / 60);
      box.appendChild(CD.el('button', { class: 'btn small' + (r === route ? ' primary' : ''), onclick: function () { selectAlt(i); } },
        'Route ' + (i + 1) + ' · ' + CD.fmtDur(r.duration) + ' · ' + CD.fmtDist(r.distance) + (diff > 0 ? ' (+' + diff + ' min)' : '') + (r.traffic && r.delay >= 60 ? ' · ' + Math.round(r.delay / 60) + ' min de bouchons' : '')));
    });
  }
  function selectAlt(i) { route = alts[i]; updatePreview(); drawRoute('main'); drawRoute('mini'); renderAlts(); }

  function updateGuidance() {
    if (!guiding || !route || arrived) return;
    var prog = progressNow(), remain = Math.max(0, route.total - prog), info = stepInfo(prog);
    if (S.mode !== 'demo' && S.speed < 5 && idx < route.coords.length - 1) S.heading = CD.bearing({ lat: route.coords[idx][0], lon: route.coords[idx][1] }, { lat: route.coords[idx + 1][0], lon: route.coords[idx + 1][1] });
    var txt = info.next ? stepText(info.next) : 'Vous êtes arrivé', ic = iconFor(info.next || { m: { type: 'arrive' } });
    var big = CD.fmtDist(info.dNext);
    $('bnBig').textContent = big; $('bnSub').textContent = txt; setIcon('bn', ic);
    $('mbBig').textContent = big; $('mbSub').textContent = txt; setIcon('mb', ic);
    var nx = info.next, st2 = route.steps[info.k + 2];
    renderLanes(nx && nx.lanes, !!(nx && nx.lanes && info.dNext < 700));
    $('bnThen').textContent = (nx && st2 && (nx.endCum - route.steps[info.k].endCum) < 400) ? 'Puis ' + lowerFirst(stepText(st2)) : '';
    var k = info.k;
    if (info.dNext <= 400 && info.len > 500 && !said[k + 'a']) { said[k + 'a'] = 1; CD.speak('Dans ' + CD.fmtSpoken(info.dNext) + ', ' + txt); }
    if (info.dNext <= 60 && !said[k + 'b']) { said[k + 'b'] = 1; CD.speak(txt); }
    var secs = route.duration * remain / route.total;
    $('etaDur').textContent = CD.fmtDur(secs); $('etaDist').textContent = CD.fmtDist(remain);
    var d = new Date(Date.now() + secs * 1000); $('etaClock').textContent = CD.pad(d.getHours()) + ':' + CD.pad(d.getMinutes());
    $('mEtaDur').textContent = $('etaDur').textContent; $('mEtaDist').textContent = $('etaDist').textContent; $('mEtaClock').textContent = $('etaClock').textContent;
    if (remain < 25) {
      arrived = true; CD.speak('Vous êtes arrivé à destination');
      setTimeout(function () { stopGuidance(false); }, 4000);
    }
  }
  function reroute() {
    if (Date.now() - lastReroute < 15000 || !route) return;
    lastReroute = Date.now(); offCount = 0; CD.speak('Recalcul de l’itinéraire');
    fetchBest({ lat: S.lat, lon: S.lon }, route.dest).then(function (list) {
      var r = list[0];
      route = r; idx = 0; said = {}; drawRoute('mini'); drawRoute('main');
    }).catch(function () {});
  }

  // ====================== INTERFACE CARTE ======================
  var uiState = 'idle';
  function ui(state) {
    uiState = state;
    $('searchPanel').classList.toggle('hidden', state === 'guide');
    $('routePanel').classList.toggle('hidden', state !== 'route');
    $('recentsBox').classList.add('hidden');
    $('results').parentNode.classList.add('hidden');
    if (state !== 'idle' && state !== 'results') $('searchMsg').classList.add('hidden');
    $('banner').classList.toggle('hidden', state !== 'guide');
    $('etaBar').classList.toggle('hidden', state !== 'guide');
    $('miniBanner').classList.toggle('hidden', state !== 'guide');
    $('miniEta').classList.toggle('hidden', state !== 'guide');
  }
  // un seul panneau ouvert a la fois : recents, suggestions ou rien
  function sheet(mode) {
    if (uiState === 'guide') return;
    $('recentsBox').classList.toggle('hidden', mode !== 'recent');
    $('results').parentNode.classList.toggle('hidden', mode !== 'results');
    $('routePanel').classList.toggle('hidden', mode !== 'none' || uiState !== 'route');
    if (mode !== 'none') $('searchMsg').classList.add('hidden');
  }
  function msg(t) { var m = $('searchMsg'); m.textContent = t; m.classList.toggle('hidden', !t); }

  function recents() { return CD.store.get('recents', []); }
  function addRecent(d) {
    var l = recents().filter(function (x) { return x.label !== d.label; });
    l.unshift({ label: d.label, lat: d.lat, lon: d.lon }); CD.store.set('recents', l.slice(0, 6)); renderRecents();
  }
  var ICONS = {
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    road: '<svg viewBox="0 0 24 24"><path d="M8 3L5 21M16 3l3 18M12 4v3M12 10v4M12 17v3"/></svg>',
    fuel: '<svg viewBox="0 0 24 24"><path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M4 20h11M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h5"/></svg>',
    train: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M9 21l2-4M15 21l-2-4M6 12h12"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>'
  };
  function kindIcon(k) {
    if (/fuel/.test(k)) return ICONS.fuel;
    if (/railway|station|subway|tram|bus/.test(k)) return ICONS.train;
    if (/^highway|house|street/.test(k)) return ICONS.road;
    return ICONS.pin;
  }
  function sugRow(d, icon, hl) {
    var li = document.createElement('li');
    li.className = 'sug' + (hl ? ' hl' : '');
    li.innerHTML = '<span class="ic">' + icon + '</span><span class="tx"><span class="t1"></span><span class="t2"></span></span><span class="dist"></span>';
    li.querySelector('.t1').textContent = d.label;
    li.querySelector('.t2').textContent = d.sub || '';
    li.querySelector('.dist').textContent = d.dist != null ? CD.fmtDist(d.dist) : '';
    return li;
  }
  function renderRecents() {
    var ul = $('recents'); ul.innerHTML = '';
    var l = recents().slice(0, 4);
    $('recLabel').classList.toggle('hidden', !l.length);
    l.forEach(function (d) {
      var li = sugRow(d, ICONS.clock, false);
      li.onclick = function () { pick(d); };
      ul.appendChild(li);
    });
  }

  // ---------- suggestions a chaque touche (Photon, base OpenStreetMap) ----------
  var sug = [], sugHL = 0, sugSeq = 0, sugTimer = null, sugPin = null, sugPinKey = '';
  function parsePhoton(j) {
    var seen = {}, out = [];
    (j.features || []).forEach(function (f) {
      var p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
      if (!c) return;
      var street = p.street ? ((p.housenumber ? p.housenumber + ' ' : '') + p.street) : '';
      var label = p.name || street || p.city || '';
      if (!label) return;
      var city = p.city || p.town || p.village || p.county || '';
      var loc = [p.postcode, city].filter(Boolean).join(' ');
      var sub = [p.name && street ? street : '', loc].filter(Boolean).join(', ');
      var key = label.toLowerCase() + '|' + (p.postcode || city);
      var stop = /^(bus_stop|stop|tram_stop|platform|stop_position)$/.test(p.osm_value || '');
      if (seen[key] || (stop && out.length)) return;
      seen[key] = 1;
      var d = { label: label, sub: sub, lat: c[1], lon: c[0], kind: (p.osm_key || '') + ':' + (p.osm_value || '') };
      d.dist = CD.dist(S, d);
      out.push(d);
    });
    return out.slice(0, 6);
  }
  function renderSug() {
    var ul = $('results'); ul.innerHTML = '';
    sug.forEach(function (d, i) {
      var li = sugRow(d, kindIcon(d.kind || ''), i === sugHL);
      li.onclick = function () { pick(d); };
      li.onmouseenter = function () { setHL(i); };
      ul.appendChild(li);
    });
    if (sug.length) { sheet('results'); showSugPin(sug[sugHL]); } else sheet('none');
  }
  function setHL(i) {
    if (i === sugHL || !sug.length) return;
    sugHL = i;
    CD.qsa('#results .sug').forEach(function (e, k) { e.classList.toggle('hl', k === sugHL); });
    showSugPin(sug[sugHL]);
  }
  function showSugPin(d) {
    var m = maps.main, key = d.lat + ',' + d.lon;
    if (!m || !mainVisible || sugPinKey === key) return;
    sugPinKey = key;
    if (sugPin) sugPin.remove();
    var el = document.createElement('div'); el.className = 'sugpin';
    sugPin = new ML.Marker({ element: el }).setLngLat([d.lon, d.lat]).addTo(m);
    follow = false; $('btnRecenter').classList.remove('on');
    m.stop(); m.easeTo({ center: [d.lon, d.lat], zoom: Math.max(13.5, Math.min(m.getZoom(), 16)), bearing: 0, pitch: 0, offset: [0, -80], duration: 550 });
  }
  function removeSugPin() { if (sugPin) { sugPin.remove(); sugPin = null; } sugPinKey = ''; }
  var sugCache = {};
  function suggest(q) {
    clearTimeout(sugTimer);
    var ck = q.toLowerCase();
    if (sugCache[ck]) {           // deja demande : pas de nouvelle requete
      ++sugSeq; sug = sugCache[ck].map(function (d) { d.dist = CD.dist(S, d); return d; }); sugHL = 0; sugPinKey = '';
      msg(sug.length ? '' : 'Aucun résultat pour « ' + q + ' »'); renderSug(); return;
    }
    sugTimer = setTimeout(function () {
      var my = ++sugSeq;
      fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=10&lang=fr&lat=' + S.lat.toFixed(4) + '&lon=' + S.lon.toFixed(4))
        .then(function (r) { if (r.status === 429) { var e = new Error('limite'); e.limit = true; throw e; } if (!r.ok) throw new Error('photon'); return r.json(); })
        .then(function (j) {
          if (my !== sugSeq) return;
          sug = parsePhoton(j); sugHL = 0; sugPinKey = '';
          var keys = Object.keys(sugCache); if (keys.length > 40) delete sugCache[keys[0]]; sugCache[ck] = sug.slice();
          renderSug();
          msg(sug.length ? '' : 'Aucun résultat pour « ' + q + ' »');
          if (!sug.length) removeSugPin();
        }).catch(function (e) { if (my === sugSeq) msg(e && e.limit ? 'Trop de recherches d’un coup : patiente quelques secondes' : 'Suggestions indisponibles : appuie sur Entrée pour chercher'); });
    }, 180);
  }
  function pick(d) {
    sug = []; sugSeq++; clearTimeout(sugTimer); removeSugPin();
    $('searchInput').value = d.label; $('searchClear').classList.remove('hidden');
    $('searchInput').blur(); sheet('none');
    chooseDest({ label: d.label, sub: d.sub, lat: d.lat, lon: d.lon });
  }
  function enterSearch(q) {      // secours : une seule recherche classique si aucune suggestion
    msg('Recherche…'); $('searchMsg').classList.remove('hidden');
    CD.geocode(q).then(function (r) { pick({ label: r.label, sub: '', lat: r.lat, lon: r.lon }); })
      .catch(function () { msg('Aucun résultat. Essaie avec la ville.'); });
  }
  function openForInput() {
    if (uiState === 'guide') return;
    var q = $('searchInput').value.trim();
    if (q.length >= 2 && sug.length) sheet('results');
    else if (q.length >= 2) suggest(q);
    else { renderRecents(); renderPlaces(); sheet('recent'); }
  }
  function closeSheetSoon() {
    setTimeout(function () {
      if (document.activeElement === $('searchInput')) return;
      sheet('none'); removeSugPin();
    }, 120);
  }

  CD.geocode = function (q) {
    return fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fr&q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); }).then(function (l) {
        if (!l.length) throw new Error('none');
        return { lat: parseFloat(l[0].lat), lon: parseFloat(l[0].lon), label: l[0].display_name.split(',').slice(0, 2).join(',').trim() };
      });
  };

  function chooseDest(d) {
    $('searchInput').blur(); removeSugPin();
    if (d.label) { $('searchInput').value = d.label; $('searchClear').classList.remove('hidden'); }
    msg('Calcul de l’itinéraire…'); $('searchMsg').classList.remove('hidden');
    fetchBest({ lat: S.lat, lon: S.lon }, d).then(function (list) {
      alts = list; route = list[0]; idx = 0; sim.s = 0; said = {}; arrived = false;
      msg(''); ui('route'); updatePreview(); renderAlts();
      drawRoute('main'); drawRoute('mini');
      fitRoute(route);
      follow = false; $('btnRecenter').classList.remove('on');
      addRecent(d);
    }).catch(function () { route = null; alts = []; ui('results'); msg('Itinéraire impossible (pas de route ou pas de connexion).'); });
  }
  function cancelRoute() { route = null; alts = []; renderAlts(); drawRoute('main'); drawRoute('mini'); ui('idle'); msg(''); }

  function startGuidance() {
    if (!route) return;
    alts = []; renderAlts(); drawRoute('main'); drawRoute('mini'); fastLast = Date.now();
    guiding = true; arrived = false; said = {}; idx = 0; sim.s = 0; offCount = 0;
    if (S.mode === 'demo') { var p = pointAt(0); S.lat = p.lat; S.lon = p.lon; S.heading = p.hdg; S.speed = 0; }
    ui('guide'); follow = true; $('btnRecenter').classList.add('on');
    var m = ensureMap('main'); m.stop(); m.jumpTo({ center: [S.lon, S.lat], zoom: 17, bearing: S.heading });
    if (maps.mini) { maps.mini.stop(); maps.mini.jumpTo({ center: [S.lon, S.lat], zoom: 16.2, bearing: S.heading }); }
    var info = stepInfo(0), txt = info.next ? stepText(info.next) : 'Continuez';
    CD.speak('Itinéraire lancé. Dans ' + CD.fmtSpoken(info.dNext) + ', ' + txt);
    said[info.k + 'a'] = 1;
    updateGuidance();
  }
  function stopGuidance(silent) {
    hideFast(); fastLast = 0;
    guiding = false; arrived = false; route = null; alts = []; renderLanes(null, false); $('bnThen').textContent = '';
    drawRoute('main'); drawRoute('mini'); ui('idle');
    if (!silent) CD.toast('Navigation terminée');
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }

  // ====================== LIMITE DE VITESSE ET ZONES DE DANGER (donnees OpenStreetMap, via Overpass) ======================
  var OVPS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  var ovpGood = 0;
  function ovp(q) {
    // on essaie les serveurs publics a tour de role (certains sont souvent surcharges), 8 s maximum chacun
    var tries = 0;
    function next() {
      if (tries >= OVPS.length) return Promise.reject(new Error('overpass indisponible'));
      var i = (ovpGood + tries) % OVPS.length; tries++;
      var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 8000);
      return fetch(OVPS[i] + '?data=' + encodeURIComponent(q), { signal: ctl.signal })
        .then(function (r) { clearTimeout(to); if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) { ovpGood = i; return j; })
        .catch(function () { clearTimeout(to); return next(); });
    }
    return next();
  }
  function parseMax(v) {
    if (!v) return null;
    v = String(v).trim();
    if (/^\d+$/.test(v)) return +v;
    var named = { 'FR:urban': 50, 'FR:rural': 80, 'FR:motorway': 130, 'FR:trunk': 110 };
    if (named[v]) return named[v];
    var m = v.match(/^(\d+)\s*km\/h$/);
    return m ? +m[1] : null;
  }
  var limPos = null, limBusy = false, limBackoff = 0, limLast = 0;
  function limitTick() {
    if (!ST.autoLimit || limBusy || Date.now() < limBackoff) return;
    var now = Date.now();
    if (now - limLast < 6000) return;
    if (limPos && CD.dist(S, limPos) < 30 && now - limLast < 30000) return;
    limBusy = true; limLast = now; limPos = { lat: S.lat, lon: S.lon };
    var q = '[out:json][timeout:10];way(around:20,' + S.lat.toFixed(6) + ',' + S.lon.toFixed(6) +
      ')["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out tags geom;';
    ovp(q).then(function (j) {
      var best = null, bd = 1e9;
      (j.elements || []).forEach(function (w) {
        if (!w.geometry || w.geometry.length < 2) return;
        for (var i = 0; i < w.geometry.length - 1; i++) {
          var a = w.geometry[i], b = w.geometry[i + 1];
          var r = projectSeg(S, [a.lat, a.lon], [b.lat, b.lon]);
          if (r.d < bd) { bd = r.d; best = w; }
        }
      });
      var v = best && best.tags ? parseMax(best.tags.maxspeed) : null;
      if (v !== S.limit) { S.limit = v; CD.emit('limit', v); }
    }).catch(function () { limBackoff = Date.now() + 30000; }).then(function () { limBusy = false; });
  }

  var cams = [], camPos = null, camBusy = false, camWarned = {}, zoneTimer = null, camLast = 0;
  function zoneAlert() {
    CD.qsa('.zone').forEach(function (e) { e.classList.remove('hidden'); });
    CD.speak('Zone de danger');
    clearTimeout(zoneTimer);
    zoneTimer = setTimeout(function () { CD.qsa('.zone').forEach(function (e) { e.classList.add('hidden'); }); }, 9000);
  }
  function angDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
  function camsTick() {
    if (!ST.dangerZones) return;
    var now = Date.now();
    if (!camBusy && now - camLast > 15000 && (!camPos || CD.dist(S, camPos) > 1200)) {
      camBusy = true; camLast = now; camPos = { lat: S.lat, lon: S.lon };
      ovp('[out:json][timeout:15];node(around:3000,' + S.lat.toFixed(6) + ',' + S.lon.toFixed(6) + ')["highway"="speed_camera"];out;')
        .then(function (j) { cams = (j.elements || []).map(function (e) { return { id: e.id, lat: e.lat, lon: e.lon }; }); })
        .catch(function () {}).then(function () { camBusy = false; });
    }
    // alerte generique : pas de position, pas de distance
    cams.forEach(function (c) {
      var d = CD.dist(S, c);
      if (d > 1000) { delete camWarned[c.id]; return; }
      if (camWarned[c.id] || d > 600) return;
      var ahead = S.speed < 8 || angDiff(CD.bearing(S, c), S.heading) < 55;
      if (ahead) { camWarned[c.id] = 1; zoneAlert(); }
    });
  }

  // ====================== CIRCULATION (calque optionnel, cle TomTom fournie par l'utilisateur) ======================
  function applyTraffic() {
    ['mini', 'main'].forEach(function (k) {
      var m = maps[k];
      if (!m || !ready[k]) return;
      if (m.getLayer('traffic')) m.removeLayer('traffic');
      if (m.getSource('traffic')) m.removeSource('traffic');
      if (ST.trafficOn && ST.trafficKey) {
        m.addSource('traffic', { type: 'raster', tileSize: 256, maxzoom: 18,
          tiles: ['https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=dark&tileSize=256&key=' + encodeURIComponent(ST.trafficKey)] });
        m.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', paint: { 'raster-opacity': 0.9 } }, 'route-case');
      }
    });
  }

  // ====================== METEO (Open-Meteo, sans cle) ======================
  var wx = { t: 0, lat: 0, lon: 0 };
  var WX = [[0, 'Dégagé'], [2, 'Peu nuageux'], [3, 'Couvert'], [48, 'Brouillard'], [57, 'Bruine'], [67, 'Pluie'], [77, 'Neige'], [82, 'Averses'], [86, 'Averses de neige'], [99, 'Orage']];
  function wxLabel(code) {
    for (var i = 0; i < WX.length; i++) if (code <= WX[i][0]) return WX[i][1];
    return '';
  }
  function wxTick() {
    var now = Date.now();
    if (now - wx.t < 600000 && CD.dist(S, { lat: wx.lat, lon: wx.lon }) < 5000) return;
    wx.t = now; wx.lat = S.lat; wx.lon = S.lon;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + S.lat.toFixed(4) + '&longitude=' + S.lon.toFixed(4) + '&current=temperature_2m,weather_code,is_day,cloud_cover,wind_speed_10m&daily=sunrise,sunset&forecast_days=1&timezone=auto')
      .then(function (r) { return r.json(); }).then(function (j) {
        var c = j.current;
        if (!c) return;
        var t = Math.round(c.temperature_2m), txt = t + '° · ' + wxLabel(c.weather_code);
        CD.state.weather = { code: c.weather_code, temp: c.temperature_2m, isDay: c.is_day === 1, clouds: c.cloud_cover, wind: c.wind_speed_10m,
          sunrise: j.daily && j.daily.sunrise && j.daily.sunrise[0], sunset: j.daily && j.daily.sunset && j.daily.sunset[0] };
        CD.emit('weather');
        if (t <= 2 && c.weather_code >= 51) txt += ' · risque de verglas';
        CD.qsa('[data-wx]').forEach(function (e) { e.textContent = txt; e.classList.remove('hidden'); });
      }).catch(function () {});
  }

  // ====================== POINTS D'INTERET : stations-service, parkings, recharge (OpenStreetMap) ======================
  var POIQ = { fuel: '["amenity"="fuel"]', parking: '["amenity"="parking"]["access"!~"private|customers|permit"]', charging: '["amenity"="charging_station"]' };
  var POIN = { fuel: 'Station-service', parking: 'Parking', charging: 'Borne de recharge' };
  var POISVG = {
    fuel: '<svg viewBox="0 0 24 24"><path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M4 20h11M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h5"/></svg>',
    parking: '<b>P</b>',
    charging: '<svg viewBox="0 0 24 24"><path d="M13 3L6 14h5l-1 7 7-11h-5z"/></svg>'
  };
  var poiMk = [], poiTimer = null, poiBusy = false, poiLast = null;
  function clearPoi() { poiMk.forEach(function (m) { m.remove(); }); poiMk = []; }
  function poiKind(t) { return t.amenity === 'fuel' ? 'fuel' : t.amenity === 'charging_station' ? 'charging' : 'parking'; }
  function poiRefresh(force) {
    var m = maps.main;
    if (!m || !ready.main || !mainVisible) return;
    var kinds = Object.keys(POIQ).filter(function (k) { return ST.poi && ST.poi[k]; });
    if (!kinds.length) { clearPoi(); poiLast = null; return; }
    if (m.getZoom() < 13.5) { clearPoi(); poiLast = null; if (force) CD.toast('Zoome pour voir les lieux'); return; }
    var c = m.getCenter();
    if (!force && poiLast && Math.abs(poiLast.z - m.getZoom()) < 0.6 && CD.dist({ lat: c.lat, lon: c.lng }, poiLast) < 250 && poiLast.k === kinds.join()) return;
    if (poiBusy) return;
    poiBusy = true; poiLast = { lat: c.lat, lon: c.lng, z: m.getZoom(), k: kinds.join() };
    var b = m.getBounds(), bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (x) { return x.toFixed(5); }).join(',');
    var q = '[out:json][timeout:12];(' + kinds.map(function (k) { return 'nwr' + POIQ[k] + '(' + bb + ');'; }).join('') + ');out center 120;';
    ovp(q).then(function (j) {
      clearPoi();
      (j.elements || []).forEach(function (e) {
        var lat = e.lat != null ? e.lat : (e.center && e.center.lat), lon = e.lon != null ? e.lon : (e.center && e.center.lon);
        if (lat == null || !e.tags) return;
        var k = poiKind(e.tags), name = e.tags.name || e.tags.brand || e.tags.operator || POIN[k];
        var el = document.createElement('div'); el.className = 'poi poi-' + k; el.innerHTML = POISVG[k]; el.title = name;
        el.addEventListener('click', function (ev) { ev.stopPropagation(); chooseDest({ label: name, sub: POIN[k], lat: lat, lon: lon }); });
        poiMk.push(new ML.Marker({ element: el }).setLngLat([lon, lat]).addTo(m));
      });
    }).catch(function () { CD.toast('Lieux indisponibles pour le moment'); }).then(function () { poiBusy = false; });
  }
  function poiSoon() { clearTimeout(poiTimer); poiTimer = setTimeout(function () { poiRefresh(false); }, 700); }

  // ====================== LIEUX ENREGISTRES : domicile, travail, favoris ======================
  function places() { return CD.store.get('places', { home: null, work: null, list: [] }); }
  function savePlaces(p) { CD.store.set('places', p); renderPlaces(); }
  function renderPlaces() {
    var p = places();
    $('chipHome').classList.toggle('dim', !p.home); $('chipWork').classList.toggle('dim', !p.work);
    var ul = $('favPlaces'); ul.innerHTML = '';
    p.list.slice(0, 4).forEach(function (d, i) {
      var li = sugRow(d, ICONS.star, false);
      li.onclick = function () { pick(d); };
      var rm = CD.el('button', { class: 'btn small', text: 'Retirer', onclick: function (e) { e.stopPropagation(); var q = places(); q.list.splice(i, 1); savePlaces(q); } });
      li.querySelector('.dist').replaceWith(rm);
      ul.appendChild(li);
    });
  }
  function currentDest() { return route ? { label: route.dest.label, lat: route.dest.lat, lon: route.dest.lon } : null; }

  // ====================== INCIDENTS : accidents, travaux, routes fermees (TomTom, cle de l'utilisateur) ======================
  var INC_FR = { accident: 'Accident', jam: 'Bouchon', roadWorks: 'Travaux', roadClosed: 'Route fermée', laneClosed: 'Voie fermée', ice: 'Verglas', fog: 'Brouillard',
    rain: 'Forte pluie', wind: 'Vent fort', flooding: 'Inondation', brokenDownVehicle: 'Véhicule en panne', dangerousConditions: 'Conditions dangereuses', unknown: 'Incident' };
  var INC_SVG = {
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    closed: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M7 12h10"/></svg>',
    works: '<svg viewBox="0 0 24 24"><path d="M4 20h16M6 20l2-9h8l2 9M9 11V7h6v4"/></svg>',
    jam: '<svg viewBox="0 0 24 24"><path d="M4 8h16M4 12h16M4 16h10"/></svg>'
  };
  var incs = [], incMk = [], incBusy = false, incLast = 0, incPos = null, incWarned = {};
  function incKind(cat) { return (cat === 'roadClosed' || cat === 'laneClosed') ? 'closed' : cat === 'roadWorks' ? 'works' : cat === 'jam' ? 'jam' : 'warn'; }
  function parseIncidents(j) {
    return (j.incidents || []).map(function (it, i) {
      var g = it.geometry || {}, co = g.type === 'Point' ? g.coordinates : (g.coordinates && g.coordinates[0]);
      if (!co) return null;
      var p = it.properties || {};
      return { id: p.id || ('i' + i + '_' + co[0]), lon: co[0], lat: co[1], cat: p.iconCategory || 'unknown', from: p.from, to: p.to, delay: p.delayInSeconds,
        desc: (p.events && p.events[0] && p.events[0].description) || '' };
    }).filter(Boolean);
  }
  function drawIncs() {
    incMk.forEach(function (m) { m.remove(); }); incMk = [];
    var m = maps.main;
    if (!m || !ST.incidentsOn) return;
    var z = m.getZoom();
    incs.filter(function (it) { return z >= 14 || (z >= 12 && (it.cat === 'accident' || it.cat === 'jam' || it.cat === 'dangerousConditions' || it.cat === 'brokenDownVehicle')); })
      .slice(0, 250).forEach(function (it) {
      var el = document.createElement('div'); el.className = 'inc inc-' + incKind(it.cat); el.innerHTML = INC_SVG[incKind(it.cat)];
      el.title = INC_FR[it.cat] || 'Incident';
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var where = it.from ? (' : ' + it.from + (it.to ? ' → ' + it.to : '')) : '';
        CD.toast((INC_FR[it.cat] || 'Incident') + where + (it.delay > 60 ? ' · retard ' + CD.fmtDur(it.delay) : ''));
      });
      incMk.push(new ML.Marker({ element: el }).setLngLat([it.lon, it.lat]).addTo(m));
    });
  }
  function incFetch(c) {
    if (!ST.incidentsOn || !ST.trafficKey || incBusy) return Promise.resolve();
    incBusy = true; incLast = Date.now(); incPos = { lat: c.lat, lon: c.lon };
    var d = 0.06, kx = d / Math.cos(CD.rad(c.lat));
    var bbox = [c.lon - kx, c.lat - d, c.lon + kx, c.lat + d].map(function (x) { return x.toFixed(5); }).join(',');
    var base = 'https://api.tomtom.com/maps/orbis/traffic/incidents/details?apiVersion=2&timeValidity=present&bbox=' + bbox;
    var attrs = 'incidents(type,geometry(type,coordinates),properties(id,iconCategory,magnitudeOfDelay,from,to,delayInSeconds,events(description)))';
    function ok(r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }
    return fetch(base, { headers: { 'TomTom-Api-Key': ST.trafficKey, 'Attributes': attrs } }).then(ok)
      .catch(function () { return fetch(base + '&key=' + encodeURIComponent(ST.trafficKey)).then(ok); })
      .then(function (j) { incs = parseIncidents(j); drawIncs(); })
      .catch(function () { CD.toast('Incidents indisponibles (clé ou connexion)'); })
      .then(function () { incBusy = false; });
  }
  function nearRoute(p) {
    var best = 1e9, i0 = Math.max(0, idx - 2), i1 = Math.min(route.coords.length - 2, idx + 400), i;
    for (i = i0; i <= i1; i += 2) {
      var r = projectSeg(p, route.coords[i], route.coords[i + 1]);
      if (r.d < best) best = r.d;
      if (best < 30) break;
    }
    return best < 80;
  }
  function incTick() {
    if (!ST.incidentsOn || !ST.trafficKey) return;
    var now = Date.now();
    if (!incBusy && (now - incLast > 90000 || (incPos && CD.dist(S, incPos) > 3000))) incFetch(S);
    var QUIET = { roadWorks: 1, laneClosed: 1 };
    incs.forEach(function (it) {
      var d = CD.dist(S, it);
      if (d > 2500) { delete incWarned[it.id]; return; }
      if (incWarned[it.id] || d > 1500 || it.cat === 'jam' && d > 800) return;
      if (guiding && route ? !nearRoute(it) : QUIET[it.cat]) return;
      var ahead = S.speed < 8 || angDiff(CD.bearing(S, it), S.heading) < 40;
      if (!ahead) return;
      incWarned[it.id] = 1;
      var label = INC_FR[it.cat] || 'Incident';
      CD.speak(label + ' dans ' + CD.fmtSpoken(d)); CD.toast(label + ' devant');
    });
  }

  // ====================== TRAJET AVEC TRAFIC (TomTom Routing API Orbis + guidage OSRM) ======================
  var JAMCOL = { 1: '#ffd24a', 2: '#ff9a3c', 3: '#ff4d4d', 4: '#b3122a' };
  function ttOk(r) { if (!r.ok) throw new Error('tomtom ' + r.status); return r.json(); }
  function parseTT(r, to) {
    var pts = [];
    (r.legs || []).forEach(function (l) { (l.points || []).forEach(function (p) { pts.push([p.latitude, p.longitude]); }); });
    if (pts.length < 2) return null;
    var cum = [0], i;
    for (i = 1; i < pts.length; i++) cum.push(cum[i - 1] + CD.dist({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] }));
    var sm = r.summary || {};
    var jams = (r.sections || []).filter(function (x) { return x.sectionType === 'TRAFFIC' && x.magnitudeOfDelay >= 1; }).map(function (x) {
      return { a: x.startPointIndex, b: x.endPointIndex, mag: x.magnitudeOfDelay, delay: x.delayInSeconds || 0, cat: x.simpleCategory };
    });
    return { coords: pts, ll: pts.map(function (p) { return [p[1], p[0]]; }), cum: cum, total: cum[cum.length - 1] || 1,
      duration: sm.travelTimeInSeconds, distance: sm.lengthInMeters || cum[cum.length - 1], delay: sm.trafficDelayInSeconds || 0, jams: jams, steps: [], dest: to, traffic: true };
  }
  function ttRoutes(from, to) {
    var url = 'https://api.tomtom.com/maps/orbis/routing/calculateRoute/' + from.lat.toFixed(6) + ',' + from.lon.toFixed(6) + ':' + to.lat.toFixed(6) + ',' + to.lon.toFixed(6) +
      '/json?apiVersion=2&traffic=live&sectionType=traffic&maxAlternatives=2&routeType=fast&travelMode=car&key=' + encodeURIComponent(ST.trafficKey);
    return fetch(url).then(ttOk).then(function (j) {
      return (j.routes || []).map(function (r) { return parseTT(r, to); }).filter(function (r) { return r && r.duration != null; });
    });
  }
  // consignes de guidage : OSRM suit le trace TomTom grace a ~70 points de passage ; les arrivees/departs intermediaires sont fusionnes
  function matchSteps(tt) {
    var n = tt.coords.length, pick = [], step = tt.total / 68, next = 0, i;
    for (i = 0; i < n; i++) { if (i === 0 || i === n - 1 || tt.cum[i] >= next) { pick.push(i); next = tt.cum[i] + step; } }
    var coords = pick.map(function (k) { return tt.ll[k][0].toFixed(6) + ',' + tt.ll[k][1].toFixed(6); }).join(';');
    return fetch(OSRM + coords + '?overview=false&steps=true&continue_straight=true')
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j.routes || !j.routes.length) throw new Error('pas de route');
        var mt = j.routes[0], legs = mt.legs, steps = [], acc = 0, tot = mt.distance || 1, li, si;
        if (Math.abs(tot - tt.total) / tt.total > 0.2) throw new Error('ecart trop grand');
        for (li = 0; li < legs.length; li++) {
          for (si = 0; si < legs[li].steps.length; si++) {
            var s = legs[li].steps[si], t = s.maneuver.type;
            acc += s.distance;
            var isViaDepart = t === 'depart' && !(li === 0 && si === 0), isViaArrive = t === 'arrive' && !(li === legs.length - 1 && si === legs[li].steps.length - 1);
            var end = Math.min(tt.total, acc / tot * tt.total);
            if ((isViaDepart || isViaArrive) && steps.length) { steps[steps.length - 1].endCum = end; continue; }
            var ln = s.intersections && s.intersections[0] && s.intersections[0].lanes;
            steps.push({ m: s.maneuver, name: s.name || '', lanes: ln && ln.length > 1 ? ln : null, endCum: end });
          }
        }
        if (steps.length < 2) throw new Error('match vide');
        steps[steps.length - 1].endCum = tt.total;
        return steps;
      });
  }
  function nearestOsrm(tt, list) {
    var best = list[0], bd = 1e12;
    list.forEach(function (o) {
      var sum = 0, k;
      for (k = 1; k <= 8; k++) {
        var p = tt.coords[Math.floor((tt.coords.length - 1) * k / 9)], d = 1e12, j;
        for (j = 0; j < o.coords.length; j += 3) d = Math.min(d, CD.dist({ lat: p[0], lon: p[1] }, { lat: o.coords[j][0], lon: o.coords[j][1] }));
        sum += d;
      }
      if (sum < bd) { bd = sum; best = o; }
    });
    return best;
  }
  function attachSteps(tt, osrmList) {
    return matchSteps(tt).then(function (steps) { tt.steps = steps; tt.guidance = 'match'; return tt; }).catch(function () {
      var o = nearestOsrm(tt, osrmList);
      tt.steps = o.steps.map(function (s) { return { m: s.m, name: s.name, lanes: s.lanes, endCum: s.endCum / o.total * tt.total }; });
      tt.guidance = 'approx'; return tt;
    });
  }
  function fetchBest(from, to) {
    var osrm = fetchRoutes(from, to);
    if (!(ST.trafficKey && ST.trafficRoute)) return osrm;
    return osrm.then(function (list) {
      return ttRoutes(from, to).then(function (tt) {
        if (!tt.length) return list;
        return Promise.all(tt.slice(0, 3).map(function (r) { return attachSteps(r, list); }));
      }).catch(function () { CD.toast('Trafic indisponible : itinéraire sans circulation'); return list; });
    });
  }
  function jamColor(j) {
    if (j.cat === 'ROAD_WORK') return '#ffb454';
    if (j.cat === 'ROAD_CLOSURE') return '#b3122a';
    return JAMCOL[j.mag] || JAMCOL[1];
  }
  function jamsGeo(r) {
    if (!r || !r.jams || !r.jams.length) return EMPTY;
    return { type: 'FeatureCollection', features: r.jams.map(function (j) {
      return { type: 'Feature', properties: { color: jamColor(j) }, geometry: { type: 'LineString', coordinates: r.ll.slice(j.a, j.b + 1) } };
    }) };
  }

  // ====================== ITINERAIRE PLUS RAPIDE EN ROULANT ======================
  var fastLast = 0, fastBusy = false, fastCand = null, fastTimer = null;
  function sampleRemaining(r, from, n) {
    var pts = [], total = r.coords.length - 1, k;
    for (k = 1; k <= n; k++) pts.push(r.coords[Math.min(total, from + Math.floor((total - from) * k / (n + 1)))]);
    return pts;
  }
  function pathDistance(pts, cand) {
    var sum = 0;
    pts.forEach(function (p) {
      var d = 1e12, j;
      for (j = 0; j < cand.coords.length; j += 3) d = Math.min(d, CD.dist({ lat: p[0], lon: p[1] }, { lat: cand.coords[j][0], lon: cand.coords[j][1] }));
      sum += d;
    });
    return sum;
  }
  function hideFast() { $('fastBanner').classList.add('hidden'); clearTimeout(fastTimer); fastCand = null; }
  function fastTick() {
    if (!guiding || !route || fastBusy || !ST.trafficKey || !ST.trafficRoute) return;
    var now = Date.now();
    if (now - fastLast < 240000) return;
    var prog = S.mode === 'demo' ? sim.s : (route.cum[idx] || 0), remain = route.total - prog;
    if (remain < 3000) return;
    fastLast = now; fastBusy = true;
    var cur = route, pts = sampleRemaining(cur, idx, 8), dest = cur.dest;
    fetchBest({ lat: S.lat, lon: S.lon }, dest).then(function (list) {
      if (!guiding || route !== cur || !list.length || !list[0].traffic) return;
      var same = list[0], sd = 1e18;
      list.forEach(function (c) { var d = pathDistance(pts, c); if (d < sd) { sd = d; same = c; } });
      // la duree de l'itineraire actuel est mise a jour avec la circulation du moment
      cur.duration = same.duration * cur.total / Math.max(1, remain); cur.delay = same.delay;
      var best = list.reduce(function (a, c) { return c.duration < a.duration ? c : a; }, list[0]);
      var gain = same.duration - best.duration;
      if (best !== same && gain >= 180) {
        fastCand = best;
        $('fastTxt').textContent = 'Itinéraire plus rapide : ' + Math.round(gain / 60) + ' min de moins';
        $('fastBanner').classList.remove('hidden');
        CD.speak('Un itinéraire plus rapide est disponible, ' + Math.round(gain / 60) + ' minutes de moins');
        clearTimeout(fastTimer); fastTimer = setTimeout(hideFast, 30000);
      }
    }).catch(function () {}).then(function () { fastBusy = false; });
  }
  function takeFast() {
    if (!fastCand) return;
    route = fastCand; alts = []; idx = 0; sim.s = 0; said = {}; offCount = 0; arrived = false;
    drawRoute('main'); drawRoute('mini'); hideFast(); CD.speak('Nouvel itinéraire');
    updateGuidance();
  }

  // ====================== LIAISONS ======================
  CD.nav = {
    maps: maps, dbgR: function () { return R; },
    onOption: function (k) { if (k === 'incidentsOn') { if (ST.incidentsOn) incFetch(S); else { incs = []; drawIncs(); } } },
    _testIncidents: function (j) { incs = parseIncidents(j); drawIncs(); },
    applyTraffic: applyTraffic,
    _fetchBest: function (a, b) { return fetchBest(a, b); },
    _state: function () { return { idx: idx, route: route, guiding: guiding, fastCand: fastCand }; },
    _forceFast: function () { fastLast = 0; },
    _testCam: function (lat, lon) { cams.push({ id: 'test' + Date.now(), lat: lat, lon: lon }); },
    isGuiding: function () { return guiding; },
    onShow: function (name) {
      mainVisible = name === 'map'; miniVisible = name === 'home'; R.hgt = {}; R.a = {};
      if (name === 'home') { ensureMap('mini'); setTimeout(function () { maps.mini.resize(); camera('mini', 0); }, 60); }
      if (name === 'map') {
        var m = ensureMap('main');
        setTimeout(function () { m.resize(); if (follow) camera('main', 0); }, 60);
      }
    },
    focusSearch: function () {}
  };

  document.addEventListener('DOMContentLoaded', function () {
    var inp = $('searchInput');
    inp.addEventListener('focus', openForInput);
    inp.addEventListener('blur', closeSheetSoon);
    inp.addEventListener('input', function () {
      var q = this.value.trim();
      $('searchClear').classList.toggle('hidden', !this.value);
      if (q.length < 2) { clearTimeout(sugTimer); sugSeq++; sug = []; removeSugPin(); msg(''); renderRecents(); renderPlaces(); sheet('recent'); return; }
      suggest(q);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && sug.length) { e.preventDefault(); setHL((sugHL + 1) % sug.length); }
      else if (e.key === 'ArrowUp' && sug.length) { e.preventDefault(); setHL((sugHL - 1 + sug.length) % sug.length); }
      else if (e.key === 'Enter') {
        var q = inp.value.trim();
        if (sug.length) pick(sug[sugHL]); else if (q) enterSearch(q);
      } else if (e.key === 'Escape') inp.blur();
    });
    $('searchClear').onclick = function () { inp.value = ''; this.classList.add('hidden'); sug = []; sugSeq++; removeSugPin(); msg(''); inp.focus(); renderRecents(); renderPlaces(); sheet('recent'); };
    // toucher le panneau ne doit pas fermer le clavier avant que le choix soit fait
    $('searchPanel').addEventListener('pointerdown', function (e) { if (e.target.closest('.sheet') || e.target.closest('.pclear')) e.preventDefault(); });
    $('btnStart').onclick = startGuidance;
    $('btnCancel').onclick = cancelRoute;
    $('btnStop').onclick = function () { stopGuidance(false); };
    $('fastYes').onclick = takeFast; $('fastNo').onclick = function () { fastLast = Date.now() + 240000; hideFast(); };
    $('zin').onclick = function () { ensureMap('main').zoomIn(); };
    $('zout').onclick = function () { ensureMap('main').zoomOut(); };
    $('btnRecenter').onclick = function () {
      follow = true; this.classList.add('on'); var m = ensureMap('main'); m.stop();
      m.easeTo({ center: [S.lon, S.lat], bearing: S.heading, zoom: Math.max(m.getZoom(), 16), offset: [0, m.getContainer().clientHeight * 0.2], duration: 500 });
    };
    var bv = $('btnVoice');
    function voiceLbl() { bv.textContent = ST.voiceOn ? 'Voix' : 'Muet'; bv.classList.toggle('on', ST.voiceOn); }
    bv.onclick = function () { ST.voiceOn = !ST.voiceOn; CD.saveSettings(); voiceLbl(); if (!ST.voiceOn) try { window.speechSynthesis.cancel(); } catch (e) {} CD.emit('settings'); };
    CD.on('settings', voiceLbl); voiceLbl();
    CD.qsa('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    // ---- panneau Calques ----
    function renderLayersPanel() {
      CD.qsa('[data-lay]').forEach(function (b) { b.classList.toggle('on', !!ST.layers[b.dataset.lay]); });
      CD.qsa('[data-opt]').forEach(function (b) { b.classList.toggle('on', !!ST[b.dataset.opt]); });
      CD.qsa('[data-poi]').forEach(function (b) { b.classList.toggle('on', !!(ST.poi && ST.poi[b.dataset.poi])); });
      CD.qsa('#themeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.th === ST.mapTheme); });
    }
    CD.nav.renderLayersPanel = renderLayersPanel;
    $('btnLayers').onclick = function () { $('layersPanel').classList.toggle('hidden'); this.classList.toggle('on', !$('layersPanel').classList.contains('hidden')); renderLayersPanel(); };
    CD.qsa('[data-lay]').forEach(function (b) {
      b.onclick = function () { ST.layers[b.dataset.lay] = !ST.layers[b.dataset.lay]; CD.saveSettings(); applyLayerVis(); renderLayersPanel(); };
    });
    CD.qsa('[data-opt]').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.opt;
        if ((k === 'trafficOn' || k === 'incidentsOn') && !ST[k] && !ST.trafficKey) { CD.toast('Colle d’abord ta clé TomTom dans Réglages'); return; }
        ST[k] = !ST[k]; CD.saveSettings();
        if (k === 'trafficOn') applyTraffic();
        if (k === 'tilt') { camera('main', 400); camera('mini', 400); }
        if (CD.nav.onOption) CD.nav.onOption(k);
        renderLayersPanel();
      };
    });
    CD.qsa('[data-poi]').forEach(function (b) {
      b.onclick = function () { ST.poi[b.dataset.poi] = !ST.poi[b.dataset.poi]; CD.saveSettings(); poiRefresh(true); renderLayersPanel(); };
    });
    CD.qsa('#themeSeg button').forEach(function (b) { b.onclick = function () { ST.mapTheme = b.dataset.th; CD.saveSettings(); applyPalette(); renderLayersPanel(); }; });
    renderLayersPanel();
    $('chipHome').onclick = function () { var p = places(); if (p.home) chooseDest(p.home); else CD.toast('Pas de domicile : lance un trajet, puis « Définir comme domicile »'); };
    $('chipWork').onclick = function () { var p = places(); if (p.work) chooseDest(p.work); else CD.toast('Pas de travail : lance un trajet, puis « Définir comme travail »'); };
    $('saveHome').onclick = function () { var d = currentDest(); if (!d) return; var p = places(); p.home = d; savePlaces(p); CD.toast('Domicile enregistré'); };
    $('saveWork').onclick = function () { var d = currentDest(); if (!d) return; var p = places(); p.work = d; savePlaces(p); CD.toast('Travail enregistré'); };
    $('saveFav').onclick = function () {
      var d = currentDest(); if (!d) return; var p = places();
      if (!p.list.some(function (x) { return x.label === d.label; })) p.list.push(d);
      savePlaces(p); CD.toast('Ajouté aux favoris');
    };
    renderPlaces();
    renderRecents(); ui('idle');
    ensureMap('mini');
    if (S.mode === 'gps') setMode('gps'); else { setStatus('Démo'); document.documentElement.classList.add('isdemo'); }
  });
})();
