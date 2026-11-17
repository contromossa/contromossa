// Tornei trasmessi su Lichess (Broadcast ufficiali). Non servono chiavi.
// Restituisce due elenchi:
//   items: i tornei del mondo in corso o in programma (come la pagina lichess.org/broadcast)
//   italy: i tornei italiani in corso, in programma o finiti da meno di 7 giorni

const CACHE_MS = 5 * 60 * 1000;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const UA = { 'User-Agent': 'contromossascacchi.it (sito di scacchi)' };
let cached = null;
let cachedAt = 0;

// Parole che indicano un torneo italiano (nel nome o nel luogo).
const ITALIA = /\bital|\bcampionat[oi]\b|\b(roma|milano|torino|napoli|firenze|bologna|venezia|genova|palermo|bari|padova|verona|trieste|cagliari|spilimbergo|cattolica|bratto|reggio emilia|perugia|pescara|sardegna|sicilia|toscana|lombardia|veneto|piemonte|lazio|campania|puglia|friuli|trentino|alto adige)\b/i;

function absUrl(u) {
  if (!u) return '';
  if (u.startsWith('https://lichess.org/')) return u;
  if (u.startsWith('/')) return 'https://lichess.org' + u;
  return '';
}

async function getRes(url, accept) {
  const res = await fetch(url, { headers: Object.assign({ Accept: accept }, UA), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' da ' + url);
  return res;
}

// Tornei del mondo in corso o in programma.
async function loadWorld() {
  const data = await (await getRes('https://lichess.org/api/broadcast/top?page=1', 'application/json')).json();
  return (data.active || []).slice(0, 12).map((x) => {
    const t = x.tour || {};
    const r = x.round || {};
    return {
      name: String(t.name || 'Torneo'),
      round: r.name ? String(r.name) : '',
      url: absUrl(r.url || t.url),
      startsAt: r.startsAt || null,
      ongoing: !!r.ongoing,
      finished: !!r.finished,
    };
  });
}

// Tornei italiani: si leggono gli ultimi 100 tornei ufficiali e si tengono quelli italiani.
async function loadItaly() {
  const text = await (await getRes('https://lichess.org/api/broadcast?nb=100', 'application/x-ndjson')).text();
  const now = Date.now();
  const out = [];
  text.split('\n').forEach((line) => {
    if (!line.trim()) return;
    let b;
    try { b = JSON.parse(line); } catch (e) { return; }
    const t = b.tour || {};
    const info = t.info || {};
    if (!ITALIA.test((t.name || '') + ' ' + (info.location || ''))) return;
    const rounds = Array.isArray(b.rounds) ? b.rounds : [];
    const dates = Array.isArray(t.dates) ? t.dates : [];
    const start = dates[0] || null;
    const end = dates[1] || dates[0] || null;
    const ongoing = rounds.find((r) => r.ongoing);
    const next = rounds.find((r) => !r.finished && !r.ongoing);
    const allDone = rounds.length > 0 && rounds.every((r) => r.finished);
    const lastFinished = rounds.filter((r) => r.finished).pop();
    const finishedAt = allDone ? ((lastFinished && lastFinished.finishedAt) || end) : null;
    // i tornei finiti da più di 7 giorni non si mostrano
    if (allDone && finishedAt && now - finishedAt > RECENT_MS) return;
    if (!allDone && !ongoing && !next) return;
    // tornei mai chiusi su Lichess ma con la data di fine passata da più di 7 giorni: si scartano
    if (!allDone && !ongoing && end && now - end > RECENT_MS) return;
    const shown = ongoing || next || lastFinished || {};
    out.push({
      name: String(t.name || 'Torneo'),
      location: info.location ? String(info.location) : '',
      round: shown.name ? String(shown.name) : '',
      url: absUrl(shown.url || t.url),
      start,
      end,
      startsAt: (next && next.startsAt) || null,
      ongoing: !!ongoing,
      finished: allDone,
      finishedAt,
    });
  });
  // prima quelli in corso, poi quelli in programma (dal più vicino), poi i finiti (dal più recente)
  const rank = (x) => (x.ongoing ? 0 : x.finished ? 2 : 1);
  out.sort((a, b) => rank(a) - rank(b) ||
    (rank(a) === 2 ? (b.finishedAt || 0) - (a.finishedAt || 0) : (a.startsAt || a.start || 0) - (b.startsAt || b.start || 0)));
  return out.slice(0, 12);
}

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=120',
    'Netlify-CDN-Cache-Control': 'public, max-age=300, stale-while-revalidate=120',
  };
  if (cached && Date.now() - cachedAt < CACHE_MS) {
    return { statusCode: 200, headers, body: JSON.stringify(cached) };
  }
  const [w, i] = await Promise.allSettled([loadWorld(), loadItaly()]);
  const errors = [];
  if (w.status === 'rejected') errors.push('mondo: ' + w.reason.message);
  if (i.status === 'rejected') errors.push('Italia: ' + i.reason.message);
  if (errors.length) console.error('Lichess broadcast:', errors.join(' | '));
  if (w.status === 'rejected' && i.status === 'rejected') {
    return { statusCode: 502, headers, body: JSON.stringify({ items: [], italy: [], error: 'non disponibile' }) };
  }
  const body = {
    items: w.status === 'fulfilled' ? w.value : [],
    italy: i.status === 'fulfilled' ? i.value : [],
    updatedAt: new Date().toISOString(),
  };
  // si salva in memoria solo se entrambe le letture sono riuscite
  if (!errors.length) { cached = body; cachedAt = Date.now(); }
  return { statusCode: 200, headers, body: JSON.stringify(body) };
};
