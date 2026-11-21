// Indirizzo pubblico: /api/news  (su Cloudflare Pages). Il codice vero è in netlify/functions/news.js
import { esegui } from '../../cloudflare/adattatore.js';

export function onRequestGet(ctx) {
  return esegui(ctx, () => import('../../netlify/functions/news.js'));
}
