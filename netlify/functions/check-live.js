// Controlla quali canali sono in diretta su Twitch e YouTube.
// Le chiavi si leggono dalle impostazioni riservate di Netlify:
//   TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, YOUTUBE_API_KEY

const TWITCH_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_SECRET = process.env.TWITCH_CLIENT_SECRET;
const YT_KEY = process.env.YOUTUBE_API_KEY;

// Elenco dei canali. Per aggiungerne uno, basta una riga qui
// (e la scheda corrispondente nella pagina, con lo stesso "id").
const CHANNELS = {
  gm_moro:     { twitch: 'gm_moro', youtube: 'gm_moro' },
  nicolochess: { twitch: 'nicolochess', youtube: 'Scacchipertutti' },
  hikaru:      { twitch: 'gmhikaru' },
  chessburger: { twitch: 'chessburger_tv', youtube: 'chessburgerTV' },
  alessia:     { twitch: 'alessiasanteramo', youtube: 'Alessia_Santeramo' },
  gabriel:     { youtube: 'ScacchiconGabriel' },
  cobra:       { youtube: 'cobrascacchi' },
  gotham:      { twitch: 'gothamchess', youtube: 'GothamChess' },
  botez:       { twitch: 'botezlive', youtube: 'BotezLive' },
  chessbrah:   { twitch: 'chessbrah', youtube: 'chessbrah' },
  akanemsko:   { twitch: 'akanemsko', youtube: 'akanemsko' },
  chesssociety:{ twitch: 'chesssociety' },
  chesscomit:  { twitch: 'chesscomit' },
  agadmator:   { youtube: 'agadmator' },
  mattoscacco: { youtube: 'Themattoscacco' },
  rosen:       { twitch: 'imrosen', youtube: 'imrosen' },
  cramling:    { twitch: 'annacramling', youtube: 'AnnaCramling' },
  chesscom:    { twitch: 'chess' },
  chess24:     { twitch: 'chess24' },
  fide:        { twitch: 'fide_chess' },
  federscacchi:{ twitch: 'federscacchi' },
  reyenigma:   { youtube: 'ReyEnigma' },
};

const CACHE_MS = 240 * 1000; // risultato riutilizzato per 4 minuti (risparmia il limite di YouTube)
let cachedResult = null;
let cachedAt = 0;
let twitchToken = null;
let twitchTokenExpiry = 0;
const uploadsCache = {}; // handle YouTube -> id della lista dei video caricati

async function getJson(url, options) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(8000) }, options));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' da ' + new URL(url).hostname);
  return res.json();
}

async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchTokenExpiry) return twitchToken;
  const body = new URLSearchParams({
    client_id: TWITCH_ID,
    client_secret: TWITCH_SECRET,
    grant_type: 'client_credentials',
  });
  const data = await getJson('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
  twitchToken = data.access_token;
  twitchTokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
  return twitchToken;
}

async function checkTwitch(result) {
  const entries = Object.entries(CHANNELS).filter(([, c]) => c.twitch);
  const token = await getTwitchToken();
  const params = entries.map(([, c]) => 'user_login=' + encodeURIComponent(c.twitch)).join('&');
  const data = await getJson('https://api.twitch.tv/helix/streams?' + params, {
    headers: { 'Client-ID': TWITCH_ID, Authorization: 'Bearer ' + token },
  });
  const live = {};
  (data.data || []).forEach((st) => { live[st.user_login.toLowerCase()] = st; });
  entries.forEach(([id, c]) => {
    result[id].twitchKnown = true;
    const st = live[c.twitch.toLowerCase()];
    if (st && st.type === 'live') {
      result[id].isLive = true;
      result[id].platform = 'twitch';
      result[id].viewerCount = st.viewer_count || 0;
      result[id].title = st.title || '';
      result[id].url = 'https://www.twitch.tv/' + c.twitch;
    }
  });
}

