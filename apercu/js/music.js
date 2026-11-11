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
      CD.el('div', { style: 'min-width:0' }, CD.el('div', { class: 't1', text: item.name }), CD.el('div', { class: 't2', text: subtitle })), extra || null);
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
    CD.qsa('[data-mtab]').forEach(function (b) { b.classList.toggle('on', b.dataset.mtab === t); });
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
    initApple();
    renderAll(); setNow();
  }
  CD.music = { _am: am, _useApple: function (it) { amPlayFull(it); }, onShow: function () { if (tab === 'radio' && !stations.length) loadRadios(''); } };
  document.addEventListener('DOMContentLoaded', init);
})();
