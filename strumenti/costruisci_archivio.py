#!/usr/bin/env python3
"""
Costruisce l'archivio delle partite storiche di Contromossascacchi.it.

Legge un grande file PGN (anche dentro uno .zip), sceglie le partite da tenere,
toglie i doppioni, controlla che le mosse siano legali e scrive i file statici
che il sito carica solo quando servono:

  archivio/info.json        numeri generali e fonte
  archivio/giocatori.json   elenco giocatori: [nome, partite, gruppo, primo anno, ultimo anno]
  archivio/g/<gruppo>.json  per ogni giocatore, l'elenco delle sue partite (solo intestazioni)
  archivio/m/<blocco>.json  le mosse, 1000 partite per file

Uso:
  python3 costruisci_archivio.py all.pgn.zip ../archivio --max 200000

Richiede: pip install chess
"""
import argparse, collections, io, json, os, re, shutil, sys, time, unicodedata, zipfile, zlib

import chess

GRUPPI = 1024          # numero di file di intestazioni
# quante partite tenere per ogni epoca (su 200.000; si scalano con --max).
# None = tutte. Le quote non usate passano all'epoca successiva.
EPOCHE = [(0, 1900, None), (1900, 1950, 45000), (1950, 1970, 50000), (1970, 1990, 52000), (1990, 9999, 45000)]
BLOCCO = 1000          # partite per file di mosse

TAG_RE = re.compile(r'^\[(\w+)\s+"(.*)"\]\s*$')
COMMENT_RE = re.compile(r'\{[^}]*\}|;[^\n]*')
NAG_RE = re.compile(r'\$\d+')
NUM_RE = re.compile(r'\d+\.(\.\.)?')
RESULT_TOKENS = {'1-0', '0-1', '1/2-1/2', '*'}
# eventi da non includere: simultanee, partite lampo e online
ESCLUSI = re.compile(r'\bsimul|\bsim\b|\bsimultan|blitz|bullet|lightning|\bicc\b|\bfics\b|internet|online|playchess|\bkgs\b', re.I)


# ---------------------------------------------------------------- lettura PGN

def decodifica(riga):
    try:
        return riga.decode('utf-8')
    except UnicodeDecodeError:
        return riga.decode('latin-1')


def apri_testo(percorso):
    """Righe di testo del PGN; accetta UTF-8 e, riga per riga, il vecchio Latin-1."""
    if percorso.lower().endswith('.zip'):
        z = zipfile.ZipFile(percorso)
        nomi = [n for n in z.namelist() if n.lower().endswith('.pgn')]
        if not nomi:
            sys.exit('Nello zip non c\'è nessun file .pgn')
        for n in nomi:
            with z.open(n) as f:
                for riga in f:
                    yield decodifica(riga)
    else:
        with open(percorso, 'rb') as f:
            for riga in f:
                yield decodifica(riga)


def leggi_partite(percorso):
    """Restituisce (intestazioni, testo delle mosse) per ogni partita, senza controllarle."""
    tags, mosse, in_mosse = {}, [], False
    for riga in apri_testo(percorso):
        s = riga.strip()
        if s.startswith('[') and s.endswith(']'):
            if in_mosse:
                yield tags, ' '.join(mosse)
                tags, mosse, in_mosse = {}, [], False
            m = TAG_RE.match(s)
            if m:
                tags[m.group(1)] = m.group(2)
        elif s:
            in_mosse = True
            mosse.append(s)
    if tags or mosse:
        yield tags, ' '.join(mosse)


def pulisci_mosse(testo):
    testo = COMMENT_RE.sub(' ', testo)
    # toglie le varianti tra parentesi, anche annidate
    while '(' in testo:
        nuovo = re.sub(r'\([^()]*\)', ' ', testo)
        if nuovo == testo:
            break
        testo = nuovo
    testo = NAG_RE.sub(' ', testo)
    testo = NUM_RE.sub(' ', testo)
    return [t for t in testo.split() if t not in RESULT_TOKENS and not t.endswith('.')]


# ---------------------------------------------------------------- nomi

