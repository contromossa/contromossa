// Indirizzo pubblico: /api/didattica  (su Cloudflare Pages). Il codice vero è in netlify/functions/didattica.js
import { esegui } from '../../cloudflare/adattatore.js';

export function onRequestGet(ctx) {
  return esegui(ctx, () => import('../../netlify/functions/didattica.js'));
}
