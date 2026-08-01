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
FIXTURE = ROOT / "site" / "static" / "engine" / "erp-fixture.json"

#: Feuille 9 du paquet. Cinq des six sont marqués « provisional » par AGM ;
#: seul le facteur de combustion du gazole est accepté, et seulement parce que
#: janvier réconcilie à −0,16 % contre leur propre classeur.
# TOUT EST EN SI. La feuille 9 donne les facteurs par litre, parce que les bons
# de sortie comptent en litres ; le cube ne connaît que le mètre cube. Convertir
# ici, une fois, vaut mieux que de porter deux unités jusqu'au bout.
DIESEL_COMBUSTION = 2.68 * 1000     # kgCO2e / m3
DIESEL_UPSTREAM = 0.61 * 1000       # kgCO2e / m3, well-to-tank
EXPLOSIVE = 0.17                    # kgCO2e / kg, déjà SI

#: Identifiants de la taxonomie servie, agm-h1-v2.
PART_COMBUSTION, PART_AMONT = 1, 2
CARAC_OPERATED, CARAC_PROCEDEED = 1, 2
SUBPOST_EXPLOSIVES = 1005

UNITS = {"m3": 1, "kg": 2}


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
            fuel.append({"month": r[0], "department": r[1], "m3": float(r[3]) / 1000.0})
    for r in wb["7. Explosives"].iter_rows(min_row=6, values_only=True):
        if r[1] and isinstance(r[2], (int, float)):
            explosives.append({"month": r[0], "product": r[1], "kg": float(r[2])})
    return fuel, explosives


def organisation() -> dict[str, dict]:
    """Les départements, avec leurs identifiants — lus, jamais redevinés.

    Le fixture du front est la source unique. Attribuer les identifiants ici
    aussi produirait deux numérotations qui coïncideraient jusqu'au jour où un
    département serait ajouté, et la divergence serait silencieuse.
    """
    fx = json.loads(FIXTURE.read_text("utf-8"))
    return {d["key"]: d for d in fx["organisation"]}


def build_cells(fuel, explosives, assignment, org):
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
        dept = org.get(row["department"])
        if dept is None:
            print(f"  département hors taxonomie, ignoré : {row['department']}", file=sys.stderr)
            continue
        slug = row["department"].replace(" ", "_")[:40]
        # Deux cellules par litre : la combustion, et l'amont. Charger seulement
        # la première perdrait 22,8 % de l'empreinte sans que rien ne le signale.
        for part, factor, tag in ((PART_COMBUSTION, DIESEL_COMBUSTION, "comb"),
                                  (PART_AMONT, DIESEL_UPSTREAM, "amont")):
            cells.append({
                "id": f"d/{row['month']}/{slug}/{tag}",
                "period": month_range(row["month"]),
                "entity_id": dept["id"],
                "sub_post": sub_post, "part_type": part,
                "caracterisation": CARAC_OPERATED,
                "value": row["m3"], "unit": "m3",
                "factor": factor, "factor_unit": "kgCO2e/m3",
                "origin": "MEASURED",
            })

    blast_dept = org["Sinohydro"]["id"]
    for row in explosives:
        cells.append({
            "id": f"x/{row['month']}/{row['product'].replace(' ', '_')}",
            "period": month_range(row["month"]),
            # Le paquet donne les explosifs par produit et par mois, jamais par
            # département : ils vont au département de minage. Les répartir
            # entre plusieurs inventerait une ventilation que personne n'a.
            "entity_id": blast_dept,
            "sub_post": SUBPOST_EXPLOSIVES, "part_type": None,
            "caracterisation": CARAC_PROCEDEED,
            "value": row["kg"], "unit": "kg",
            "factor": EXPLOSIVE, "factor_unit": "kgCO2e/kg",
            "origin": "MEASURED",
        })

    return cells


def load(conn, cells, org) -> None:
    db.apply_schema(conn)
    for symbol, uid in UNITS.items():
        conn.execute("INSERT INTO unit (id, symbol) VALUES (%s, %s) "
                     "ON CONFLICT (id) DO UPDATE SET symbol = EXCLUDED.symbol",
                     (uid, symbol))
    # La taxonomie d'organisation. Les noms sont en clair PROVISOIREMENT : ce
    # sont eux que le chiffrement des dimensions couvrira. Le client n'en connaît
    # déjà que les entiers.
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO entity (id, label, industrial) VALUES (%(id)s, %(key)s, %(industrial)s)
               ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label,
                                              industrial = EXCLUDED.industrial""",
            list(org.values()),
        )

    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO cell (id, period, entity_id, sub_post, part_type, caracterisation,
                                 value, unit_id, factor, factor_unit, origin)
                    VALUES (%(id)s, %(period)s, %(entity_id)s, %(sub_post)s, %(part_type)s,
                            %(caracterisation)s, %(value)s, %(unit_id)s, %(factor)s,
                            %(factor_unit)s, %(origin)s)
               ON CONFLICT (id) DO UPDATE SET
                    period = EXCLUDED.period, entity_id = EXCLUDED.entity_id,
                    sub_post = EXCLUDED.sub_post, part_type = EXCLUDED.part_type,
                    caracterisation = EXCLUDED.caracterisation,
                    value = EXCLUDED.value, unit_id = EXCLUDED.unit_id,
                    factor = EXCLUDED.factor, factor_unit = EXCLUDED.factor_unit,
                    origin = EXCLUDED.origin""",
            [{**c, "unit_id": UNITS[c["unit"]]} for c in cells],
        )


