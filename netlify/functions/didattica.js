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
  const risultato = { aggiornato: new Date().toISOString(), problema: null, lezioni: [], nostri: [], errori };

  const lavori = [
    problemaDelGiorno().then((p) => { risultato.problema = p; }).catch((e) => errori.push('Lichess: ' + e.message)),
  ];
  if (YT_KEY) {
    lavori.push(ultimiVideo(CANALI_LEZIONI, 3, errori).then((v) => { risultato.lezioni = v.slice(0, 9); }));
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
