// SpotiAbge hotfix — se descarga y ejecuta cada vez que se abre la app
// (y al pulsar "Reparar ahora"). Si esta vacio no hace nada.
//
// Aqui se pueden redefinir las funciones de la app cuando Spotify cambie algo, por ejemplo:
//   window.addAndAuto      -> lee titulo/artista/caratula del reproductor (nombres de canciones)
//   window.fetchMediaItems -> listas que ve Android Auto
//   window.searchMediaItems-> busqueda / voz en Android Auto
//   window.playFromUri     -> reproducir algo elegido en el coche
// y forzar hashes concretos:
//   window.__splDiscHashes['fetchPlaylist'] = '<hash>';
//
// Debe ser seguro ejecutarlo varias veces.

// ---------------------------------------------------------------------------------------------
// Vigilante anti-cuelgues (2026-11-14): con la pantalla apagada el reproductor web a veces se
// queda "sonando" sin avanzar o atascado al final de una cancion, y el boton del auricular ya no
// hace nada. Si la musica deberia sonar (la ultima orden fue play) y no avanza, la recupera:
//   1) pausa+play   2) siguiente cancion si esta atascada al final   3) recarga y sigue sonando.
// Nunca pelea contra una pausa tuya (auricular, desconexion BT, coche) ni contra otro dispositivo.
// Guarda un registro en localStorage 'sab_watch_log' para diagnosticar luego.
(function sabWatchdog(){
  if (window.__sabWatch) return;
  if (typeof window.actPlayPause !== 'function' || typeof window.splIsPlaying !== 'function') {
    setTimeout(sabWatchdog, 3000);
    return;
  }
  window.__sabWatch = true;
  var S = window.__sabWatchState = {want: false, lastPos: -1, sameSince: 0, step: 0, lastAct: 0, userPauseAt: 0};
  var TICK = 5000, STUCK = 25000, GAP = 20000;

  function log(m){
    try {
      var l = JSON.parse(localStorage.getItem('sab_watch_log') || '[]');
      l.push(new Date().toISOString().slice(5, 19) + ' ' + m);
      localStorage.setItem('sab_watch_log', JSON.stringify(l.slice(-60)));
    } catch (e) {}
    try { AndBridge.dbg('w', 'watchdog ' + m); } catch (e) {}
  }
  window.sabWatchLog = function(){ try { return JSON.parse(localStorage.getItem('sab_watch_log') || '[]'); } catch (e) { return []; } };

  // remember what the user asked for (headset / car / notification all go through actPlayPause)
  var orig = window.actPlayPause;
  window.actPlayPause = function(play){
    if (play === false) { S.want = false; S.userPauseAt = Date.now(); }
    else if (play === true) { S.want = true; S.step = 0; S.sameSince = Date.now(); }
    else { S.want = !(window.splIsPlaying() === true); if (!S.want) S.userPauseAt = Date.now(); }
    return orig.apply(this, arguments);
  };
  window.actPlayPause.__sabWatched = true;

  function pos(){
    var r = document.querySelector('div[data-testid=playback-progressbar] input[type=range]');
    if (!r) return {p: -1, d: 0};
    return {p: parseInt(r.getAttribute('value') || r.value, 10) || 0, d: parseInt(r.getAttribute('max'), 10) || 0};
  }
  function remote(){ try { return !!(window.__splRemoteActive && window.__splRemoteActive()); } catch (e) { return false; } }
  function reloadAndResume(){
    try {
      var last = +(sessionStorage.getItem('sab_recover_at') || 0);
      if (Date.now() - last < 120000) { log('recarga omitida (hubo otra hace poco)'); return; }
      sessionStorage.setItem('sab_recover_at', String(Date.now()));
      sessionStorage.setItem('sab_pending_play', JSON.stringify({req: {resume: true}, t: Date.now()}));
    } catch (e) {}
    log('recargando el reproductor y reanudando');
    location.reload();
  }

  function tick(){
    try {
      var now = Date.now(), playing = window.splIsPlaying(), q = pos();
      // follow what is really happening when the user starts music from the app itself
      if (playing === true && !S.want && now - S.userPauseAt > 3000) { S.want = true; S.step = 0; }
      if (!S.want || remote() || q.p < 0) { S.lastPos = q.p; S.sameSince = now; return; }
      // only forward movement proves it plays; a jump back to 0 is just a (maybe frozen) new track
      if (q.p > S.lastPos && S.lastPos >= 0) { S.lastPos = q.p; S.sameSince = now; if (S.step) log('recuperado (paso ' + S.step + ')'); S.step = 0; return; }
      if (q.p !== S.lastPos) { S.lastPos = q.p; if (S.step === 0) S.sameSince = now; return; }
      var stuck = now - S.sameSince;
      // stopped on its own (not frozen while "playing"): wait longer, it may be a phone call
      if (stuck < (playing === true ? STUCK : 60000) || now - S.lastAct < (playing === true ? GAP : 60000)) return;
      S.lastAct = now;
      var atEnd = q.d > 0 && q.p >= q.d - 2500;
      S.step++;
      if (S.step === 1) {
        log('parado ' + Math.round(stuck / 1000) + 's (pos ' + q.p + '/' + q.d + ', sonando=' + playing + ') -> ' + (atEnd ? 'siguiente' : 'pausa+play'));
        try { AndBridge.wakeUp(); } catch (e) {}
        if (atEnd) window.actSkipForward();
        else if (playing === true) { orig(false); setTimeout(function(){ orig(true); }, 1500); }
        else orig(true);
      } else if (S.step === 2) {
        log('sigue parado -> siguiente cancion');
        window.actSkipForward();
        setTimeout(function(){ if (window.splIsPlaying() !== true) orig(true); }, 2500);
      } else {
        reloadAndResume();
        S.step = 0;
      }
    } catch (e) { log('error ' + e); }
  }
  setInterval(tick, TICK);
  if (window.splIsPlaying() === true) S.want = true;
  log('vigilante activo');
})();

