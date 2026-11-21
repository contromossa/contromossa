// Indirizzo pubblico: /api/check-live  (su Cloudflare Pages). Il codice vero è in netlify/functions/check-live.js
import { esegui } from '../../cloudflare/adattatore.js';

export function onRequestGet(ctx) {
  return esegui(ctx, () => import('../../netlify/functions/check-live.js'));
}