def sql_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    # Les apostrophes des noms de département — « BH Contractor - Ping An » n'en
    # a pas, mais rien ne garantit que le prochain n'en aura pas.
    return "'" + str(value).replace("'", "''") + "'"


def emit_sql(cells, org) -> None:
    """Le chargement, en SQL, sur stdout.

    Une seule transaction : un chargement à moitié appliqué laisserait un cube
    dont personne ne saurait dire s'il est complet.
    """
    print("BEGIN;")
    for symbol, uid in UNITS.items():
        # DO UPDATE, jamais DO NOTHING : le passage de « L » à « m3 » laisserait
        # sinon l'identifiant 1 sur l'ancien symbole, et les cellules porteraient
        # des mètres cubes étiquetés litres. Une erreur d'unité muette, celle-là
        # même que le SI existe pour supprimer.
        print(f"INSERT INTO unit (id, symbol) VALUES ({uid}, {sql_literal(symbol)}) "
              "ON CONFLICT (id) DO UPDATE SET symbol = EXCLUDED.symbol;")
    for d in org.values():
        print(f"INSERT INTO entity (id, label, industrial) VALUES "
              f"({d['id']}, {sql_literal(d['key'])}, {sql_literal(d['industrial'])}) "
              "ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, "
              "industrial = EXCLUDED.industrial;")
    for c in cells:
        lo = c["period"].lower.isoformat()
        hi = c["period"].upper.isoformat()
        print(
            "INSERT INTO cell (id, period, entity_id, sub_post, part_type, caracterisation,"
            " value, unit_id, factor, factor_unit, origin) VALUES ("
            f"{sql_literal(c['id'])}, "
            f"tstzrange({sql_literal(lo)}::timestamptz, {sql_literal(hi)}::timestamptz, '[)'), "
            f"{c['entity_id']}, {sql_literal(c['sub_post'])}, {sql_literal(c['part_type'])}, "
            f"{c['caracterisation']}, {c['value']!r}, {UNITS[c['unit']]}, {c['factor']!r}, "
            f"{sql_literal(c['factor_unit'])}, {sql_literal(c['origin'])}) "
            # Toutes les colonnes, sans exception : un rechargement qui change
            # d'unité doit changer l'unité. En omettre une laisse une valeur
            # neuve sous une étiquette ancienne.
            "ON CONFLICT (id) DO UPDATE SET period = EXCLUDED.period, "
            "entity_id = EXCLUDED.entity_id, sub_post = EXCLUDED.sub_post, "
            "part_type = EXCLUDED.part_type, caracterisation = EXCLUDED.caracterisation, "
            "value = EXCLUDED.value, unit_id = EXCLUDED.unit_id, "
            "factor = EXCLUDED.factor, factor_unit = EXCLUDED.factor_unit, "
            "origin = EXCLUDED.origin;"
        )
    print("COMMIT;")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="compte et résume sans écrire — le défaut serait dangereux dans l'autre sens")
    ap.add_argument("--sql", action="store_true",
                    help="émet le SQL sur stdout au lieu de se connecter ; le paquet AGM reste ici")
    args = ap.parse_args()

    if not PACK.exists():
        print(f"paquet AGM introuvable : {PACK}", file=sys.stderr)
        print("il est confidentiel (clause 9) et n'est pas dans le dépôt.", file=sys.stderr)
        return 1

    fuel, explosives = read_pack()
    assignment = json.loads(ASSIGNMENT.read_text("utf-8"))
    org = organisation()
    cells = build_cells(fuel, explosives, assignment, org)

    m3 = sum(c["value"] for c in cells if c["unit"] == "m3" and c["part_type"] == PART_COMBUSTION)
    tonnes = sum(c["value"] * c["factor"] for c in cells) / 1000

    # Le résumé est un diagnostic, pas une donnée : il va sur stderr, sinon il
    # se mêle au SQL quand celui-ci part dans un tuyau.
    industrial = sum(1 for d in org.values() if d["industrial"])
    say = lambda m: print(m, file=sys.stderr)
    say(f"{len(cells)} cellules — {m3:,.0f} m3 de gazole, {tonnes:,.0f} tCO2e au total")
    say(f"  organisation : {len(org)} départements, dont {industrial} industriels")
    say(f"  affectation : {assignment['version']} ({assignment['status'].split(' - ')[0]})")

    if args.dry_run:
        say("\n--dry-run : rien n'a été écrit")
        return 0

    if args.sql:
        # Le classeur AGM est confidentiel au titre de la clause 9 : il ne quitte
        # pas ce poste. Seules les données dérivées traversent, par stdin, et
        # rien ne s'écrit sur le système de fichiers de la cible — c'est la
        # doctrine de deploy/, elle vaut ici aussi.
        emit_sql(cells, org)
        return 0

    with db.connect() as conn:
        load(conn, cells, org)
        n = conn.execute("SELECT count(*) AS n FROM cell").fetchone()["n"]
    say(f"\nchargé. {n} cellules dans le cube.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
