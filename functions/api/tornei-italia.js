// Indirizzo pubblico: /api/tornei-italia  (su Cloudflare Pages). Il codice vero è in netlify/functions/tornei-italia.js
import { esegui } from '../../cloudflare/adattatore.js';

export function onRequestGet(ctx) {
  return esegui(ctx, () => import('../../netlify/functions/tornei-italia.js'));
}
