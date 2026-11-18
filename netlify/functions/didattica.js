// Didattica: problema del giorno di Lichess, ultimi video dei canali italiani
// e ultimi video del canale di Contromossa. Tutto si aggiorna da solo.
//
// Per aggiungere o togliere un canale basta cambiare l'elenco qui sotto
// (il nome è quello dopo la @ nell'indirizzo del canale YouTube).

const CANALI_LEZIONI = [
  'Scacchipertutti',
  'ScacchiconGabriel',
  'chessburgerTV',
  'cobrascacchi',
  'Themattoscacco',
  'Alessia_Santeramo',
  'gm_moro',
];
const CANALE_NOSTRO = 'contromossa.scacchi';

// Percorsi di studio: playlist YouTube scelte a mano, una per una (non cercate in automatico,
// così dentro ci sono solo corsi veri). Per aggiungerne una basta una riga nuova qui sotto:
// id = quello che compare dopo "list=" nell'indirizzo della playlist.
// Titolo, autore e lingua li scriviamo noi; numero di video e anteprima li legge YouTube.
const PERCORSI = [
  { id: 'PL8iaAgXaStUdzAuxSL0sWJ6tLz4PQWRZk', titolo: 'Imparo il gioco degli scacchi', autore: 'Daviddol', lingua: 'IT', livello: 'Principianti' },
  { id: 'PLzM1LjUh6yi82aO7jgQDP-Uz1c1pgrNuE', titolo: 'A lezione dal Gran Maestro', autore: 'Mattoscacco', lingua: 'IT', livello: '' },
  { id: 'PLIEiOyvhVKp6-N6nQscRDwyWZNAtm7bsc', titolo: 'Allenamento per giocatori da torneo', autore: 'Nicolochess', lingua: 'IT', livello: 'Giocatori da torneo' },
  { id: 'PLQsLDm9Rq9bHKEBnElquF8GuWkI1EJ8Zp', titolo: 'Beginner to Chess Master', autore: 'ChessNetwork', lingua: 'EN', livello: 'Dal principiante in su' },
  { id: 'PLp7SLTJhX1u4WqNPieH6vyAf2oVA2aUF4', titolo: 'Beginner Chess Course', autore: 'Chess Vibes', lingua: 'EN', livello: 'Principianti' },
  { id: 'PLQKBpQZcRycrvUUxLdVmlfMChJS0S5Zw0', titolo: 'Chess course from beginner to master level', autore: 'NM Robert Ramirez', lingua: 'EN', livello: 'Dal principiante in su' },
  { id: 'PLQKBpQZcRycoUWCHk9EY8AFNn4j0CpPWQ', titolo: 'Chess tactics', autore: 'NM Robert Ramirez', lingua: 'EN', livello: 'Tattica' },
  { id: 'PLQKBpQZcRycrItQHTvowBfgAt8Ea4z119', titolo: 'All the chess strategy I know', autore: 'NM Robert Ramirez', lingua: 'EN', livello: 'Strategia' },
  { id: 'PLQKBpQZcRycoJ58pfYGcUR-vAbjgLQTR3', titolo: 'All the chess endgames I know', autore: 'NM Robert Ramirez', lingua: 'EN', livello: 'Finali' },
];

const YT_KEY = process.env.YOUTUBE_API_KEY;
const CACHE_MS = 60 * 60 * 1000; // un'ora: il problema cambia una volta al giorno, i video poche volte
let cache = null;
let cacheAt = 0;
const uploadsCache = {};

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'contromossascacchi.it (sito di scacchi)', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' da ' + new URL(url).hostname);
  return res.json();
}

async function problemaDelGiorno() {
  const d = await getJson('https://lichess.org/api/puzzle/daily');
  return {
    id: d.puzzle.id,
    rating: d.puzzle.rating,
    temi: d.puzzle.themes || [],
    soluzione: d.puzzle.solution || [],
    mossaIniziale: d.puzzle.initialPly,
    pgn: d.game.pgn,
    url: 'https://lichess.org/training/' + d.puzzle.id,
  };
}

