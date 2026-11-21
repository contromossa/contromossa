#!/usr/bin/env python3
"""Genera le pagine statiche del sito, pensate per Google.

Crea, partendo dai contenuti che già esistono:
  articoli/<nome>/index.html   una pagina per ogni articolo (da articoli/*.md)
  articoli/index.html          l'elenco degli articoli
  quiz/<nome>/index.html       una pagina per ogni quiz (da contenuti/quiz-elenco.json)
  quiz/index.html              l'elenco dei quiz
  podcast/<nome>/index.html    una pagina per ogni podcast (da contenuti/podcast.json)
  podcast/index.html           l'elenco dei podcast
  giocatori/<nome>/index.html  una pagina per ogni giocatore di strumenti/giocatori_famosi.txt
  giocatori/index.html         l'elenco dei giocatori
  sitemap.xml                  la mappa del sito per Google

Si lancia dalla cartella principale del sito:  python3 strumenti/genera_pagine.py
Va rilanciato ogni volta che si aggiunge un articolo, un quiz, un podcast o un giocatore.
Le pagine generate non vanno modificate a mano: si cambia la fonte e si rilancia.
"""
import datetime
import html
import json
import os
import re
import shutil
import unicodedata
from collections import Counter, defaultdict

SITO = 'https://contromossascacchi.it'
RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OGGI = datetime.date.today().isoformat()
IMMAGINE = SITO + '/icone/anteprima.png'

YOUTUBE = 'https://www.youtube.com/@contromossa.scacchi'
INSTAGRAM = 'https://www.instagram.com/contromossa.it'
TIKTOK = 'https://www.tiktok.com/@contromossa'
SPOTIFY = 'https://open.spotify.com/show/7eFf4XlZLatG2R0FZTaPUG'

MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
        'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

ECO = [('A00', 'A00', 'Aperture irregolari'), ('A01', 'A01', 'Apertura Larsen'), ('A02', 'A03', 'Apertura Bird'),
       ('A04', 'A09', 'Apertura Réti'), ('A10', 'A39', 'Partita Inglese'), ('A40', 'A44', 'Gioco di Donna, altre difese'),
       ('A45', 'A49', 'Difese indiane, altre'), ('A50', 'A79', 'Benoni e Benko'), ('A80', 'A99', 'Difesa Olandese'),
       ('B00', 'B00', 'Difese irregolari contro 1.e4'), ('B01', 'B01', 'Difesa Scandinava'), ('B02', 'B05', 'Difesa Alekhine'),
       ('B06', 'B06', 'Difesa Moderna'), ('B07', 'B09', 'Difesa Pirc'), ('B10', 'B19', 'Difesa Caro-Kann'),
       ('B20', 'B99', 'Difesa Siciliana'), ('C00', 'C19', 'Difesa Francese'), ('C20', 'C20', 'Partita di Re, altre'),
       ('C21', 'C22', 'Gambetto del Centro'), ('C23', 'C24', "Partita d'Alfiere"), ('C25', 'C29', 'Partita Viennese'),
       ('C30', 'C39', 'Gambetto di Re'), ('C40', 'C40', 'Partita di Re, altre'), ('C41', 'C41', 'Difesa Philidor'),
       ('C42', 'C43', 'Difesa Russa (Petrov)'), ('C44', 'C45', 'Partita Scozzese'), ('C46', 'C46', 'Tre Cavalli'),
       ('C47', 'C49', 'Quattro Cavalli'), ('C50', 'C54', 'Partita Italiana'), ('C55', 'C59', 'Difesa dei Due Cavalli'),
       ('C60', 'C99', 'Partita Spagnola'), ('D00', 'D05', 'Gioco di Donna, sistemi'), ('D06', 'D09', 'Gambetto di Donna, altre'),
       ('D10', 'D19', 'Difesa Slava'), ('D20', 'D29', 'Gambetto di Donna Accettato'), ('D30', 'D69', 'Gambetto di Donna Rifiutato'),
       ('D70', 'D99', 'Difesa Grünfeld'), ('E00', 'E09', 'Apertura Catalana'), ('E10', 'E10', 'Difese indiane, altre'),
       ('E11', 'E11', 'Difesa Bogo-Indiana'), ('E12', 'E19', 'Difesa Ovest-Indiana'), ('E20', 'E59', 'Difesa Nimzo-Indiana'),
       ('E60', 'E99', 'Difesa Est-Indiana')]

