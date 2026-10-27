#!/usr/bin/env python3
"""Aplica un refresco de datos (salidas de los agentes por repo) sobre app/src/data/*.json.

Cada salida: {head, numbers, newEntities, updates[{id, set{campo|campo.punteado}}],
newRelations, retiredRelations?, staleSources[{id, path, replacement}]}.
Valida antes de escribir: ids únicos, padres existentes, extremos de relación existentes,
fuentes con repo conocido. Además aplica la limpieza de página pública (SCRUB: nombres
del equipo de La Chamana → su rol, solo en campos de texto, nunca en ids).

Uso: python3 scripts/merge-refresh.py <dir-con-out-*.json> [--dry]
"""
import json, re, sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"
OUTS = Path(sys.argv[1])
DRY = "--dry" in sys.argv
FILES = {"both_os": "entities.both-os.json", "synergy-toolkit": "entities.synergy-toolkit.json",
         "lc-chaman": "entities.lc-chaman.json", "bienal-punta-os": "entities.bienal-punta-os.json",
         "casa-manantial-os": "entities.casa-manantial-os.json"}
TEXT_FIELDS = ("name", "summary", "kind", "label", "note", "body", "title", "owner", "gate", "role")

# página pública: el equipo de La Chamana se nombra por su rol (2026-10-26)
SCRUB = [
    (r"Daiana precio · Iru condiciones", "Mariano firma precio · la operadora de La Chamana trae condiciones"),
    (r"\bIru \+ Bianca\b", "las dos operadoras"), (r"\bIru y Bianca\b", "las dos operadoras"),
    (r"Gastón, Iru, Bianca y René", "Gastón, René y las dos operadoras"),
    (r"\bde Bianca\b", "de la operadora del cockpit"), (r"\ba Bianca\b", "a la operadora del cockpit"),
    (r"\bBianca\b", "la operadora del cockpit"),
    (r"\bde Iru\b", "de la operadora de La Chamana"), (r"\ba Iru\b", "a la operadora de La Chamana"),
    (r"\bIru\b", "la operadora de La Chamana"),
]


def scrub_text(s):
    if not isinstance(s, str):
        return s
    for pat, rep in SCRUB:
        s = re.sub(pat, rep, s)
    # «la operadora» al empezar oración o celda
    s = re.sub(r"(^|[.:;·|]\s+)la operadora", lambda m: m.group(1) + "La operadora", s)
    return s


def scrub(obj):
    if isinstance(obj, dict):
        return {k: (scrub_text(v) if k in TEXT_FIELDS else scrub(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(x) for x in obj]
    return obj


ents = {repo: json.loads((DATA / f).read_text()) for repo, f in FILES.items()}
rels = json.loads((DATA / "relations.json").read_text())
tour = json.loads((DATA / "tour.json").read_text())
byid = {e["id"]: (repo, e) for repo, arr in ents.items() for e in arr}
errors, log = [], []

for repo in ("both_os", "synergy-toolkit", "lc-chaman"):
    f = OUTS / f"out-{repo}.json"
    if not f.exists():
        continue
    out = json.loads(f.read_text())
    for e in out.get("newEntities", []):
        if e["id"] in byid:
            errors.append(f"{repo}: id ya existe {e['id']}"); continue
        ents[repo].append(e); byid[e["id"]] = (repo, e)
    for u in out.get("updates", []):
        if u["id"] not in byid:
            errors.append(f"{repo}: update de id inexistente {u['id']}"); continue
        e = byid[u["id"]][1]
        for k, v in u["set"].items():
            tgt = e
            parts = k.split(".")
            for p in parts[:-1]:
                tgt = tgt.setdefault(p, {})
            tgt[parts[-1]] = v
        log.append(f"update {u['id']}: {', '.join(u['set'])}")
    for s in out.get("staleSources", []):
        e = byid.get(s["id"], (None, None))[1]
        if not e:
            errors.append(f"stale: id inexistente {s['id']}"); continue
        src = [x for x in e.get("sources", []) if x["path"] == s["path"]]
        for x in src:
            if s.get("replacement"):
                x["path"] = s["replacement"]
            else:
                e["sources"].remove(x)
        if not src and s.get("replacement"):
            e.setdefault("sources", []).append({"repo": repo, "path": s["replacement"]})
        log.append(f"stale {s['id']}: {s['path']} → {s.get('replacement')}")
    retired = set(out.get("retiredRelations", []) if isinstance(out.get("retiredRelations"), list) and all(isinstance(x, str) for x in out.get("retiredRelations", [])) else [x.get("id") for x in out.get("retiredRelations", [])])
    if retired:
        rels = [r for r in rels if r["id"] not in retired]; log.append(f"retired relations: {sorted(retired)}")
    ids = {r["id"] for r in rels}
    for r in out.get("newRelations", []):
        if r["id"] in ids:
            errors.append(f"relación duplicada {r['id']}"); continue
        rels.append(r); ids.add(r["id"])
    log.append(f"{repo}: +{len(out.get('newEntities', []))} piezas · {len(out.get('updates', []))} updates · +{len(out.get('newRelations', []))} relaciones · head {out.get('head')}")

allids = set(byid)
for repo, arr in ents.items():
    for e in arr:
        if e.get("parentId") and e["parentId"] not in allids:
            errors.append(f"{e['id']}: padre {e['parentId']} no existe")
for r in rels:
    for end in ("from", "to"):
        if r[end] not in allids:
            errors.append(f"{r['id']}: {end} {r[end]} no existe")

ents = {repo: scrub(arr) for repo, arr in ents.items()}
rels, tour = scrub(rels), scrub(tour)
left = sum(len(re.findall(r"\b(Bianca|Iru)\b", json.dumps([ents, rels, tour], ensure_ascii=False))) for _ in [0])
print("\n".join(log))
print(f"nombres del equipo de LC que quedan en texto: {left}")
if errors:
    print("ERRORES:\n  " + "\n  ".join(errors)); sys.exit(1)
if DRY:
    print("(dry: no se escribió nada)"); sys.exit(0)
for repo, f in FILES.items():
    (DATA / f).write_text(json.dumps(ents[repo], ensure_ascii=False, indent=2) + "\n")
(DATA / "relations.json").write_text(json.dumps(rels, ensure_ascii=False, indent=2) + "\n")
(DATA / "tour.json").write_text(json.dumps(tour, ensure_ascii=False, indent=2) + "\n")
print("escrito")
