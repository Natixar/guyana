"""Chargeur unique des données AGM 2025 dans le cube.

    STORE_DSN=... python3 services/store/load_2025.py [--dry-run]

CE QUE CE SCRIPT EST, ET CE QU'IL N'EST PAS. C'est un chargement ponctuel,
autorisé explicitement pour FIDES, et non le début d'une chaîne d'ingestion.
Rien ici ne doit être réutilisé pour H2 : la cartographie source → modèle (#47)
et son taux de couverture calculé sont un tout autre sujet. Le marquer plutôt
que le sous-entendre évite qu'il devienne l'ingestion par accident.

CE QU'IL LIT. Le paquet physique AGM, qui est **confidentiel au titre de la
clause 9** et n'entre jamais dans le dépôt. Le script le lit depuis le disque
local et écrit dans la base ; il ne recopie rien dans un fichier suivi.

CE QU'IL ÉCRIT. Une cellule par (département, mois) de la feuille 3, une par
(produit, mois) de la feuille 7, et la part amont de chaque litre — le terme
qu'un modèle naïf perd entièrement, 22,8 % de la combustion.

L'IDEMPOTENCE. Les identifiants de cellule sont déterministes, dérivés de la
source. Relancer le chargement remplace au lieu d'empiler : un chargement joué
deux fois par mégarde doublerait l'inventaire, ce qui ne se verrait pas.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.types.range import Range

import db

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "poc-data" / "AGM_PoC_Physical_Data_Pack_Completed.xlsx"
ASSIGNMENT = ROOT / "poc-data" / "agm-h1-subpost-assignment.json"

#: Feuille 9 du paquet. Cinq des six sont marqués « provisional » par AGM ;
#: seul le facteur de combustion du gazole est accepté, et seulement parce que
#: janvier réconcilie à −0,16 % contre leur propre classeur.
DIESEL_COMBUSTION = 2.68     # kgCO2e / L
DIESEL_UPSTREAM = 0.61       # kgCO2e / L, well-to-tank
EXPLOSIVE = 0.17             # kgCO2e / kg

#: Identifiants de la taxonomie servie, agm-h1-v2.
PART_COMBUSTION, PART_AMONT = 1, 2
CARAC_OPERATED, CARAC_PROCEDEED = 1, 2
SUBPOST_EXPLOSIVES = 1005

UNITS = {"L": 1, "kg": 2}


#: Le Guyana est à UTC−4 toute l'année, sans heure d'été.
GUYANA = timezone(timedelta(hours=-4))


def month_range(label: str) -> Range:
    """« 2025-01 » -> le mois LOCAL, en bornes semi-ouvertes.

    Minuit à Georgetown, pas minuit à Greenwich. Une mine rapporte en jours
    guyaniens : découper sur des minuits Zulu décalerait chaque frontière de
    quatre heures et rangerait une nuit de production dans le mois suivant. À
    l'échelle d'un mois l'erreur est petite ; à la frontière d'un lot elle met
    du gazole dans la mauvaise barre, ce que le modèle prétend justement éviter.

    Semi-ouvertes parce que sinon une cellule serait comptée deux fois sur deux
    fenêtres adjacentes.
    """
    year, month = (int(x) for x in label.split("-"))
    start = datetime(year, month, 1, tzinfo=GUYANA)
    end = datetime(year + (month == 12), (month % 12) + 1, 1, tzinfo=GUYANA)
    return Range(start.astimezone(timezone.utc), end.astimezone(timezone.utc), "[)")


def read_pack():
    import openpyxl

    wb = openpyxl.load_workbook(PACK, data_only=True)
    fuel, explosives = [], []
    for r in wb["3. Fuel by consumer"].iter_rows(min_row=6, values_only=True):
        if r[1] and isinstance(r[3], (int, float)):
            fuel.append({"month": r[0], "department": r[1], "litres": float(r[3])})
    for r in wb["7. Explosives"].iter_rows(min_row=6, values_only=True):
        if r[1] and isinstance(r[2], (int, float)):
            explosives.append({"month": r[0], "product": r[1], "kg": float(r[2])})
    return fuel, explosives


def build_cells(fuel, explosives, assignment):
    """La correspondance département → sous-poste vient du fichier d'affectation,
    relu et non redeviné : c'est lui qui porte les 14 départements marqués
    « needs AGM confirmation », et il a été vérifié séparément."""
    by_department = {e["department"]: e for e in assignment["emissionBearing"]["fuel"]}
    cells = []

    for row in fuel:
        spec = by_department.get(row["department"])
        if spec is None:
            print(f"  département inconnu, ignoré : {row['department']}", file=sys.stderr)
            continue
        sub_post = {"CombustiblesFossiles": 1000, "FretInterne": 1002}[spec["subPost"]]
        slug = row["department"].replace(" ", "_")[:40]
        # Deux cellules par litre : la combustion, et l'amont. Charger seulement
        # la première perdrait 22,8 % de l'empreinte sans que rien ne le signale.
        for part, factor, tag in ((PART_COMBUSTION, DIESEL_COMBUSTION, "comb"),
                                  (PART_AMONT, DIESEL_UPSTREAM, "amont")):
            cells.append({
                "id": f"d/{row['month']}/{slug}/{tag}",
                "period": month_range(row["month"]),
                "sub_post": sub_post, "part_type": part,
                "caracterisation": CARAC_OPERATED,
                "value": row["litres"], "unit": "L",
                "factor": factor, "factor_unit": "kgCO2e/L",
                "origin": "MEASURED",
            })

    for row in explosives:
        cells.append({
            "id": f"x/{row['month']}/{row['product'].replace(' ', '_')}",
            "period": month_range(row["month"]),
            "sub_post": SUBPOST_EXPLOSIVES, "part_type": None,
            "caracterisation": CARAC_PROCEDEED,
            "value": row["kg"], "unit": "kg",
            "factor": EXPLOSIVE, "factor_unit": "kgCO2e/kg",
            "origin": "MEASURED",
        })

    return cells


def load(conn, cells) -> None:
    db.apply_schema(conn)
    for symbol, uid in UNITS.items():
        conn.execute("INSERT INTO unit (id, symbol) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                     (uid, symbol))
    # Une seule entité : la fenêtre pilote entière. Les lots viendront avec le
    # registre de coulée G-01, encore partiel chez AGM.
    conn.execute("INSERT INTO entity (id, label) VALUES (1, 'perimetre-pilote-2025') "
                 "ON CONFLICT DO NOTHING")

    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO cell (id, period, entity_id, sub_post, part_type, caracterisation,
                                 value, unit_id, factor, factor_unit, origin)
                    VALUES (%(id)s, %(period)s, 1, %(sub_post)s, %(part_type)s,
                            %(caracterisation)s, %(value)s, %(unit_id)s, %(factor)s,
                            %(factor_unit)s, %(origin)s)
               ON CONFLICT (id) DO UPDATE SET
                    period = EXCLUDED.period, value = EXCLUDED.value,
                    factor = EXCLUDED.factor, origin = EXCLUDED.origin""",
            [{**c, "unit_id": UNITS[c["unit"]]} for c in cells],
        )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="compte et résume sans écrire — le défaut serait dangereux dans l'autre sens")
    args = ap.parse_args()

    if not PACK.exists():
        print(f"paquet AGM introuvable : {PACK}", file=sys.stderr)
        print("il est confidentiel (clause 9) et n'est pas dans le dépôt.", file=sys.stderr)
        return 1

    fuel, explosives = read_pack()
    assignment = json.loads(ASSIGNMENT.read_text("utf-8"))
    cells = build_cells(fuel, explosives, assignment)

    litres = sum(c["value"] for c in cells if c["unit"] == "L" and c["part_type"] == PART_COMBUSTION)
    tonnes = sum(c["value"] * c["factor"] for c in cells) / 1000

    print(f"{len(cells)} cellules — {litres:,.0f} L de gazole, {tonnes:,.0f} tCO2e au total")
    print(f"  affectation : {assignment['version']} ({assignment['status'].split(' - ')[0]})")

    if args.dry_run:
        print("\n--dry-run : rien n'a été écrit")
        return 0

    with db.connect() as conn:
        load(conn, cells)
        n = conn.execute("SELECT count(*) AS n FROM cell").fetchone()["n"]
    print(f"\nchargé. {n} cellules dans le cube.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