PAGINE = []  # (indirizzo, data) per la mappa del sito


def e(t):
    return html.escape(str(t), quote=True)


def slug(t):
    t = unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')


def data_it(iso):
    a, m, g = iso.split('-')
    return f'{int(g)} {MESI[int(m) - 1]} {a}'


def eco_nome(code):
    if not re.match(r'^[A-E]\d\d$', code or ''):
        return ''
    for a, b, n in ECO:
        if a <= code <= b:
            return n
    return ''


def corto(t, n=155):
    """Accorcia una descrizione per Google senza tagliare le parole."""
    t = ' '.join(str(t).split())
    if len(t) <= n:
        return t
    return t[:n].rsplit(' ', 1)[0].rstrip(',;:.') + '…'


def ld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace('</', '<\\/') + '</script>'


def pagina(percorso, titolo, descrizione, corpo, dati=None, tipo='website', data=None, briciole=None):
    """Scrive una pagina completa. percorso: es. 'articoli/kempelen/' (con la barra finale)."""
    url = SITO + '/' + percorso
    schema = [dati] if dati else []
    if briciole:
        schema.append({
            '@context': 'https://schema.org', '@type': 'BreadcrumbList',
            'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': SITO + '/' + u}
                                for i, (n, u) in enumerate(briciole)]
        })
    nav_briciole = ''
    if briciole:
        parti = []
        for i, (n, u) in enumerate(briciole):
            parti.append(f'<a href="/{e(u)}">{e(n)}</a>' if i < len(briciole) - 1 else f'<span aria-current="page">{e(n)}</span>')
        nav_briciole = '<nav class="briciole" aria-label="Percorso">' + ' <span aria-hidden="true">›</span> '.join(parti) + '</nav>'
    testo = f'''<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(titolo)}</title>
<meta name="description" content="{e(corto(descrizione))}">
<link rel="canonical" href="{e(url)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0a101d">
<meta property="og:type" content="{e(tipo)}">
<meta property="og:site_name" content="Contromossascacchi.it">
<meta property="og:locale" content="it_IT">
<meta property="og:title" content="{e(titolo)}">
<meta property="og:description" content="{e(corto(descrizione, 200))}">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{IMMAGINE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/icone/favicon-32.png">
<link rel="apple-touch-icon" href="/icone/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/stile-pagine.css">
{"".join(ld(s) for s in schema)}
</head>
<body>
<header class="testata">
  <a class="marchio" href="/" aria-label="Contromossascacchi.it, pagina iniziale">
    <img src="/icone/icon-192.png" alt="" width="36" height="36">
    <span>Contromossascacchi<em>.it</em></span>
  </a>
  <nav class="menu" aria-label="Sezioni">
    <a href="/#live-hub">Dirette</a>
    <a href="/#tornei">Tornei</a>
    <a href="/giocatori/">Giocatori</a>
    <a href="/articoli/">Articoli</a>
    <a href="/quiz/">Quiz</a>
    <a href="/podcast/">Podcast</a>
  </nav>
</header>
<main class="contenuto">
{nav_briciole}
{corpo}
</main>
<footer class="piede">
  <p><a href="/">Contromossascacchi.it</a>: gli scacchi italiani in un posto solo. Dirette, tornei, classifiche, 200.000 partite storiche, quiz e podcast.</p>
  <p class="social"><a href="{YOUTUBE}" rel="me">YouTube</a> · <a href="{INSTAGRAM}" rel="me">Instagram</a> · <a href="{TIKTOK}" rel="me">TikTok</a> · <a href="{SPOTIFY}" rel="me">Spotify</a> · <a href="mailto:contromossa.it@gmail.com">contromossa.it@gmail.com</a></p>
</footer>
</body>
</html>
'''
    cartella = os.path.join(RADICE, percorso)
    os.makedirs(cartella, exist_ok=True)
    with open(os.path.join(cartella, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(testo)
    PAGINE.append((url, data or OGGI))


# ---------------------------------------------------------------- articoli

def leggi_articolo(nome_file):
    testo = open(os.path.join(RADICE, 'articoli', nome_file), encoding='utf-8').read().replace('\r\n', '\n')
    m = re.match(r'^---\n(.*?)\n---\n?(.*)$', testo, re.S)
    meta = {}
    for riga in m.group(1).split('\n'):
        if ':' in riga:
            k, v = riga.split(':', 1)
            meta[k.strip()] = v.strip()
    blocchi = [b.strip() for b in re.split(r'\n\s*\n', m.group(2)) if b.strip()]
    return meta, blocchi


def blocco_html(b):
    righe = b.split('\n')
    if b.startswith('## '):
        return f'<h2>{e(b[3:].strip())}</h2>'
    if all(r.startswith('|') for r in righe):
        celle = [[c.strip() for c in r.strip().strip('|').split('|')] for r in righe
                 if not re.match(r'^\|[\s:|-]+\|?$', r.strip())]
        testa = ''.join(f'<th scope="col">{e(c)}</th>' for c in celle[0])
        corpo = ''.join('<tr>' + ''.join(f'<td>{e(c)}</td>' for c in r) + '</tr>' for r in celle[1:])
        return f'<div class="tabella"><table><thead><tr>{testa}</tr></thead><tbody>{corpo}</tbody></table></div>'
    if all(r.startswith('- ') for r in righe):
        voci = []
        for r in righe:
            t = r[2:].strip()
            if ':' in t:
                a, z = t.split(':', 1)
                voci.append(f'<li><strong>{e(a)}:</strong>{e(z)}</li>')
            else:
                voci.append(f'<li>{e(t)}</li>')
        return '<ul>' + ''.join(voci) + '</ul>'
    if b.startswith('> '):
        return '<blockquote><p>' + e(' '.join(r.lstrip('> ').strip() for r in righe)) + '</p></blockquote>'
    return '<p>' + e(' '.join(r.strip() for r in righe)) + '</p>'


def genera_articoli():
    indice = json.load(open(os.path.join(RADICE, 'articoli', 'indice.json'), encoding='utf-8'))
    date = {}
    p_date = os.path.join(RADICE, 'articoli', 'date.json')
    if os.path.exists(p_date):
        date = json.load(open(p_date, encoding='utf-8'))
    elenco = []
    for nome in indice:
        meta, blocchi = leggi_articolo(nome)
        s = nome[:-3]
        data = date.get(nome, OGGI)
        titolo = meta['titolo']
        riassunto = meta.get('riassunto', '')
        parole = sum(len(b.split()) for b in blocchi)
        minuti = max(1, round(parole / 220))
        corpo = (f'<article class="articolo">\n<p class="etichetta">{e(meta.get("etichetta", "Articolo"))}</p>\n'
                 f'<h1>{e(titolo)}</h1>\n<p class="sommario">{e(riassunto)}</p>\n'
                 f'<p class="meta-riga">{e(meta.get("fonte", "Contromossascacchi.it"))} · {data_it(data)} · lettura di circa {minuti} minuti</p>\n'
                 + '\n'.join(blocco_html(b) for b in blocchi) +
                 '\n</article>\n<aside class="riquadro"><p>Altri contenuti: <a href="/articoli/">tutti gli articoli</a>, '
                 '<a href="/quiz/">i quiz</a>, <a href="/podcast/">i podcast</a> e le <a href="/giocatori/">partite dei grandi campioni</a>.</p></aside>')
        dati = {'@context': 'https://schema.org', '@type': 'Article', 'headline': titolo[:110], 'description': riassunto,
                'inLanguage': 'it', 'datePublished': data, 'dateModified': data, 'image': IMMAGINE,
                'mainEntityOfPage': SITO + f'/articoli/{s}/',
                'author': {'@type': 'Organization', 'name': 'Contromossascacchi.it', 'url': SITO + '/'},
                'publisher': {'@type': 'Organization', 'name': 'Contromossascacchi.it', 'logo': {'@type': 'ImageObject', 'url': SITO + '/icone/icon-512.png'}}}
        titolo_pagina = (titolo if len(titolo) <= 70 else titolo.split(':')[0]) + ' | Contromossa'
        pagina(f'articoli/{s}/', titolo_pagina, riassunto, corpo, dati, 'article', data,
               [('Contromossa', ''), ('Articoli', 'articoli/'), (titolo.split(':')[0], f'articoli/{s}/')])
        elenco.append((s, titolo, riassunto, data))
    voci = ''.join(f'<li class="scheda"><h2><a href="/articoli/{s}/">{e(t)}</a></h2><p>{e(r)}</p><p class="meta-riga">{data_it(d)}</p></li>'
                   for s, t, r, d in elenco)
    pagina('articoli/', 'Articoli di scacchi: storia, campioni e curiosità | Contromossa',
           'Gli articoli di Contromossascacchi.it: storia degli scacchi, grandi campioni, sfide tra uomo e computer e curiosità dal mondo delle 64 caselle.',
           f'<h1>Articoli</h1><p class="sommario">Storie, campioni e curiosità dal mondo degli scacchi, scritti per Contromossa.</p><ul class="elenco">{voci}</ul>',
           briciole=[('Contromossa', ''), ('Articoli', 'articoli/')])


# ---------------------------------------------------------------- quiz

QUIZ_JS = '''<script>
(function () {
  var giuste = 0, date = 0, tot = document.querySelectorAll('.domanda').length;
  function mescola(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  document.querySelectorAll('.domanda').forEach(function (d) {
    var box = d.querySelector('.risposte'), bott = Array.prototype.slice.call(box.children);
    mescola(bott).forEach(function (b) { box.appendChild(b); });
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b || d.classList.contains('fatta')) return;
      d.classList.add('fatta'); date++;
      var ok = b.hasAttribute('data-giusta'); if (ok) giuste++;
      box.querySelectorAll('button').forEach(function (x) { x.disabled = true; if (x.hasAttribute('data-giusta')) x.classList.add('ok'); });
      if (!ok) b.classList.add('ko');
      d.querySelector('.esito').textContent = ok ? 'Giusto!' : 'Risposta sbagliata.';
      if (date === tot) {
        var f = null; document.querySelectorAll('.fascia').forEach(function (x) { if (giuste >= +x.getAttribute('data-da')) f = x; });
        var r = document.getElementById('risultato');
        r.querySelector('.punti').textContent = giuste + ' su ' + tot;
        document.querySelectorAll('.fascia').forEach(function (x) { x.hidden = x !== f; });
        r.hidden = false; r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
})();
</script>'''


def genera_quiz():
    elenco_q = json.load(open(os.path.join(RADICE, 'contenuti', 'quiz-elenco.json'), encoding='utf-8'))
    voci = []
    for q in elenco_q:
        dati_q = json.load(open(os.path.join(RADICE, q['file']), encoding='utf-8'))
        s = slug(dati_q['titolo'])
        domande = ''
        for i, d in enumerate(dati_q['domande'], 1):
            risposte = ''.join(f'<button type="button"{" data-giusta" if k == d["corretta"] else ""}>{e(r)}</button>'
                               for k, r in enumerate(d['risposte']))
            domande += (f'<li class="domanda"><p class="testo"><span class="num">{i}.</span> {e(d["domanda"])}</p>'
                        f'<div class="risposte">{risposte}</div><p class="esito" aria-live="polite"></p></li>')
        fasce = ''.join(f'<div class="fascia" data-da="{f["da"]}" hidden><h3>{e(f["titolo"])}</h3><p>{e(f["testo"])}</p></div>'
                        for f in dati_q['fasce'])
        corpo = (f'<p class="etichetta">Quiz · {data_it(q["data"])}</p><h1>{e(dati_q["titolo"])}</h1>'
                 f'<p class="sommario">{e(dati_q["introduzione"])}</p><ol class="quiz">{domande}</ol>'
                 f'<div id="risultato" class="riquadro" hidden><p class="etichetta">Risultato</p><p class="punti"></p>{fasce}'
                 '<p><a href="/quiz/">Prova gli altri quiz</a></p></div>' + QUIZ_JS)
        dati = {'@context': 'https://schema.org', '@type': 'Quiz', 'name': dati_q['titolo'], 'description': dati_q['introduzione'],
                'inLanguage': 'it', 'educationalLevel': 'principiante', 'about': {'@type': 'Thing', 'name': 'Scacchi'},
                'datePublished': q['data'], 'url': SITO + f'/quiz/{s}/'}
        titolo_pag = dati_q['titolo'].rstrip('?') + ': quiz di scacchi | Contromossa'
        pagina(f'quiz/{s}/', titolo_pag, (dati_q['introduzione'] + ' Mettiti alla prova.'), corpo, dati, 'website', q['data'],
               [('Contromossa', ''), ('Quiz', 'quiz/'), (dati_q['titolo'], f'quiz/{s}/')])
        voci.append(f'<li class="scheda"><h2><a href="/quiz/{s}/">{e(dati_q["titolo"])}</a></h2><p>{e(dati_q["introduzione"])}</p><p class="meta-riga">{data_it(q["data"])}</p></li>')
    pagina('quiz/', 'Quiz di scacchi: trappole, storia e campioni | Contromossa',
           'Quiz di scacchi gratuiti, dieci domande ciascuno: trappole d\'apertura, tattica, storia e curiosità sui campioni. Scopri il tuo livello.',
           f'<h1>Quiz di scacchi</h1><p class="sommario">Dieci domande per quiz, con la risposta subito dopo ogni scelta. Un quiz nuovo ogni settimana.</p><ul class="elenco">{"".join(voci)}</ul>',
           briciole=[('Contromossa', ''), ('Quiz', 'quiz/')])


# ---------------------------------------------------------------- podcast

def durata_iso(testo):
    m = re.search(r'(\d+)', testo or '')
    return f'PT{m.group(1)}M' if m else None


def genera_podcast():
    lista = json.load(open(os.path.join(RADICE, 'contenuti', 'podcast.json'), encoding='utf-8'))
    voci = []
    for p in lista:
        s = os.path.splitext(os.path.basename(p['file']))[0]
        lettore = ''
        if p.get('spotify'):
            lettore = (f'<iframe class="spotify" title="Ascolta su Spotify: {e(p["titolo"])}" loading="lazy" '
                       f'src="https://open.spotify.com/embed/episode/{e(p["spotify"])}" height="152" '
                       'allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>'
                       f'<p><a href="https://open.spotify.com/episode/{e(p["spotify"])}">Apri l\'episodio su Spotify</a> · '
                       f'<a href="{SPOTIFY}">tutti gli episodi di «Contromossa – Scacchi &amp; Curiosità»</a></p>')
        else:
            lettore = f'<audio controls preload="none" src="/{e(p["file"])}"></audio>'
        corpo = (f'<p class="etichetta">Podcast · {e(p.get("durata", ""))} · {data_it(p["data"])}</p><h1>{e(p["titolo"])}</h1>'
                 f'<p class="sommario">{e(p.get("descrizione", ""))}</p>{lettore}'
                 '<aside class="riquadro"><p>Il podcast di Contromossa racconta storie, manie e curiosità degli scacchi. '
                 '<a href="/podcast/">Tutti gli episodi</a> · <a href="/quiz/">Mettiti alla prova con i quiz</a></p></aside>')
        dati = {'@context': 'https://schema.org', '@type': 'PodcastEpisode', 'name': p['titolo'], 'description': p.get('descrizione', ''),
                'inLanguage': 'it', 'datePublished': p['data'], 'url': SITO + f'/podcast/{s}/',
                'partOfSeries': {'@type': 'PodcastSeries', 'name': 'Contromossa – Scacchi & Curiosità', 'url': SPOTIFY}}
        if durata_iso(p.get('durata')):
            dati['timeRequired'] = durata_iso(p.get('durata'))
        if p.get('spotify'):
            dati['sameAs'] = f'https://open.spotify.com/episode/{p["spotify"]}'
        pagina(f'podcast/{s}/', f'{p["titolo"]} | Podcast di scacchi Contromossa', p.get('descrizione', ''), corpo, dati,
               'article', p['data'], [('Contromossa', ''), ('Podcast', 'podcast/'), (p['titolo'], f'podcast/{s}/')])
        voci.append(f'<li class="scheda"><h2><a href="/podcast/{s}/">{e(p["titolo"])}</a></h2><p>{e(p.get("descrizione", ""))}</p>'
                    f'<p class="meta-riga">{e(p.get("durata", ""))} · {data_it(p["data"])}</p></li>')
    pagina('podcast/', 'Podcast di scacchi in italiano: storie e curiosità | Contromossa',
           'Il podcast di Contromossa: storie, manie e curiosità degli scacchi, da Fischer a Karpov, dai caffè storici alle dirette su Twitch.',
           f'<h1>Podcast di scacchi</h1><p class="sommario">«Contromossa – Scacchi &amp; Curiosità»: storie e curiosità degli scacchi, in italiano. Si ascolta qui o su <a href="{SPOTIFY}">Spotify</a>.</p><ul class="elenco">{"".join(voci)}</ul>',
           briciole=[('Contromossa', ''), ('Podcast', 'podcast/')])


# ---------------------------------------------------------------- giocatori

def genera_giocatori():
    info = json.load(open(os.path.join(RADICE, 'archivio', 'info.json'), encoding='utf-8'))
    tutti = {x[0]: x for x in json.load(open(os.path.join(RADICE, 'archivio', 'giocatori.json'), encoding='utf-8'))}
    scelti = []
    for riga in open(os.path.join(RADICE, 'strumenti', 'giocatori_famosi.txt'), encoding='utf-8'):
        riga = riga.strip()
        if not riga or riga.startswith('#'):
            continue
        parti = [x.strip() for x in riga.split('|')]
        nome, mostra, nota = parti[0], parti[1], (parti[2] if len(parti) > 2 else '')
        if nome not in tutti:
            print('ATTENZIONE: non trovato nell\'archivio:', nome)
            continue
        scelti.append((nome, mostra, nota))
    nomi_scelti = {n: m for n, m, _ in scelti}
    slugs = {n: slug(m) for n, m, _ in scelti}
    gruppi = {}
    voci = []
    for nome, mostra, nota in scelti:
        _, n_partite, g, y0, y1 = tutti[nome]
        if g not in gruppi:
            gruppi[g] = json.load(open(os.path.join(RADICE, 'archivio', 'g', f'{g}.json'), encoding='utf-8'))
        partite = gruppi[g][nome]
        v = p = s_ = 0
        col = {'b': [0, 0, 0], 'n': [0, 0, 0]}
        aperture = Counter()
        avversari = defaultdict(lambda: [0, 0, 0])
        for r in partite:
            bianco = r[1] == nome
            avv = r[2] if bianco else r[1]
            ris = r[4]
            if ris == '1/2-1/2':
                esito = 1
            elif (ris == '1-0') == bianco and ris in ('1-0', '0-1'):
                esito = 0
            elif ris in ('1-0', '0-1'):
                esito = 2
            else:
                continue
            if esito == 0:
                v += 1
            elif esito == 1:
                p += 1
            else:
                s_ += 1
            col['b' if bianco else 'n'][esito] += 1
            avversari[avv][esito] += 1
            n_ap = eco_nome(r[5])
            if n_ap:
                aperture[(n_ap, 'b' if bianco else 'n')] += 1
        tot = v + p + s_
        perc = round((v + p / 2) * 100 / tot) if tot else 0
        url_arch = '/?giocatore=' + re.sub(r' ', '+', nome) + '#partite'
        # aperture più giocate, con il Bianco e con il Nero
        ap_b = [a for (a, c), _ in aperture.most_common() if c == 'b'][:3]
        ap_n = [a for (a, c), _ in aperture.most_common() if c == 'n'][:3]
        # avversari più frequenti
        top_avv = sorted(avversari.items(), key=lambda kv: -sum(kv[1]))[:10]
        righe_avv = ''
        for a, (va, pa, sa) in top_avv:
            nome_a = nomi_scelti.get(a, a)
            link_a = f'<a href="/giocatori/{slugs[a]}/">{e(nome_a)}</a>' if a in slugs else e(nome_a)
            link_p = '/?giocatore=' + nome.replace(' ', '+') + '&avversario=' + a.split(' ')[-1].replace(' ', '+') + '#partite'
            righe_avv += (f'<tr><td>{link_a}</td><td>{va + pa + sa}</td><td>{va}</td><td>{pa}</td><td>{sa}</td>'
                          f'<td><a href="{e(link_p)}">Vedi le partite</a></td></tr>')
        # sfide con altri grandi presenti nel sito
        grandi = sorted([(a, r) for a, r in avversari.items() if a in slugs and a != nome], key=lambda kv: -sum(kv[1]))[:12]
        frase_grandi = ''
        if grandi:
            frase_grandi = ('<p>Tra gli avversari ci sono altri grandi del sito: ' +
                            ', '.join(f'<a href="/giocatori/{slugs[a]}/">{e(nomi_scelti[a])}</a>' for a, _ in grandi) + '.</p>')
        nota_html = f'<p class="nota">{e(nota)}</p>' if nota else ''
        periodo = f'dal {y0} al {y1}' if y0 != y1 else f'nel {y0}'
        # (le migliaia si scrivono con il punto, all'italiana)
        def n_it(x):
            return f'{x:,}'.replace(',', '.')
        corpo = (f'<p class="etichetta">Giocatori · partite storiche</p><h1>{e(mostra)}: partite e statistiche</h1>{nota_html}'
                 f'<p class="sommario">Nell\'archivio di Contromossa ci sono <strong>{n_it(n_partite)}</strong> partite di {e(mostra)}, '
                 f'giocate {periodo}. Si possono rivedere una per una, mossa dopo mossa, sulla scacchiera del sito.</p>'
                 f'<p><a class="bottone" href="{e(url_arch)}">Rivedi le partite di {e(mostra)}</a></p>'
                 f'<h2>Il bilancio nell\'archivio</h2>'
                 f'<div class="numeri"><div><span>{n_it(v)}</span>vittorie</div><div><span>{n_it(p)}</span>patte</div>'
                 f'<div><span>{n_it(s_)}</span>sconfitte</div><div><span>{perc}%</span>dei punti</div></div>'
                 f'<p>Con il Bianco: {n_it(col["b"][0])} vittorie, {n_it(col["b"][1])} patte e {n_it(col["b"][2])} sconfitte. '
                 f'Con il Nero: {n_it(col["n"][0])} vittorie, {n_it(col["n"][1])} patte e {n_it(col["n"][2])} sconfitte.</p>'
                 + (f'<h2>Le aperture più giocate</h2><p>Con il Bianco: {e(", ".join(ap_b))}.</p>' if ap_b else '')
                 + (f'<p>Con il Nero: {e(", ".join(ap_n))}.</p>' if ap_n else '')
                 + f'<h2>Gli avversari più affrontati</h2><div class="tabella"><table><thead><tr><th scope="col">Avversario</th><th scope="col">Partite</th>'
                 f'<th scope="col">Vinte</th><th scope="col">Patte</th><th scope="col">Perse</th><th scope="col"><span class="nascosto">Collegamento</span></th></tr></thead><tbody>{righe_avv}</tbody></table></div>'
                 + frase_grandi +
                 f'<p class="fonte">I numeri valgono per le partite presenti nell\'archivio, non per tutta la carriera. '
                 f'Fonte: <a href="{e(info["fonte_url"])}">Chess Database</a> di Ana Schaigorodsky (Figshare, 2016), licenza CC BY 4.0, '
                 f'selezionato e ripulito da Contromossa.</p>'
                 '<p><a href="/giocatori/">Tutti i giocatori</a></p>')
        s = slugs[nome]
        descr = (f'{n_it(n_partite)} partite di {mostra} ({y0}–{y1}) da rivedere mossa per mossa: bilancio, aperture preferite '
                 f'e avversari più affrontati.')
        dati = {'@context': 'https://schema.org', '@type': 'ProfilePage', 'name': f'{mostra}: partite e statistiche',
                'inLanguage': 'it', 'url': SITO + f'/giocatori/{s}/',
                'mainEntity': {'@type': 'Person', 'name': mostra, 'description': nota or f'Scacchista, partite dal {y0} al {y1}.'}}
        pagina(f'giocatori/{s}/', f'{mostra}: partite di scacchi e statistiche | Contromossa', descr, corpo, dati, 'profile',
               OGGI, [('Contromossa', ''), ('Giocatori', 'giocatori/'), (mostra, f'giocatori/{s}/')])
        voci.append((mostra, s, n_partite, y0, y1, bool(nota and 'campione del mondo' in nota)))
    campioni = [x for x in voci if x[5]]
    campioni.sort(key=lambda x: x[3])
    altri = sorted([x for x in voci if not x[5]], key=lambda x: x[0])

    def lista(xs):
        return '<ul class="griglia">' + ''.join(f'<li><a href="/giocatori/{s}/">{e(m)}</a><span>{f"{n:,}".replace(",", ".")} partite · {y0}–{y1}</span></li>'
                                                for m, s, n, y0, y1, _ in xs) + '</ul>'
    corpo = ('<h1>Grandi giocatori di scacchi: partite e statistiche</h1>'
             f'<p class="sommario">{len(voci)} campioni della storia degli scacchi, con il bilancio, le aperture più giocate e gli avversari più affrontati. '
             f'Le partite vengono dall\'archivio di Contromossa ({f"{info["partite"]:,}".replace(",", ".")} partite dal {info["anni"][0]} al {info["anni"][1]}) e si rivedono mossa per mossa.</p>'
             f'<h2>I campioni del mondo</h2>{lista(campioni)}<h2>Gli altri grandi</h2>{lista(altri)}')
    pagina('giocatori/', 'Grandi giocatori di scacchi: partite e statistiche | Contromossa',
           'Le partite dei grandi campioni di scacchi, da Morphy a Kasparov e Carlsen: bilanci, aperture preferite e avversari, con le partite da rivedere mossa per mossa.',
           corpo, briciole=[('Contromossa', ''), ('Giocatori', 'giocatori/')])
    return len(voci)


# ---------------------------------------------------------------- mappa del sito

def genera_sitemap():
    righe = [f'<url><loc>{SITO}/</loc><lastmod>{OGGI}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>']
    for url, d in PAGINE:
        righe.append(f'<url><loc>{e(url)}</loc><lastmod>{d}</lastmod></url>')
    with open(os.path.join(RADICE, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + '\n'.join(righe) + '\n</urlset>\n')


if __name__ == '__main__':
    for cartella in ('quiz', 'podcast', 'giocatori'):
        shutil.rmtree(os.path.join(RADICE, cartella), ignore_errors=True)
    for voce in os.listdir(os.path.join(RADICE, 'articoli')):
        percorso = os.path.join(RADICE, 'articoli', voce)
        if os.path.isdir(percorso):
            shutil.rmtree(percorso)
    if os.path.exists(os.path.join(RADICE, 'articoli', 'index.html')):
        os.remove(os.path.join(RADICE, 'articoli', 'index.html'))
    genera_articoli()
    genera_quiz()
    genera_podcast()
    n = genera_giocatori()
    genera_sitemap()
    print(f'Pagine create: {len(PAGINE)} (di cui {n} giocatori). Mappa del sito: sitemap.xml')