// ---------------------------------------------------------------------------------------------
// Hora en punto (2026-11-14): mientras suena musica, a cada hora en punto una voz dice la hora
// ("Son las tres de la tarde en punto") bajando un momento la musica. Se activa/desactiva en el
// panel de la llave ("Decir la hora en punto"); al activarlo dice la hora actual como prueba.
(function sabHourly(){
  if (window.__sabHourly) return;
  window.__sabHourly = true;
  var BASE = 'https://raw.githubusercontent.com/abgelillo571/spotiabge/main/hora/';
  function on(){ try { return localStorage.getItem('sab_hora') !== 'off'; } catch (e) { return true; } }
  function say(h){
    var a = new Audio(BASE + (h < 10 ? '0' : '') + h + '.mp3');
    var m = null, v = 1;
    try { m = window.splMediaEl && window.splMediaEl(); if (m) { v = m.volume; m.volume = Math.min(v, 0.25); } } catch (e) {}
    var back = function(){ try { if (m) m.volume = v; } catch (e) {} };
    a.onended = back; a.onerror = back;
    setTimeout(back, 8000);
    var p = a.play(); if (p && p.catch) p.catch(back);
  }
  window.sabSayHour = function(){ say(new Date().getHours()); };
  var last = -1;
  try { last = +(localStorage.getItem('sab_hora_last') || -1); } catch (e) {}
  setInterval(function(){
    var d = new Date(), key = d.getDate() * 100 + d.getHours();
    if (d.getMinutes() !== 0 || key === last || !on()) return;
    if (!(window.splIsPlaying && window.splIsPlaying() === true)) return;
    last = key;
    try { localStorage.setItem('sab_hora_last', String(key)); } catch (e) {}
    say(d.getHours());
  }, 15000);
  // switch in the repair panel (shadow DOM of #sab-host)
  setInterval(function(){
    var h = document.getElementById('sab-host'), r = h && h.shadowRoot, card = r && r.querySelector('.card');
    if (!card || r.querySelector('[data-a=hora]')) return;
    var b = document.createElement('button');
    b.className = 'b s'; b.setAttribute('data-a', 'hora');
    var hint = document.createElement('div'); hint.className = 'hint';
    hint.textContent = 'Una voz dice la hora cada hora en punto mientras suena la musica.';
    var label = function(){ b.textContent = 'Decir la hora en punto: ' + (on() ? 'activado' : 'desactivado'); };
    label();
    b.addEventListener('click', function(e){
      e.stopPropagation();
      try { localStorage.setItem('sab_hora', on() ? 'off' : 'on'); } catch (x) {}
      label();
      if (on()) window.sabSayHour();
    });
    var det = card.querySelector('details');
    card.insertBefore(hint, det); card.insertBefore(b, hint);
  }, 2000);
})();