def senza_accenti(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def chiave_nome(nome):
    """'Kasparov, Garry' / 'Kasparov,G.' / 'Garry Kasparov' -> 'kasparov g'."""
    n = senza_accenti(nome).lower().strip()
    n = re.sub(r'\s+', ' ', n)
    if not n or n in ('?', 'nn', 'n.n.', 'unknown'):
        return ''
    if re.search(r'[/+&]| and | e | und | team|allies|amateur|consult|computer|program', n):
        return ''   # partite in consultazione, a squadre o contro programmi
    if ',' in n:
        cognome, _, nomi = n.partition(',')
    else:
        parti = n.split(' ')
        cognome, nomi = (parti[-1], ' '.join(parti[:-1])) if len(parti) > 1 else (n, '')
    cognome = re.sub(r'[^a-z\- ]', '', cognome).strip()
    iniziale = re.sub(r'[^a-z]', '', nomi)[:1]
    return (cognome + (' ' + iniziale if iniziale else '')).strip()


def nome_leggibile(nome):
    """'Kasparov, Garry' -> 'Garry Kasparov'."""
    n = re.sub(r'\s+', ' ', nome).strip()
    if ',' in n:
        cognome, _, nomi = n.partition(',')
        nomi = nomi.strip()
        if nomi:
            return nomi + ' ' + cognome.strip()
        return cognome.strip()
    return n


def anno(tags):
    m = re.match(r'(\d{4})', tags.get('Date', '') or tags.get('UTCDate', ''))
    a = int(m.group(1)) if m else 0
    return a if 1475 <= a <= 2030 else 0


def elo(tags, chiave):
    try:
        return int(tags.get(chiave, '0') or 0)
    except ValueError:
        return 0


# ---------------------------------------------------------------- costruzione

def costruisci(sorgente, uscita, massimo, min_mosse, elo_minimo, anno_storico, min_partite_storico):
    t0 = time.time()

    # 1° passaggio: statistiche dei giocatori
    print('1/3  Leggo l\'archivio e conto le partite di ogni giocatore…')
    conteggi = collections.Counter()
    elo_max = collections.defaultdict(int)
    forme = collections.defaultdict(collections.Counter)
    totale = 0
    for tags, _ in leggi_partite(sorgente):
        totale += 1
        for lato, tag_elo in (('White', 'WhiteElo'), ('Black', 'BlackElo')):
            k = chiave_nome(tags.get(lato, ''))
            if not k:
                continue
            conteggi[k] += 1
            elo_max[k] = max(elo_max[k], elo(tags, tag_elo))
            forme[k][tags.get(lato, '').strip()] += 1
        if totale % 200000 == 0:
            print(f'     {totale:,} partite lette')
    print(f'     {totale:,} partite, {len(conteggi):,} giocatori')

    def notevole(k):
        # giocatore forte (Elo alto) oppure giocatore dell'epoca senza Elo con molte partite
        return elo_max[k] >= elo_minimo or conteggi[k] >= min_partite_storico

    # 2° passaggio: scelta e doppioni (tiene in memoria solo numeri, non le mosse)
    print('2/3  Scelgo le partite e tolgo i doppioni…')
    candidati = []          # (forza, numero della partita nel file)
    visti = set()
    scartate = collections.Counter()
    for numero, (tags, testo) in enumerate(leggi_partite(sorgente)):
        kb, kn = chiave_nome(tags.get('White', '')), chiave_nome(tags.get('Black', ''))
        if not kb or not kn or kb == kn:
            scartate['nomi mancanti'] += 1
            continue
        if tags.get('SetUp') == '1' or tags.get('FEN'):
            scartate['posizione iniziale diversa'] += 1
            continue
        if ESCLUSI.search(tags.get('Event', '') or ''):
            scartate['simultanee, blitz o partite online'] += 1
            continue
        a = anno(tags)
        storico = a and a < anno_storico
        if not (notevole(kb) and notevole(kn)) and not (storico and (notevole(kb) or notevole(kn))):
            scartate['giocatori minori'] += 1
            continue
        mosse = pulisci_mosse(testo)
        if len(mosse) < min_mosse:
            scartate['troppo corte'] += 1
            continue
        impronta = zlib.crc32((kb + '|' + kn + '|' + str(a) + '|' + ' '.join(mosse[:40])).encode())
        if impronta in visti:
            scartate['doppioni'] += 1
            continue
        visti.add(impronta)
        # priorità: prima tutte le partite storiche, poi le moderne in cui
        # anche il giocatore più debole dei due è forte
        # dentro ogni epoca: prima le partite in cui anche il più debole dei due è forte
        epoca = next((i for i, (da, a_, _) in enumerate(EPOCHE) if da <= (a or 9998) < a_), len(EPOCHE) - 1)
        forza = (min(elo_max[kb], elo_max[kn]), min(conteggi[kb], conteggi[kn]))
        candidati.append((epoca, forza, numero))
    del visti
    print(f'     {len(candidati):,} partite candidate')
    candidati.sort(reverse=True)
    per_epoca = collections.defaultdict(list)
    for e, f, n in candidati:
        per_epoca[e].append(n)
    del candidati
    scala = massimo / 200000
    margine = 1.05
    scelte_ordinate, riporto = [], 0
    for e, (da, a_, quota) in enumerate(EPOCHE):
        lista = per_epoca.get(e, [])
        q = len(lista) if quota is None else int(quota * scala) + riporto
        q = min(q, int(massimo * margine) - len(scelte_ordinate))
        presi = lista[:int(q * margine) if quota is not None else q]
        riporto = max(0, q - len(presi)) if quota is not None else 0
        scelte_ordinate.extend(presi)
        print(f'     epoca {da or "inizio"}–{a_ - 1 if a_ < 9999 else "oggi"}: {len(lista):,} candidate, {len(presi):,} scelte')
    # le partite con mosse illegali vengono sostituite dalle successive
    scelti = set(scelte_ordinate)
    ordine = {n: i for i, n in enumerate(scelte_ordinate)}
    del per_epoca, scelte_ordinate

    print('     controllo le mosse delle partite scelte…')
    prese = []
    for numero, (tags, testo) in enumerate(leggi_partite(sorgente)):
        if numero not in scelti:
            continue
        board = chess.Board()
        san = []
        try:
            for m in pulisci_mosse(testo):
                mv = board.parse_san(m)
                san.append(board.san(mv))
                board.push(mv)
        except Exception:
            scartate['mosse illegali'] += 1
            continue
        kb, kn = chiave_nome(tags['White']), chiave_nome(tags['Black'])
        piccoli = {k: tags.get(k, '') for k in ('Event', 'Site', 'Result', 'ECO')}
        prese.append((ordine[numero], piccoli, san, kb, kn, anno(tags)))
    prese.sort(key=lambda x: x[0])
    tenute = [x[1:] for x in prese[:massimo]]
    del prese
    print(f'     tenute {len(tenute):,} partite')
    for motivo, n in scartate.most_common():
        print(f'     scartate per {motivo}: {n:,}')

    # ordine: per anno, così i blocchi di mosse sono compatti
    tenute.sort(key=lambda x: (x[4] or 9999, x[2], x[3]))

    # 3° passaggio: scrittura dei file
    print('3/3  Scrivo i file del sito…')
    if os.path.exists(uscita):
        shutil.rmtree(uscita)
    os.makedirs(os.path.join(uscita, 'g'))
    os.makedirs(os.path.join(uscita, 'm'))

    cache_nomi = {}

    def nome_mostrato(k):
        # tra le grafie usate sceglie quella con il nome di battesimo più completo,
        # a parità la più frequente: 'Kasparov, Garry' batte 'Kasparov,G'
        if k not in cache_nomi:
            def punteggio(voce):
                forma, n = voce
                nomi = forma.partition(',')[2] if ',' in forma else ' '.join(forma.split()[:-1])
                pulita = not re.search(r'[/+&()]', forma)
                return (pulita, min(len(re.sub(r'[^A-Za-zÀ-ÿ]', '', nomi)), 6), n)
            forma = max(forme[k].items(), key=punteggio)[0] if forme[k] else k
            cache_nomi[k] = nome_leggibile(forma)
        return cache_nomi[k]

    per_giocatore = collections.defaultdict(list)
    anni = collections.defaultdict(list)
    blocchi = collections.defaultdict(list)
    for gid, (tags, san, kb, kn, a) in enumerate(tenute):
        blocchi[gid // BLOCCO].append(' '.join(san))
        bianco, nero = nome_mostrato(kb), nome_mostrato(kn)
        evento = (tags.get('Event', '') or '').strip()
        if evento in ('?', '-'):
            evento = ''
        luogo = (tags.get('Site', '') or '').strip()
        if luogo not in ('?', '-', '') and luogo.lower() not in evento.lower():
            evento = (evento + ' · ' + luogo) if evento else luogo
        riga = [gid, bianco, nero, a, tags.get('Result', '*'), tags.get('ECO', ''), evento[:80], len(san)]
        for k in (kb, kn):
            per_giocatore[k].append(riga)
            if a:
                anni[k].append(a)

    for b, lista in blocchi.items():
        with open(os.path.join(uscita, 'm', f'{b}.json'), 'w', encoding='utf-8') as f:
            json.dump(lista, f, ensure_ascii=False, separators=(',', ':'))

    gruppi = collections.defaultdict(dict)
    indice = []
    for k, righe in per_giocatore.items():
        g = zlib.crc32(k.encode()) % GRUPPI
        nome = nome_mostrato(k)
        righe.sort(key=lambda r: (r[3] or 9999, r[0]))
        gruppi[g][nome] = righe
        indice.append([nome, len(righe), g, min(anni[k]) if anni[k] else 0, max(anni[k]) if anni[k] else 0])
    for g, contenuto in gruppi.items():
        with open(os.path.join(uscita, 'g', f'{g}.json'), 'w', encoding='utf-8') as f:
            json.dump(contenuto, f, ensure_ascii=False, separators=(',', ':'))
    indice.sort(key=lambda r: -r[1])
    with open(os.path.join(uscita, 'giocatori.json'), 'w', encoding='utf-8') as f:
        json.dump(indice, f, ensure_ascii=False, separators=(',', ':'))

    anni_tutti = [x[4] for x in tenute if x[4]]
    info = {
        'partite': len(tenute),
        'giocatori': len(indice),
        'anni': [min(anni_tutti), max(anni_tutti)] if anni_tutti else [0, 0],
        'blocco': BLOCCO,
        'fonte': 'Chess Database di Ana Schaigorodsky (Figshare, 2016), licenza CC BY 4.0',
        'fonte_url': 'https://doi.org/10.6084/m9.figshare.4276523',
        'costruito': time.strftime('%Y-%m-%d'),
    }
    with open(os.path.join(uscita, 'info.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=1)

    peso = sum(os.path.getsize(os.path.join(d, n)) for d, _, ns in os.walk(uscita) for n in ns)
    print(f'     fatto in {time.time() - t0:.0f} secondi · {len(indice):,} giocatori · {peso / 1e6:.1f} MB')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('sorgente', help='file .pgn oppure .zip che contiene file .pgn')
    p.add_argument('uscita', help='cartella da creare (viene sostituita)')
    p.add_argument('--max', type=int, default=200000, help='numero massimo di partite (predefinito 200000)')
    p.add_argument('--min-mosse', type=int, default=10, help='scarta le partite più corte (in semimosse)')
    p.add_argument('--elo', type=int, default=2500, help='Elo massimo raggiunto per considerare un giocatore forte')
    p.add_argument('--anno-storico', type=int, default=1970, help='prima di questo anno basta un giocatore notevole')
    p.add_argument('--min-partite-storico', type=int, default=150, help='giocatori senza Elo ma con almeno queste partite')
    a = p.parse_args()
    costruisci(a.sorgente, a.uscita, a.max, a.min_mosse, a.elo, a.anno_storico, a.min_partite_storico)
