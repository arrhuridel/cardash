/* Musique : radios en ligne (radio-browser.info) et fichiers audio de l'appareil */
(function () {
  'use strict';
  var CD = window.CD, $ = CD.$, ST = CD.settings;
  var audio, files = [], stations = [], favs = CD.store.get('favs', []);
  var cur = null;            // { kind:'radio'|'file', name, sub, url, list:'radio'|'favs'|'files' }
  var shuffle = false, ducked = false, tab = 'radio';
  var am = { mk: null, loading: null, results: [], playlists: [], timer: null, seq: 0 };
  var SERVERS = ['https://de1.api.radio-browser.info', 'https://fr1.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];
  var PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';

  function api(path) {
    var i = 0;
    function next() {
      if (i >= SERVERS.length) return Promise.reject(new Error('indisponible'));
      return fetch(SERVERS[i++] + path).then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); }).catch(next);
    }
    return next();
  }
  function fmt(t) { if (!isFinite(t)) return '0:00'; t = Math.floor(t); return Math.floor(t / 60) + ':' + CD.pad(t % 60); }
  function isFav(u) { return favs.some(function (f) { return f.url === u; }); }

  function setArt(url) {
    CD.qsa('.art').forEach(function (e) { e.style.backgroundImage = url ? 'url("' + url + '")' : ''; e.style.setProperty('--art', url ? 'url("' + url + '")' : 'none'); e.classList.toggle('img', !!url); });
  }
  function isApple() { return !!cur && cur.kind === 'apple'; }
  function setNow() {
    var t = cur ? cur.name : 'Rien en lecture', s = cur ? cur.sub : 'Choisis une source';
    CD.qsa('[data-np="title"]').forEach(function (e) { e.textContent = t; });
    CD.qsa('[data-np="sub"]').forEach(function (e) { e.textContent = s; });
    var playing = isApple() ? !!(am.mk && am.mk.isPlaying) : (audio && !audio.paused && !audio.ended);
    CD.qsa('[data-playicon] path').forEach(function (p) { p.setAttribute('d', playing ? PAUSE : PLAY); });
    $('btnFav').classList.toggle('on', !!cur && cur.kind === 'radio' && isFav(cur.url));
    $('btnShuffle').classList.toggle('on', shuffle);
    var live = !cur || cur.kind === 'radio';
    CD.qsa('.mprog').forEach(function (e) { e.style.visibility = live ? 'hidden' : 'visible'; });
    $('seek').disabled = live;
    if (live) { $('tDur').textContent = cur ? 'direct' : '0:00'; $('seek').value = 0; $('tCur').textContent = '0:00'; }
    var srcNow = !cur ? '' : cur.kind === 'radio' ? 'radio' : (cur.list && cur.list.indexOf('apple') === 0 ? 'apple' : 'files');
    $('s-music').dataset.now = srcNow;
    $('npSrc').textContent = { '': '', radio: 'En direct', apple: cur && cur.list === 'apple-full' ? '' : 'Extrait de 30 secondes', files: '' }[srcNow];
    setArt(cur && cur.art);
    if ('mediaSession' in navigator && cur) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: cur.name, artist: cur.sub, artwork: cur.art ? [{ src: cur.art, sizes: '300x300' }] : [] }); } catch (e) {}
    }
    renderAll();
  }
  function applyVol() {
    var v = ducked ? ST.volume / 100 * 0.3 : ST.volume / 100;
    if (audio) audio.volume = v;
    if (am.mk) { try { am.mk.volume = v; } catch (e) {} }
  }

  function stopApple() { if (am.mk && am.mk.isPlaying) { try { am.mk.pause(); } catch (e) {} } }
  function play(item) {
    stopApple();
    cur = item;
    audio.src = item.url;
    audio.volume = ducked ? ST.volume / 100 * 0.3 : ST.volume / 100;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { CD.toast('Lecture impossible : flux indisponible'); setNow(); });
    setNow();
  }
  function listFor(k) { return k === 'apple' ? am.results.filter(function (x) { return x.url; }) : k === 'files' ? files : k === 'favs' ? favs.map(favItem) : stations.map(stItem); }
  function stItem(s) { return { kind: 'radio', name: s.name.trim(), sub: (s.tags ? s.tags.split(',').slice(0, 2).join(', ') : 'Radio') || 'Radio', url: s.url_resolved || s.url, list: 'radio' }; }
  function favItem(f) { return { kind: 'radio', name: f.name, sub: f.sub, url: f.url, list: 'favs' }; }

  function step(dir) {
    if (!cur) return;
    if (isApple()) { try { dir > 0 ? am.mk.skipToNextItem() : am.mk.skipToPreviousItem(); } catch (e) {} return; }
    var l = listFor(cur.list), i = -1, k;
    for (k = 0; k < l.length; k++) if (l[k].url === cur.url) { i = k; break; }
    if (!l.length) return;
    var n = shuffle && cur.kind === 'file' ? Math.floor(Math.random() * l.length) : (i + dir + l.length) % l.length;
    play(l[n]);
  }
  function toggle() {
    if (!cur) {
      var l = files.length ? files : stations.map(stItem);
      if (l.length) play(l[0]); else CD.toast('Choisis d’abord une radio ou un fichier');
      return;
    }
    if (isApple()) { try { am.mk.isPlaying ? am.mk.pause() : am.mk.play(); } catch (e) {} return; }
    if (audio.paused) { var p = audio.play(); if (p && p.catch) p.catch(function () {}); } else audio.pause();
  }

  // ---- Listes ----
  function row(item, subtitle, extra) {
    var on = cur && cur.url === item.url;
    return CD.el('li', { class: 'li' + (on ? ' on' : ''), onclick: function () { play(item); } },
      CD.el('span', { class: 'lead ' + (item.kind === 'radio' ? 'radio' : 'file') }),
      CD.el('div', { class: 'lt', style: 'min-width:0' }, CD.el('div', { class: 't1', text: item.name }), CD.el('div', { class: 't2', text: subtitle })), extra || null);
  }
  function renderAll() {
    var ul = $('radioList'); ul.innerHTML = '';
    stations.forEach(function (s) {
      var it = stItem(s);
      ul.appendChild(row(it, it.sub + (s.bitrate ? ' · ' + s.bitrate + ' kb/s' : '')));
    });
    ul = $('favList'); ul.innerHTML = '';
    if (!favs.length) ul.appendChild(CD.el('li', { class: 'empty', text: 'Aucun favori. Lance une radio puis touche l’étoile.' }));
    favs.forEach(function (f) {
      var rm = CD.el('button', { class: 'btn small', text: 'Retirer', onclick: function (e) { e.stopPropagation(); favs = favs.filter(function (x) { return x.url !== f.url; }); CD.store.set('favs', favs); setNow(); } });
      ul.appendChild(row(favItem(f), f.sub, rm));
    });
    ul = $('fileList'); ul.innerHTML = '';
    if (!files.length) ul.appendChild(CD.el('li', { class: 'empty', text: 'Aucun fichier. Touche « Ajouter des fichiers audio ».' }));
    files.forEach(function (f) { ul.appendChild(row(f, 'Fichier')); });
  }

  function loadRadios(q) {
    $('radioMsg').textContent = 'Chargement des radios…';
    var path = '/json/stations/search?countrycode=FR&hidebroken=true&order=clickcount&reverse=true&limit=30' + (q ? '&name=' + encodeURIComponent(q) : '');
    api(path).then(function (l) {
      stations = l.filter(function (s) { return s.url_resolved || s.url; });
      $('radioMsg').textContent = stations.length ? '' : 'Aucune radio trouvée.';
      renderAll();
    }).catch(function () { $('radioMsg').textContent = 'Radios indisponibles : vérifie la connexion internet.'; });
  }

  function showTab(t) {
    tab = t;
    CD.qsa('.subtabs [data-mtab]').forEach(function (b) { b.classList.toggle('on', b.dataset.mtab === t); });
    var srcName = t === 'favs' ? 'radio' : t;
    $('s-music').dataset.src = srcName;
    CD.qsa('.src').forEach(function (b) { b.classList.toggle('on', b.dataset.src === srcName); });
    ['radio', 'favs', 'files', 'apple'].forEach(function (k) { $('mp-' + k).classList.toggle('hidden', k !== t); });
    if (t === 'radio' && !stations.length) loadRadios('');
    if (t === 'apple') amShow();
  }

  // ====================== APPLE MUSIC ======================
  // Sans jeton : extraits de 30 s via l'API publique d'iTunes. Avec jeton developpeur : MusicKit JS (morceaux entiers, abonnement requis).
  function amFull() { return !!(ST.appleToken && String(ST.appleToken).trim()); }
  function artUrl(a, n) { return a && a.url ? a.url.replace('{w}', n).replace('{h}', n) : ''; }
  function amMsg(t, btn) {
    var box = $('amState'); box.innerHTML = '';
    if (!t) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden'); box.appendChild(CD.el('div', { class: 'hint', text: t }));
    if (btn) box.appendChild(btn);
  }
  function loadMusicKit() {
    return new Promise(function (res, rej) {
      if (window.MusicKit) { res(window.MusicKit); return; }
      var done = false, to = setTimeout(function () { if (!done) rej(new Error('MusicKit ne répond pas')); }, 10000);
      function ok() { if (done || !window.MusicKit) return; done = true; clearTimeout(to); res(window.MusicKit); }
      document.addEventListener('musickitloaded', ok, { once: true });
      var sc = document.createElement('script'); sc.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'; sc.async = true;
      sc.onload = ok; sc.onerror = function () { clearTimeout(to); rej(new Error('MusicKit non chargé')); };
      document.head.appendChild(sc);
    });
  }
  function amInit() {
    if (am.mk) return Promise.resolve(am.mk);
    if (am.loading) return am.loading;
    am.loading = loadMusicKit().then(function (MK) {
      return Promise.resolve(MK.configure({ developerToken: String(ST.appleToken).trim(), app: { name: 'CarDash', build: '1.0' } })).then(function () {
        var mk = MK.getInstance();
        mk.addEventListener('playbackStateDidChange', function () { setNow(); });
        mk.addEventListener('mediaItemDidChange', function () {
          var it = mk.nowPlayingItem;
          if (it && isApple()) { cur.name = it.title || cur.name; cur.sub = it.artistName || cur.sub; cur.art = artUrl(it.artwork, 300) || cur.art; setNow(); }
        });
        am.mk = mk; applyVol(); return mk;
      });
    }).catch(function (e) { am.loading = null; throw e; });
    return am.loading;
  }
  function thumb(url) { var s = CD.el('span', { class: 'ic thumb' }); if (url) s.style.backgroundImage = 'url("' + url + '")'; return s; }
  function amRow(it, onclick) {
    var li = CD.el('li', { class: 'sug' + (cur && cur.name === it.name && cur.sub === it.sub ? ' hl' : '') }, thumb(it.art),
      CD.el('span', { class: 'tx' }, CD.el('span', { class: 't1', text: it.name }), CD.el('span', { class: 't2', text: it.sub || '' })),
      CD.el('span', { class: 'dist', text: it.tag || '' }));
    li.onclick = onclick; return li;
  }
  function amRender() {
    var ul = $('amList'); ul.innerHTML = '';
    am.results.forEach(function (it) { ul.appendChild(amRow(it, function () { it.url ? play(it) : amPlayFull(it); })); });
    var pl = $('amPlaylists'); pl.innerHTML = '';
    $('amPlLabel').classList.toggle('hidden', !am.playlists.length);
    am.playlists.forEach(function (it) { pl.appendChild(amRow(it, function () { amPlayFull(it); })); });
  }
  function amSearchPreview(q) {
    return fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&media=music&entity=song&limit=15&country=fr')
      .then(function (r) { return r.json(); }).then(function (j) {
        return (j.results || []).filter(function (r) { return r.previewUrl; }).map(function (r) {
          return { kind: 'file', list: 'apple', name: r.trackName, sub: r.artistName + (r.collectionName ? ' · ' + r.collectionName : ''),
            url: r.previewUrl, art: (r.artworkUrl100 || '').replace('100x100', '300x300'), tag: '30 s' };
        });
      });
  }
  function amSearchFull(q) {
    var sf = am.mk.storefrontId || 'fr';
    return am.mk.api.music('/v1/catalog/' + sf + '/search', { term: q, types: 'songs,albums,playlists', limit: 6 }).then(function (res) {
      var r = (res && res.data && res.data.results) || {}, out = [];
      function add(list, type, tag) {
        ((list && list.data) || []).forEach(function (x) {
          var a = x.attributes || {};
          out.push({ type: type, id: x.id, name: a.name, art: artUrl(a.artwork, 200), tag: tag,
            sub: type === 'playlist' ? (a.curatorName || 'Playlist') : (a.artistName || '') + (a.albumName ? ' · ' + a.albumName : '') });
        });
      }
      add(r.songs, 'song', 'Titre'); add(r.albums, 'album', 'Album'); add(r.playlists, 'playlist', 'Playlist');
      return out;
    });
  }
  function amRunSearch(q) {
    var my = ++am.seq;
    if (q.length < 2) { am.results = []; amRender(); return; }
    var p = amFull() && am.mk && am.mk.isAuthorized ? amSearchFull(q) : (amFull() ? Promise.reject(new Error('non connecté')) : amSearchPreview(q));
    p.then(function (list) { if (my !== am.seq) return; am.results = list; amRender(); if (!list.length) amMsg('Aucun résultat pour « ' + q + ' »'); else if (!amFull()) amMsg('Mode gratuit : extraits de 30 secondes. Colle ton jeton Apple Music dans Réglages pour les morceaux entiers.'); else amMsg(''); })
      .catch(function (e) { if (my === am.seq) amMsg('Recherche impossible : ' + ((e && e.message) || 'connexion')); });
  }
  function amLoadPlaylists() {
    if (!am.mk || !am.mk.isAuthorized) return;
    am.mk.api.music('/v1/me/library/playlists', { limit: 25 }).then(function (res) {
      am.playlists = ((res && res.data && res.data.data) || []).map(function (x) {
        var a = x.attributes || {};
        return { type: 'playlist', id: x.id, name: a.name || 'Playlist', sub: 'Ma playlist', art: artUrl(a.artwork, 200), tag: '' };
      });
      amRender();
    }).catch(function () {});
  }
  function amPlayFull(it) {
    if (!am.mk) return;
    audio.pause();
    var q = {}; q[it.type] = it.id;
    cur = { kind: 'apple', list: 'apple-full', name: it.name, sub: it.sub, art: it.art };
    setNow();
    Promise.resolve(am.mk.setQueue(q)).then(function () { return am.mk.play(); })
      .then(function () { setNow(); })
      .catch(function (e) { CD.toast('Lecture impossible : ' + ((e && e.message) || 'Apple Music')); });
  }
  function amConnect() {
    amMsg('Connexion à Apple Music…');
    amInit().then(function (mk) { return mk.isAuthorized ? mk : Promise.resolve(mk.authorize()).then(function () { return mk; }); })
      .then(function () { amMsg(''); amLoadPlaylists(); })
      .catch(function (e) { amMsg('Connexion impossible : ' + ((e && e.message) || 'jeton refusé ?'), CD.el('button', { class: 'btn', text: 'Réessayer', onclick: amConnect })); });
  }
  function amShow() {
    if (!amFull()) {
      amMsg('Mode gratuit : extraits de 30 secondes. Pour écouter les morceaux entiers, colle ton jeton Apple Music dans Réglages (abonnement Apple Music requis).');
      am.playlists = []; amRender(); return;
    }
    amMsg('Chargement d’Apple Music…');
    amInit().then(function (mk) {
      if (mk.isAuthorized) { amMsg(''); amLoadPlaylists(); }
      else amMsg('Connecte ton compte Apple Music pour écouter les morceaux entiers.', CD.el('button', { class: 'btn primary', text: 'Se connecter à Apple Music', onclick: amConnect }));
    }).catch(function (e) { amMsg('Apple Music indisponible : ' + ((e && e.message) || 'erreur') + '. Vérifie le jeton dans Réglages.'); });
  }
  function initApple() {
    var inp = $('amSearch'), tmr = null;
    inp.addEventListener('input', function () { clearTimeout(tmr); var q = this.value.trim(); tmr = setTimeout(function () { amRunSearch(q); }, 300); });
    setInterval(function () {            // avancement du morceau Apple Music
      if (!isApple() || !am.mk) return;
      var t = am.mk.currentPlaybackTime || 0, d = am.mk.currentPlaybackDuration || 0;
      if (!d) return;
      $('tCur').textContent = fmt(t); $('tDur').textContent = fmt(d);
      if (!document.activeElement || document.activeElement.id !== 'seek') $('seek').value = Math.round(t / d * 1000);
      CD.qsa('[data-prog]').forEach(function (e) { e.style.width = (t / d * 100).toFixed(1) + '%'; });
    }, 500);
  }

  // ====================== VUES : Accueil, Radio, Bibliotheque, Rechercher ======================
  var VIEWS = { home: 'Accueil', radio: 'Radio', lib: 'Bibliothèque', search: 'Rechercher' };
  var view = 'home', libKind = 'playlists', viewSeq = 0;

  function mkApi(path, params) { return am.mk.api.music(path, params).then(function (r) { return r && r.data; }); }
  // un element de l'API Apple Music -> { type, id, name, sub, art }
  function amItem(x, forced) {
    var a = x.attributes || {}, pp = a.playParams || {};
    var t = String(forced || pp.kind || x.type || '').replace('library-', '').replace(/s$/, '');
    var sub = t === 'playlist' ? (a.curatorName || 'Playlist') : (a.artistName || '') + (t === 'song' && a.albumName ? ' · ' + a.albumName : '');
    return { type: t, id: pp.catalogId || pp.id || x.id, name: a.name || (a.title && a.title.stringForDisplay) || '', sub: sub, art: artUrl(a.artwork, 400) };
  }
  function playable(it) { return it.name && (it.type === 'song' || it.type === 'album' || it.type === 'playlist'); }
  function coverCard(it) {
    return CD.el('button', { class: 'cc', onclick: function () { amPlayFull(it); } },
      CD.el('span', { class: 'cv', style: it.art ? 'background-image:url("' + it.art + '")' : '' }),
      CD.el('b', { text: it.name }), CD.el('span', { class: 'cs', text: it.sub || '' }));
  }
  function shelf(title, items) {
    items = items.filter(playable); if (!items.length) return null;
    var row = CD.el('div', { class: 'shelfrow' }); items.forEach(function (it) { row.appendChild(coverCard(it)); });
    return CD.el('section', { class: 'shelf' }, CD.el('h2', { text: title }), row);
  }
  function rowItem(it) {
    var on = cur && cur.name === it.name && (cur.sub === it.sub || !cur.sub);
    return CD.el('li', { class: 'row' + (on ? ' on' : ''), onclick: function () { amPlayFull(it); } },
      CD.el('span', { class: 'cv sm', style: it.art ? 'background-image:url("' + it.art + '")' : '' }),
      CD.el('div', { class: 'rt' }, CD.el('b', { text: it.name }), CD.el('span', { text: it.sub || '' })));
  }
  function note(id, text, btn) {
    var n = $(id); n.innerHTML = ''; n.classList.toggle('hidden', !text);
    if (text) { n.appendChild(CD.el('p', { text: text })); if (btn) n.appendChild(btn); }
  }
  // l'etat de connexion : jeton present -> MusicKit, autorisation -> bouton de connexion
  function amReady(msgId) {
    if (!amFull()) { note(msgId, 'Ajoute ton jeton Apple Music dans Réglages (Avancé) pour écouter les morceaux entiers.'); return Promise.reject(new Error('sans jeton')); }
    note(msgId, 'Chargement…');
    return amInit().then(function (mk) {
      if (mk.isAuthorized) { note(msgId, ''); return mk; }
      note(msgId, 'Connecte ton compte Apple Music.', CD.el('button', { class: 'btn primary', text: 'Se connecter', onclick: function () { amConnect(); setTimeout(function () { showView(view, true); }, 1500); } }));
      return Promise.reject(new Error('non connecte'));
    }).catch(function (e) { if (!/sans jeton|non connecte/.test(e && e.message)) note(msgId, 'Apple Music indisponible : ' + ((e && e.message) || 'erreur')); throw e; });
  }

  function loadHome() {
    var my = ++viewSeq, out = $('shelves'); out.innerHTML = '';
    amReady('homeMsg').then(function () {
      var calls = [
        mkApi('/v1/me/recent/played', { limit: 10 }).catch(function () { return null; }),
        mkApi('/v1/me/recommendations', { limit: 3 }).catch(function () { return null; }),
        mkApi('/v1/me/library/playlists', { limit: 12 }).catch(function () { return null; })
      ];
      return Promise.all(calls);
    }).then(function (r) {
      if (my !== viewSeq || !r) return;
      var recent = ((r[0] && r[0].data) || []).map(function (x) { return amItem(x); });
      var s = shelf('Écouté récemment', recent); if (s) out.appendChild(s);
      ((r[1] && r[1].data) || []).forEach(function (rec) {
        var items = ((rec.relationships && rec.relationships.contents && rec.relationships.contents.data) || []).map(function (x) { return amItem(x); });
        var t = (rec.attributes && rec.attributes.title && rec.attributes.title.stringForDisplay) || 'Pour toi';
        var sh = shelf(t, items); if (sh) out.appendChild(sh);
      });
      var pls = ((r[2] && r[2].data) || []).map(function (x) { return amItem(x, 'playlist'); });
      var sp = shelf('Mes playlists', pls); if (sp) out.appendChild(sp);
      if (!out.children.length) note('homeMsg', 'Rien à afficher pour le moment. Écoute un titre ou ajoute des playlists dans Apple Music.');
    }).catch(function () {});
  }

  function loadLib() {
    var my = ++viewSeq, out = $('libOut'); out.innerHTML = '';
    CD.qsa('[data-lib]').forEach(function (b) { b.classList.toggle('on', b.dataset.lib === libKind); });
    amReady('libMsg').then(function () { return mkApi('/v1/me/library/' + libKind, { limit: libKind === 'songs' ? 100 : 50 }); }).then(function (r) {
      if (my !== viewSeq) return;
      var items = ((r && r.data) || []).map(function (x) { return amItem(x, libKind.replace(/s$/, '')); }).filter(playable);
      if (!items.length) { note('libMsg', 'Rien dans cette section.'); return; }
      if (libKind === 'songs') { var ul = CD.el('ul', { class: 'rows' }); items.forEach(function (it) { ul.appendChild(rowItem(it)); }); out.appendChild(ul); }
      else { var g = CD.el('div', { class: 'cgrid' }); items.forEach(function (it) { g.appendChild(coverCard(it)); }); out.appendChild(g); }
    }).catch(function () {});
  }

  var sTimer = null;
  function runSearch(q) {
    var my = ++viewSeq, out = $('sOut'); out.innerHTML = '';
    if (q.length < 2) { note('sMsg', ''); return; }
    if (amFull() && am.mk && am.mk.isAuthorized) {
      amSearchFull(q).then(function (list) {
        if (my !== viewSeq) return;
        note('sMsg', list.length ? '' : 'Aucun résultat pour « ' + q + ' ».');
        [['song', 'Titres'], ['album', 'Albums'], ['playlist', 'Playlists']].forEach(function (g) {
          var items = list.filter(function (x) { return x.type === g[0]; }); if (!items.length) return;
          var ul = CD.el('ul', { class: 'rows' }); items.forEach(function (it) { ul.appendChild(rowItem(it)); });
          out.appendChild(CD.el('section', { class: 'shelf' }, CD.el('h2', { text: g[1] }), ul));
        });
      }).catch(function (e) { note('sMsg', 'Recherche impossible : ' + ((e && e.message) || 'connexion')); });
    } else {
      amSearchPreview(q).then(function (list) {
        if (my !== viewSeq) return;
        note('sMsg', list.length ? 'Extraits de 30 secondes. Ajoute ton jeton Apple Music dans Réglages (Avancé) pour les morceaux entiers.' : 'Aucun résultat pour « ' + q + ' ».');
        var ul = CD.el('ul', { class: 'rows' });
        list.forEach(function (it) { ul.appendChild(CD.el('li', { class: 'row', onclick: function () { play(it); } },
          CD.el('span', { class: 'cv sm', style: it.art ? 'background-image:url("' + it.art + '")' : '' }),
          CD.el('div', { class: 'rt' }, CD.el('b', { text: it.name }), CD.el('span', { text: it.sub || '' })))); });
        out.appendChild(ul);
      }).catch(function () { note('sMsg', 'Recherche impossible : vérifie la connexion.'); });
    }
  }

  function showView(v, force) {
    if (v === view && !force && v !== 'home') { /* deja affichee */ }
    view = v; $('s-music').dataset.view = v; $('vTitle').textContent = VIEWS[v];
    CD.qsa('[data-mview]').forEach(function (b) { b.classList.toggle('on', b.dataset.mview === v); });
    Object.keys(VIEWS).forEach(function (k) { $('v-' + k).classList.toggle('hidden', k !== v); });
    mnavPill(true);
    if (v === 'home') loadHome();
    else if (v === 'radio') showTab('radio');
    else if (v === 'lib') loadLib();
    else if (v === 'search') { note('sMsg', ''); if ($('sSearch').value.trim().length >= 2) runSearch($('sSearch').value.trim()); }
  }

  // ---- Pastille de verre du menu Musique : elle glisse d'un onglet a l'autre, et on peut la faire glisser du doigt ----
  var mp = null, mpAnim = null, mpBox = null;
  function mnavPill(animated) {
    var nav = document.querySelector('.mnav'), btn = nav && nav.querySelector('button.on');
    if (!nav || !btn || !btn.offsetWidth) return;
    if (!mp) { mp = document.createElement('div'); mp.className = 'mpill'; mp.setAttribute('aria-hidden', 'true'); nav.insertBefore(mp, nav.firstChild); }
    var to = { left: btn.offsetLeft, width: btn.offsetWidth, top: btn.offsetTop, height: btn.offsetHeight };
    if (mpAnim) { try { mpAnim.cancel(); } catch (e) {} mpAnim = null; }
    if (animated && mpBox && mp.animate && (mpBox.left !== to.left || mpBox.width !== to.width)) {
      var a = mpBox, l = Math.min(a.left, to.left), r = Math.max(a.left + a.width, to.left + to.width);
      mpAnim = mp.animate([
        { left: a.left + 'px', width: a.width + 'px' },
        { left: l + 'px', width: (r - l) + 'px', offset: 0.45 },
        { left: to.left + 'px', width: to.width + 'px' }
      ], { duration: 460, easing: 'cubic-bezier(.3,.75,.25,1)' });
    }
    mp.style.left = to.left + 'px'; mp.style.width = to.width + 'px'; mp.style.top = to.top + 'px'; mp.style.height = to.height + 'px';
    mpBox = to;
  }
  function initMnavDrag() {
    var nav = document.querySelector('.mnav'), drag = null, noClick = false;
    function btns() { return Array.prototype.slice.call(nav.querySelectorAll('button')); }
    nav.addEventListener('pointerdown', function (e) { if (!e.target.closest('button') || !mp) return; drag = { sx: e.clientX, l0: mpBox ? mpBox.left : 0, moved: false }; }, { passive: true });
    nav.addEventListener('pointermove', function (e) {
      if (!drag) return; var dx = e.clientX - drag.sx;
      if (!drag.moved) { if (Math.abs(dx) < 10) return; drag.moved = true; try { nav.setPointerCapture(e.pointerId); } catch (x) {} mp.classList.add('drag'); if (mpAnim) { try { mpAnim.cancel(); } catch (x) {} } }
      var bs = btns(), first = bs[0], last = bs[bs.length - 1], w = mpBox.width;
      var x = Math.max(first.offsetLeft, Math.min(last.offsetLeft + last.offsetWidth - w, drag.l0 + dx));
      mp.style.left = x + 'px'; mpBox = { left: x, width: w, top: mpBox.top, height: mpBox.height };
      var cx = x + w / 2, best = null, bd = 1e9;
      bs.forEach(function (b) { var d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - cx); if (d < bd) { bd = d; best = b; } });
      bs.forEach(function (b) { b.classList.toggle('hot', b === best); });
    });
    function end() {
      if (!drag) return; var d = drag; drag = null; if (!d.moved) return;
      mp.classList.remove('drag'); noClick = true; setTimeout(function () { noClick = false; }, 60);
      var hot = btns().filter(function (b) { return b.classList.contains('hot'); })[0];
      btns().forEach(function (b) { b.classList.remove('hot'); });
      if (hot) { if (hot.dataset.mview === view) mnavPill(true); else showView(hot.dataset.mview); }
    }
    nav.addEventListener('pointerup', end); nav.addEventListener('pointercancel', end);
    nav.addEventListener('click', function (e) { if (noClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    window.addEventListener('resize', function () { setTimeout(function () { mnavPill(false); }, 80); });
  }

  function initViews() {
    initMnavDrag();
    CD.qsa('[data-mview]').forEach(function (b) { b.onclick = function () { showView(b.dataset.mview); }; });
    CD.qsa('[data-lib]').forEach(function (b) { b.onclick = function () { libKind = b.dataset.lib; loadLib(); }; });
    $('sSearch').addEventListener('input', function () { clearTimeout(sTimer); var q = this.value.trim(); sTimer = setTimeout(function () { runSearch(q); }, 300); });
    // connexion automatique si un jeton existe deja
    if (amFull()) amInit().catch(function () {});
  }
  CD.musicView = function (v) { showView(v, true); };

  function init() {
    audio = $('audio');
    audio.volume = ST.volume / 100; $('volume').value = ST.volume;
    audio.addEventListener('play', setNow); audio.addEventListener('pause', setNow);
    audio.addEventListener('ended', function () { if (cur && cur.kind === 'file') step(1); });
    audio.addEventListener('error', function () { if (cur) CD.toast('Lecture impossible : ' + cur.name); });
    audio.addEventListener('timeupdate', function () {
      if (!cur || cur.kind !== 'file' || !audio.duration) return;
      $('tCur').textContent = fmt(audio.currentTime); $('tDur').textContent = fmt(audio.duration);
      if (!seeking) $('seek').value = Math.round(audio.currentTime / audio.duration * 1000);
      CD.qsa('[data-prog]').forEach(function (e) { e.style.width = (audio.currentTime / audio.duration * 100).toFixed(1) + '%'; });
    });
    var seeking = false, sk = $('seek');
    sk.addEventListener('input', function () { seeking = true; if (audio.duration) $('tCur').textContent = fmt(sk.value / 1000 * audio.duration); });
    sk.addEventListener('change', function () {
      if (isApple() && am.mk) { try { am.mk.seekToTime(sk.value / 1000 * (am.mk.currentPlaybackDuration || 0)); } catch (e) {} }
      else if (audio.duration) audio.currentTime = sk.value / 1000 * audio.duration;
      seeking = false;
    });
    $('volume').addEventListener('input', function () { ST.volume = +this.value; CD.saveSettings(); applyVol(); });

    CD.qsa('[data-mus]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var a = b.dataset.mus; if (a === 'play') toggle(); else step(a === 'next' ? 1 : -1);
      });
    });
    $('btnShuffle').onclick = function () { shuffle = !shuffle; setNow(); };
    $('btnFav').onclick = function () {
      if (!cur || cur.kind !== 'radio') { CD.toast('Lance d’abord une radio'); return; }
      if (isFav(cur.url)) favs = favs.filter(function (f) { return f.url !== cur.url; });
      else favs.push({ name: cur.name, sub: cur.sub, url: cur.url });
      CD.store.set('favs', favs); setNow();
    };
    CD.qsa('[data-mtab]').forEach(function (b) { b.onclick = function () { showTab(b.dataset.mtab); }; });
    $('radioBtn').onclick = function () { loadRadios($('radioSearch').value.trim()); };
    $('radioSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadRadios(this.value.trim()); });
    $('fileInput').addEventListener('change', function () {
      Array.prototype.forEach.call(this.files, function (f) {
        files.push({ kind: 'file', name: f.name.replace(/\.[^.]+$/, ''), sub: 'Fichier', url: URL.createObjectURL(f), list: 'files' });
      });
      this.value = ''; renderAll();
      if (!cur && files.length) play(files[0]);
    });
    $('btnClearFiles').onclick = function () {
      if (cur && cur.kind === 'file') { audio.pause(); cur = null; }
      files.forEach(function (f) { try { URL.revokeObjectURL(f.url); } catch (e) {} }); files = []; setNow();
    };
    CD.on('duck', function (d) { ducked = d; applyVol(); });
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', toggle); navigator.mediaSession.setActionHandler('pause', toggle);
        navigator.mediaSession.setActionHandler('nexttrack', function () { step(1); });
        navigator.mediaSession.setActionHandler('previoustrack', function () { step(-1); });
      } catch (e) {}
    }
    initApple(); initViews();
    renderAll(); setNow();
  }
  CD.music = { _am: am, _useApple: function (it) { amPlayFull(it); }, onShow: function () { showView(view, true); } };
  document.addEventListener('DOMContentLoaded', init);
})();
