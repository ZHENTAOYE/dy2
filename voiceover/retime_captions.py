"""Apply voiceover/timing.json to the CAPTIONS arrays: each caption shows while its line is spoken."""
import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = {'hook':'S01Hook','hubble':'S02Hubble','space':'S03Space','rewind':'S04Rewind','bigbang':'S05BigBang',
         'cmb':'S06CMB','web':'S07Web','darkenergy':'S08DarkEnergy','observable':'S09Observable','finale':'S10Finale'}
STATEMENT_LINES = {('space', 1), ('cmb', 3), ('darkenergy', 2), ('finale', 5), ('finale', 6)}  # lines reading on-screen titles
KEEP_TO = {('observable', 4): 24.1, ('finale', 4): 20.3}  # captions end before the reveal / the bang flash
timing = json.load(open(ROOT / 'voiceover' / 'timing.json', encoding='utf-8'))
for sc, f in FILES.items():
    rows = [r for r in timing if r['scene'] == sc]
    rows = [r for i, r in enumerate(rows) if (sc, i) not in STATEMENT_LINES]
    p = ROOT / 'src' / 'scenes' / f'{f}.tsx'
    src = p.read_text(encoding='utf-8')
    m = re.search(r'const CAPTIONS = \[(.*?)\];', src, re.S)
    body = m.group(1)
    caps = list(re.finditer(r'from:\s*[\d.]+,\s*to:\s*[\d.]+', body))
    assert len(caps) == len(rows), (sc, len(caps), len(rows))
    new = []
    for i, r in enumerate(rows):
        a = round(r['start'], 2)
        b = KEEP_TO.get((sc, i), r['end'])
        if i + 1 < len(rows):
            b = min(b, rows[i + 1]['start'] - 0.35)
        b = round(max(b, a + 1.2), 2)
        new.append(f'from: {a}, to: {b}')
    out, last = [], 0
    for c, n in zip(caps, new):
        out += [body[last:c.start()], n]; last = c.end()
    out.append(body[last:])
    p.write_text(src[:m.start(1)] + ''.join(out) + src[m.end(1):], encoding='utf-8')
    print(sc, new)
