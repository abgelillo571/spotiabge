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
