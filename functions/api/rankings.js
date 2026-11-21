// Indirizzo pubblico: /api/rankings  (su Cloudflare Pages). Il codice vero è in netlify/functions/rankings.js
import { esegui } from '../../cloudflare/adattatore.js';

export function onRequestGet(ctx) {
  return esegui(ctx, () => import('../../netlify/functions/rankings.js'));
}