// 'PT1H2M3S' -> 3723
function secondi(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

async function listaCaricamenti(handle) {
  if (uploadsCache[handle]) return uploadsCache[handle];
  const data = await getJson('https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&forHandle=' +
    encodeURIComponent('@' + handle) + '&key=' + YT_KEY);
  const item = data.items && data.items[0];
  if (!item) throw new Error('canale non trovato: @' + handle);
  uploadsCache[handle] = { playlist: item.contentDetails.relatedPlaylists.uploads, nome: item.snippet.title };
  return uploadsCache[handle];
}

async function ultimiVideo(handles, perCanale, errori) {
  const elenchi = await Promise.all(handles.map(async (h) => {
    try {
      const c = await listaCaricamenti(h);
      const pl = await getJson('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=' + perCanale +
        '&playlistId=' + c.playlist + '&key=' + YT_KEY);
      return (pl.items || []).map((it) => ({
        id: it.snippet.resourceId && it.snippet.resourceId.videoId,
        titolo: it.snippet.title,
        canale: c.nome,
        data: it.snippet.publishedAt,
        immagine: (it.snippet.thumbnails && (it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url || '',
      })).filter((v) => v.id && v.titolo !== 'Private video' && v.titolo !== 'Deleted video');
    } catch (e) {
      errori.push(h + ': ' + e.message);
      return [];
    }
  }));
  const tutti = elenchi.flat();
  if (!tutti.length) return [];
  // togli dirette in corso o programmate (non sono lezioni da rivedere)
  try {
    const info = await getJson('https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=' +
      tutti.slice(0, 50).map((v) => v.id).join(',') + '&key=' + YT_KEY);
    const vivi = new Set();
    const durate = {};
    (info.items || []).forEach((v) => {
      if (v.snippet.liveBroadcastContent !== 'none') vivi.add(v.id);
      durate[v.id] = secondi(v.contentDetails && v.contentDetails.duration);
    });
    tutti.forEach((v) => { v.durata = durate[v.id] || 0; });
    return tutti.filter((v) => !vivi.has(v.id)).sort((a, b) => (a.data < b.data ? 1 : -1));
  } catch (e) {
    return tutti.sort((a, b) => (a.data < b.data ? 1 : -1));
  }
}

// Sceglie i video da mostrare: prima l'ultimo di ogni canale (così ci sono tutti, anche
// quelli che pubblicano poco), poi si riempiono i posti rimasti con i più recenti.
// I video più vecchi di maxGiorni non si mostrano. Ordine finale: dal più recente.
function sceglieVideo(video, max, maxGiorni) {
  const limite = Date.now() - maxGiorni * 24 * 60 * 60 * 1000;
  const recenti = video.filter((v) => Date.parse(v.data) >= limite); // già in ordine dal più recente
  const scelti = [];
  const canali = new Set();
  recenti.forEach((v) => {
    if (!canali.has(v.canale) && scelti.length < max) { canali.add(v.canale); scelti.push(v); }
  });
  recenti.forEach((v) => {
    if (scelti.length < max && scelti.indexOf(v) === -1) scelti.push(v);
  });
  return scelti.sort((a, b) => (a.data < b.data ? 1 : -1));
}

// Per ogni percorso aggiunge numero di video e anteprima letti da YouTube (una sola chiamata
// per tutti). Se YouTube non risponde i percorsi si mostrano lo stesso, senza numero né anteprima.
async function percorsiConDettagli(errori) {
  const base = PERCORSI.map((p) => Object.assign({}, p, { video: 0, immagine: '' }));
  if (!YT_KEY) return base;
  try {
    const d = await getJson('https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&maxResults=50&id=' +
      PERCORSI.map((p) => p.id).join(',') + '&key=' + YT_KEY);
    const per = {};
    (d.items || []).forEach((it) => { per[it.id] = it; });
    base.forEach((p) => {
      const it = per[p.id];
      if (!it) { errori.push('percorso non trovato: ' + p.id); return; }
      p.video = (it.contentDetails && it.contentDetails.itemCount) || 0;
      const t = it.snippet && it.snippet.thumbnails;
      p.immagine = ((t && (t.medium || t.default)) || {}).url || '';
    });
  } catch (e) {
    errori.push('percorsi: ' + e.message);
  }
  return base;
}

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=900',
    'Netlify-CDN-Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
  };
  if (cache && Date.now() - cacheAt < CACHE_MS) {
    return { statusCode: 200, headers, body: JSON.stringify(cache) };
  }
  const errori = [];
  const risultato = { aggiornato: new Date().toISOString(), problema: null, lezioni: [], percorsi: [], nostri: [], errori };

  const lavori = [
    problemaDelGiorno().then((p) => { risultato.problema = p; }).catch((e) => errori.push('Lichess: ' + e.message)),
  ];
  lavori.push(percorsiConDettagli(errori).then((p) => { risultato.percorsi = p; }));
  if (YT_KEY) {
    lavori.push(ultimiVideo(CANALI_LEZIONI, 3, errori).then((v) => { risultato.lezioni = sceglieVideo(v, 9, 60); }));
    lavori.push(ultimiVideo([CANALE_NOSTRO], 12, errori).then((v) => { risultato.nostri = v; }));
  } else {
    errori.push('YouTube: chiave non configurata');
  }
  await Promise.all(lavori);

  if (risultato.problema || risultato.lezioni.length) {
    cache = risultato;
    cacheAt = Date.now();
  }
  return { statusCode: 200, headers, body: JSON.stringify(risultato) };
};
