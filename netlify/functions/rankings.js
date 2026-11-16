// Classifiche: FIDE (lista mensile ufficiale) e classifiche online di Chess.com e Lichess.
// Non servono chiavi. Se una fonte non risponde, quella parte resta vuota e il sito lo segnala.

const UA = 'contromossa.it (sito di scacchi)';
const FIDE_URLS = {
  standard: 'https://ratings.fide.com/a_top.php?list=open',
  rapid: 'https://ratings.fide.com/a_top.php?list=men_rapid',
  blitz: 'https://ratings.fide.com/a_top.php?list=men_blitz',
};
// Classifica per federazione: la FIDE la serve solo se la richiesta sembra venire dalla sua pagina (XMLHttpRequest).
const FIDE_ITA = (r) => 'https://ratings.fide.com/a_top_var.php?continent=0&country=ITA&rating=' + r + '&gender=&age1=0&age2=0&period=1&period2=1';
const FIDE_CACHE_MS = 6 * 60 * 60 * 1000;   // la lista FIDE cambia una volta al mese
const ONLINE_CACHE_MS = 10 * 60 * 1000;
let fideCache = null, fideAt = 0, fideTry = 0, onlineCache = null, onlineAt = 0;
const FIDE_RETRY_MS = 5 * 60 * 1000;   // se la FIDE non risponde, riprova al massimo ogni 5 minuti

async function get(url, headers) {
  const res = await fetch(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}), signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' da ' + new URL(url).hostname);
  return res;
}

function strip(t) {
  return String(t || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
}

// Legge la tabella delle liste FIDE: colonne attese # | Nome | Federazione | Rating | Anno di nascita.
function parseFide(html) {
  const rows = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => strip(m[1]));
    if (cells.length < 4) continue;
    const rank = parseInt(cells[0], 10);
    if (!(rank >= 1 && rank <= 100) || !/[A-Za-z]/.test(cells[1] || '')) continue;
    const rating = cells.slice(2).find((c) => /^\d{4}$/.test(c) && +c >= 1500 && +c <= 3000);
    const fed = cells.slice(2).find((c) => /^[A-Z]{3}$/.test(c)) || '';
    if (!rating) continue;
    let name = cells[1];
    if (name.includes(',')) { const [a, b] = name.split(',').map((x) => x.trim()); name = (b + ' ' + a).trim(); }
    rows.push({ name, fed, rating: Number(rating) });
  }
  return rows.slice(0, 10);
}

const MESI = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TIPI = ['standard', 'rapid', 'blitz'];

// Fonte principale: fideratings.com (stessi dati FIDE, risponde anche ai server di Netlify).
async function fromMirror(k, fed) {
  const url = 'https://fideratings.com/api/top/open?limit=10&type=' + k + (fed ? '&fed=' + fed : '');
  const d = await (await get(url, { Accept: 'application/json' })).json();
  const rows = (d.players || []).slice(0, 10).map((p) => {
    let name = String(p.name || '');
    if (name.includes(',')) { const [x, y] = name.split(',').map((t) => t.trim()); name = (y + ' ' + x).trim(); }
    return { name, fed: p.country || '', rating: Number(p.rating) };
  }).filter((r) => r.rating >= 1500);
  if (rows.length < 5) throw new Error('lista non riconosciuta');
  const m = String(d.date || '').match(/^(\d{4})-(\d{2})$/);
  return { rows, month: m ? MESI[+m[2] - 1] + ' ' + m[1] : '' };
}

// Riserva: sito ufficiale FIDE (spesso lento o bloccato dai server di Netlify).
async function fromFide(k, fed) {
  const url = fed ? FIDE_ITA(k) : FIDE_URLS[k];
  const headers = fed ? { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://ratings.fide.com/rankings.phtml' } : undefined;
  const html = await (await get(url, headers)).text();
  const rows = parseFide(html);
  if (rows.length < 5) throw new Error('tabella non riconosciuta');
  const m = html.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)\b/);
  return { rows, month: m ? m[1] + ' ' + m[2] : '' };
}

async function loadFide() {
  const out = { month: '', standard: null, rapid: null, blitz: null, ita: { standard: null, rapid: null, blitz: null } };
  const errors = [];
  const jobs = [];
  for (const k of TIPI) for (const fed of [null, 'ITA']) jobs.push((async () => {
    let r;
    try { r = await fromMirror(k, fed); }
    catch (e1) {
      try { r = await fromFide(k, fed); }
      catch (e2) { errors.push('FIDE ' + (fed ? 'Italia ' : '') + k + ': ' + e1.message + ' / ' + e2.message); return; }
    }
    if (fed) out.ita[k] = r.rows; else out[k] = r.rows;
    if (!out.month && r.month) out.month = r.month;
  })());
  await Promise.all(jobs);
  return { data: out, errors };
}

async function loadOnline() {
  const errors = [];
  const cc = { standard: null, rapid: null, blitz: null };
  const li = { standard: null, rapid: null, blitz: null };
  try {
    const d = await (await get('https://api.chess.com/pub/leaderboards', { Accept: 'application/json' })).json();
    const map = { standard: 'daily', rapid: 'live_rapid', blitz: 'live_blitz' };
    for (const k of Object.keys(map)) {
      const list = d[map[k]];
      if (Array.isArray(list) && list.length) {
        cc[k] = list.slice(0, 10).map((p) => ({
          name: p.name || p.username,
          fed: String(p.country || '').split('/').pop(),
          rating: p.score,
        }));
      }
    }
  } catch (e) { errors.push('Chess.com: ' + e.message); }
  const perfs = { standard: 'classical', rapid: 'rapid', blitz: 'blitz' };
  await Promise.all(Object.keys(perfs).map(async (k) => {
    try {
      const d = await (await get('https://lichess.org/api/player/top/10/' + perfs[k], { Accept: 'application/vnd.lichess.v3+json' })).json();
      li[k] = (d.users || []).slice(0, 10).map((u) => ({
        name: (u.title ? u.title + ' ' : '') + u.username,
        fed: '',
        rating: u.perfs && u.perfs[perfs[k]] ? u.perfs[perfs[k]].rating : '',
      }));
    } catch (e) { errors.push('Lichess ' + k + ': ' + e.message); }
  }));
  return { data: { chesscom: cc, lichess: li }, errors };
}

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'Netlify-CDN-Cache-Control': 'public, max-age=600, stale-while-revalidate=300',
  };
  const errors = [];
  const needFide = (!fideCache || !fideCache.standard || Date.now() - fideAt > FIDE_CACHE_MS) && Date.now() - fideTry > FIDE_RETRY_MS;
  const needOnline = !onlineCache || Date.now() - onlineAt > ONLINE_CACHE_MS;
  // le due letture partono insieme, così il tempo totale resta sotto i 10 secondi di Netlify
  const [f, o] = await Promise.all([needFide ? loadFide() : null, needOnline ? loadOnline() : null]);
  if (f) {
    errors.push(...f.errors);
    fideTry = Date.now();
    if (f.data.standard) { fideCache = f.data; fideAt = Date.now(); } else fideCache = fideCache || f.data;
  }
  if (o) { errors.push(...o.errors); onlineCache = o.data; onlineAt = Date.now(); }
  if (errors.length) console.error(errors.join('\n'));
  const body = { fide: fideCache, chesscom: onlineCache.chesscom, lichess: onlineCache.lichess, errors, updatedAt: new Date().toISOString() };
  return { statusCode: 200, headers, body: JSON.stringify(body) };
};
