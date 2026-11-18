// Tornei trasmessi su Lichess (Broadcast ufficiali). Non servono chiavi.
// Restituisce items: i tornei del mondo in corso o in programma (come la pagina lichess.org/broadcast).
// I tornei italiani non si prendono più da qui: arrivano dal Calendario della Federscacchi
// (funzione tornei-italia.js), dal 18 novembre 2026.

const CACHE_MS = 5 * 60 * 1000;
const UA = { 'User-Agent': 'contromossascacchi.it (sito di scacchi)' };
let cached = null;
let cachedAt = 0;

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

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=120',
    'Netlify-CDN-Cache-Control': 'public, max-age=300, stale-while-revalidate=120',
  };
  if (cached && Date.now() - cachedAt < CACHE_MS) {
    return { statusCode: 200, headers, body: JSON.stringify(cached) };
  }
  try {
    const items = await loadWorld();
    const body = { items, updatedAt: new Date().toISOString() };
    cached = body;
    cachedAt = Date.now();
    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    console.error('Lichess broadcast:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ items: [], error: 'non disponibile' }) };
  }
};