// YouTube: costa poco (circa 1 punto per canale) perché NON usa la ricerca.
// Legge gli ultimi video caricati di ogni canale e guarda se uno è in diretta.
async function getUploadsPlaylist(handle) {
  if (uploadsCache[handle]) return uploadsCache[handle];
  const url = 'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=' +
    encodeURIComponent('@' + handle) + '&key=' + YT_KEY;
  const data = await getJson(url);
  const item = data.items && data.items[0];
  if (!item) throw new Error('Canale YouTube non trovato: @' + handle);
  uploadsCache[handle] = item.contentDetails.relatedPlaylists.uploads;
  return uploadsCache[handle];
}

async function checkYouTube(result) {
  const entries = Object.entries(CHANNELS).filter(([id, c]) => c.youtube && !result[id].isLive);
  const videoToChannel = {};
  const errors = [];
  for (const [id, c] of entries) {
    try {
      const playlist = await getUploadsPlaylist(c.youtube);
      const items = await getJson('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=5&playlistId=' +
        playlist + '&key=' + YT_KEY);
      (items.items || []).forEach((it) => { videoToChannel[it.contentDetails.videoId] = id; });
      result[id].youtubeKnown = true;
    } catch (e) {
      errors.push(c.youtube + ': ' + e.message);
    }
  }
  const ids = Object.keys(videoToChannel);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await getJson('https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=' +
      chunk.join(',') + '&key=' + YT_KEY);
    (data.items || []).forEach((v) => {
      const id = videoToChannel[v.id];
      const isLive = v.snippet && v.snippet.liveBroadcastContent === 'live';
      if (isLive && id && !result[id].isLive) {
        result[id].isLive = true;
        result[id].platform = 'youtube';
        result[id].title = v.snippet.title || '';
        result[id].viewerCount = Number((v.liveStreamingDetails || {}).concurrentViewers) || 0;
        result[id].url = 'https://www.youtube.com/watch?v=' + v.id;
      }
    });
  }
  if (errors.length) throw new Error(errors.join(' | '));
}

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=120',
    'Netlify-CDN-Cache-Control': 'public, max-age=240, stale-while-revalidate=60',
  };
  if (cachedResult && Date.now() - cachedAt < CACHE_MS) {
    return { statusCode: 200, headers, body: JSON.stringify(cachedResult) };
  }

  const result = {};
  Object.keys(CHANNELS).forEach((id) => {
    result[id] = { isLive: false, viewerCount: 0, title: '', platform: 'none', url: '', twitchKnown: false, youtubeKnown: false };
  });
  const meta = { updatedAt: new Date().toISOString(), twitch: 'non configurato', youtube: 'non configurato', errors: [] };

  if (TWITCH_ID && TWITCH_SECRET) {
    try { await checkTwitch(result); meta.twitch = 'ok'; }
    catch (e) { meta.twitch = 'errore'; meta.errors.push('Twitch: ' + e.message); }
  }
  if (YT_KEY) {
    try { await checkYouTube(result); meta.youtube = 'ok'; }
    catch (e) { meta.youtube = 'errore'; meta.errors.push('YouTube: ' + e.message); }
  }

  // "known" = lo stato è davvero stato verificato su tutte le piattaforme del canale.
  Object.entries(CHANNELS).forEach(([id, c]) => {
    const r = result[id];
    const twitchOk = !c.twitch || r.twitchKnown;
    const youtubeOk = !c.youtube || r.youtubeKnown || r.isLive;
    r.known = r.isLive || (twitchOk && youtubeOk);
    delete r.twitchKnown; delete r.youtubeKnown;
  });
  result._meta = meta;
  if (meta.errors.length) console.error(meta.errors.join('\n'));

  // Si salva in memoria solo se non ci sono errori, così al prossimo accesso si riprova.
  if (!meta.errors.length) { cachedResult = result; cachedAt = Date.now(); }
  return { statusCode: 200, headers, body: JSON.stringify(result) };
};
