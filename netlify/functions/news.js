// Titoli e anteprime delle notizie di scacchi, letti dai feed pubblici dei siti.
// Non servono chiavi. Se un feed non risponde, viene saltato.
// Per aggiungere o togliere una fonte, modificare l'elenco FEEDS.
// category: 'it' = notizie italiane, 'int' = internazionali.

const FEEDS = [
  { name: 'Chess.com',        category: 'int', url: 'https://www.chess.com/rss/news' },
  { name: 'Lichess',          category: 'int', url: 'https://lichess.org/blog.atom' },
  { name: 'The Week in Chess', category: 'int', url: 'https://theweekinchess.com/twic-rss-feed' },
  { name: 'Scacchierando.it', category: 'it',  url: 'https://www.scacchierando.it/feed' },
  { name: 'UnoScacchista',    category: 'it',  url: 'https://unoscacchista.com/feed' },
];

const CACHE_MS = 15 * 60 * 1000;
let cached = null;
let cachedAt = 0;

function decode(t) {
  return t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}
function plain(t) { return decode(decode(t || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function linkOf(block) {
  const atom = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (atom) return decode(atom[1]);
  return plain(tag(block, 'link'));
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.slice(0, 8).map((b) => {
    const dateRaw = plain(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'));
    const d = new Date(dateRaw);
    let summary = plain(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    if (summary.length > 220) summary = summary.slice(0, 217).replace(/\s+\S*$/, '') + '…';
    return {
      title: plain(tag(b, 'title')),
      link: linkOf(b),
      date: isNaN(d) ? null : d.toISOString(),
      summary,
      source: feed.name,
      category: feed.category,
    };
  }).filter((n) => n.title && /^https:\/\//.test(n.link));
}

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'Netlify-CDN-Cache-Control': 'public, max-age=900, stale-while-revalidate=300',
  };
  if (cached && Date.now() - cachedAt < CACHE_MS) {
    return { statusCode: 200, headers, body: JSON.stringify(cached) };
  }
  const results = await Promise.allSettled(FEEDS.map(async (feed) => {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'contromossa.it (sito di scacchi)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(feed.name + ': HTTP ' + res.status);
    return parseFeed(await res.text(), feed);
  }));

  const failed = [];
  let items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items = items.concat(r.value);
    else failed.push(FEEDS[i].name);
  });
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  items = items.slice(0, 24).map((n, i) => Object.assign({ id: 'n' + i }, n));

  const body = { items, failedSources: failed, updatedAt: new Date().toISOString() };
  if (items.length) { cached = body; cachedAt = Date.now(); }
  if (failed.length) console.error('Fonti non raggiungibili: ' + failed.join(', '));
  return { statusCode: 200, headers, body: JSON.stringify(body) };
};
