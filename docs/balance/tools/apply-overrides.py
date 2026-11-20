# Writes tuned health and attack (overrides.json from team-tune.mjs) into public/js/fighters.js.
#   python3 docs/balance/tools/apply-overrides.py <overrides.json>
import json, re, sys
path = 'public/js/fighters.js'
src = open(path, encoding='utf8').read()
over = json.load(open(sys.argv[1]))
changed = 0
for fid, o in over.items():
    pat = re.compile(r"(  '" + re.escape(fid) + r"': \{\n    rarity: '[a-z]+', role: '[a-z]+', )hp: \d+, attack: \d+")
    src, n = pat.subn(lambda m: f"{m.group(1)}hp: {o['hp']}, attack: {o['attack']}", src)
    if n != 1: sys.exit(f'{fid}: {n} matches')
    changed += 1
open(path, 'w', encoding='utf8').write(src)
print(changed, 'fighters updated')
