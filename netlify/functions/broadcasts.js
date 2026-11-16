// Elenco dei tornei trasmessi in diretta su Lichess (Broadcast ufficiali).
// Non servono chiavi.

const CACHE_MS = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;

function absUrl(u) {
  if (!u) return '';
  if (u.startsWith('https://lichess.org/')) return u;
  if (u.startsWith('/')) return 'https://lichess.org' + u;
  return '';
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
    const res = await fetch('https://lichess.org/api/broadcast/top?page=1', {
      headers: { Accept: 'application/json', 'User-Agent': 'contromossa.it (sito di scacchi)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const items = (data.active || []).slice(0, 12).map((x) => {
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
    cached = { items, updatedAt: new Date().toISOString() };
    cachedAt = Date.now();
    return { statusCode: 200, headers, body: JSON.stringify(cached) };
  } catch (e) {
    console.error('Lichess broadcast:', e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ items: [], error: 'non disponibile' }) };
  }
};
