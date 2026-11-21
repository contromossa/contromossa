// Indirizzo pubblico: /api/broadcasts  (su Cloudflare Pages). Il codice vero è in netlify/functions/broadcasts.js
import { esegui } from '../../cloudflare/adattatore.js';

export function onRequestGet(ctx) {
  return esegui(ctx, () => import('../../netlify/functions/broadcasts.js'));
}
