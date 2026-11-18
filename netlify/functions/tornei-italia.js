// Tornei italiani dal Calendario nazionale della Federscacchi (FSI).
// Restituisce i tornei in corso oggi o che iniziano nei prossimi 6 giorni (ora italiana).
// Sono esclusi i corsi (istruttori, dirigenti): non sono tornei.
//
// La ricerca della Federscacchi trova i tornei solo in base al giorno di INIZIO.
// Per non perdere quelli già cominciati e ancora in corso, si chiedono anche
// i tornei iniziati nei 14 giorni precedenti e si tengono quelli non ancora finiti.
//
// La pagina della Federscacchi non è un servizio pensato per altri siti: se cambia
// la sua grafica, la lettura può rompersi. In quel caso la funzione restituisce
// un elenco vuoto con "error", e il sito mostra il collegamento al Calendario.

const CAL_URL = 'https://www.federscacchi.com/fsi/index.php/calendario/calendario';
const GIORNI_AVANTI = 6;     // oggi + 6 giorni = una settimana
const GIORNI_INDIETRO = 14;  // per i tornei già iniziati e non ancora finiti
const CACHE_MS = 60 * 60 * 1000;
const UA = { 'User-Agent': 'contromossascacchi.it (sito di scacchi)' };
let cached = null;
let cachedAt = 0;

// Data di oggi in Italia, come "AAAA-MM-GG".
function oggiItalia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Somma giorni a una data "AAAA-MM-GG".
function piuGiorni(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "20-11-2026" diventa "2026-11-20"; le date senza senso (anni prima del 2000) si scartano.
function dataIso(gma) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(gma || '');
  if (!m || Number(m[3]) < 2000) return null;
  return m[3] + '-' + m[2] + '-' + m[1];
}

function pulisci(t) {
  return String(t || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/''/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/"\s*([^"]+?)\s*"/g, '"$1"')   // « " Piero Ognibene"» diventa «"Piero Ognibene"»
    .trim();
}

// "VENEZIA" diventa "Venezia"; i nomi già scritti con maiuscole e minuscole restano come sono.
function maiuscolaIniziale(t) {
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'(-])(\p{L})/gu, (s, a, b) => a + b.toUpperCase());
}

function link(u) {
  u = (u || '').trim();
  if (/^www\./i.test(u)) u = 'http://' + u;
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : '';
}

function campo(blocco, etichetta) {
  const m = new RegExp('<b>\\s*' + etichetta + ':\\s*</b>([\\s\\S]*?)</div>', 'i').exec(blocco);
  return m ? m[1] : '';
}

function hrefDi(html) {
  const m = /<a\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(html || '');
  return m ? link(m[1]) : '';
}

// Legge la pagina dei risultati e restituisce l'elenco dei tornei.
function leggiPagina(html) {
  const pezzi = html.split(/<h1>/i).slice(1);
  const out = [];
  pezzi.forEach((p) => {
    const nome = pulisci((/^([\s\S]*?)<\/h1>/i.exec(p) || [])[1]);
    const date = pulisci((/<h2>([\s\S]*?)<\/h2>/i.exec(p) || [])[1]);
    const h4 = [...p.matchAll(/<h4>([\s\S]*?)<\/h4>/gi)].map((x) => pulisci(x[1]));
    const tutte = date.match(/\d{2}-\d{2}-\d{4}/g) || [];
    const inizio = dataIso(tutte[0]);
    const fine = dataIso(tutte[1]) || inizio;
    if (!nome || !inizio) return;
    out.push({
      name: nome,
      start: inizio,
      end: fine,
      region: maiuscolaIniziale(h4[0] || ''),
      type: h4[1] || '',
      province: pulisci(campo(p, 'Provincia')),
      city: maiuscolaIniziale(pulisci(campo(p, 'Luogo'))),
      time: pulisci(campo(p, 'Tempo riflessione')),
      site: hrefDi(campo(p, 'Sito')),
      bando: hrefDi(campo(p, 'Bando')),
    });
  });
  return out;
}

async function caricaTornei() {
  const oggi = oggiItalia();
  const ultimo = piuGiorni(oggi, GIORNI_AVANTI);
  const q = new URLSearchParams({
    tipo_evento: '', den: '', reg: '', pro: '',
    dtiniric: piuGiorni(oggi, -GIORNI_INDIETRO),
    dtfinric: ultimo,
    ord: '1', senso: 'Asc', ric: '1',
  });
  const res = await fetch(CAL_URL + '?' + q.toString(), { headers: Object.assign({ Accept: 'text/html' }, UA), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' dalla Federscacchi');
  const html = await res.text();
  if (!/Trovati\s*<b>\s*\d+/i.test(html)) throw new Error('pagina della Federscacchi non riconosciuta');

  const visti = new Set();
  const tornei = leggiPagina(html).filter((t) => {
    if (/corso/i.test(t.type)) return false;         // corsi per istruttori e dirigenti
    if (t.end < oggi || t.start > ultimo) return false;
    const chiave = (t.name + '|' + t.start + '|' + t.city).toLowerCase();
    if (visti.has(chiave)) return false;              // doppioni
    visti.add(chiave);
    return true;
  }).map((t) => Object.assign(t, { ongoing: t.start <= oggi }));

  // prima quelli in corso, poi gli altri dal più vicino
  tornei.sort((a, b) => (b.ongoing - a.ongoing) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name, 'it'));
  return { oggi, tornei };
}

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=600',
    'Netlify-CDN-Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
  };
  if (cached && Date.now() - cachedAt < CACHE_MS && cached.today === oggiItalia()) {
    return { statusCode: 200, headers, body: JSON.stringify(cached) };
  }
  try {
    const { oggi, tornei } = await caricaTornei();
    const body = { items: tornei, today: oggi, source: CAL_URL, updatedAt: new Date().toISOString() };
    cached = body;
    cachedAt = Date.now();
    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    console.error('Calendario Federscacchi:', err.message);
    return {
      statusCode: 200,
      headers: Object.assign({}, headers, { 'Netlify-CDN-Cache-Control': 'public, max-age=300' }),
      body: JSON.stringify({ items: [], source: CAL_URL, error: 'non disponibile' }),
    };
  }
};

// per le prove
exports._leggiPagina = leggiPagina;
