// Adattatore: fa girare su Cloudflare Pages le funzioni scritte per Netlify (cartella netlify/functions),
// senza riscriverle. Le funzioni restano una sola copia; qui si traducono solo ingresso e uscita.
//
// - Le chiavi segrete (TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, YOUTUBE_API_KEY) si impostano nelle
//   impostazioni del progetto Cloudflare e arrivano in ctx.env: le copiamo in process.env prima di
//   caricare la funzione, perché le funzioni le leggono da lì.
// - Le intestazioni che valgono solo per Netlify vengono tolte.

export async function esegui(ctx, carica) {
  const env = ctx.env || {};
  globalThis.process = globalThis.process || { env: {} };
  globalThis.process.env = globalThis.process.env || {};
  for (const k of ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'YOUTUBE_API_KEY']) {
    if (typeof env[k] === 'string' && env[k]) globalThis.process.env[k] = env[k];
  }
  try {
    const m = await carica();
    const handler = m.handler || (m.default && m.default.handler);
    const url = new URL(ctx.request.url);
    const r = await handler({
      httpMethod: ctx.request.method,
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(ctx.request.headers),
    });
    const headers = new Headers(r.headers || {});
    headers.delete('Netlify-CDN-Cache-Control');
    return new Response(r.body, { status: r.statusCode || 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'non disponibile' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
