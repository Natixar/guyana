"""Fabrique les données ERP fictives du front : lots, barres, et leur association.

    python3 services/store/make_fixture.py

CE QUI EST FICTIF, ET POURQUOI. Le registre de coulée d'AGM — dataset G-01 — est
encore *Partial* : les onces mensuelles existent, la date de coulée, l'identifiant
de barre, le poids et le titre n'ont pas été fournis. Ces quatre champs sont donc
fabriqués, et le fichier produit le dit dans son en-tête plutôt que dans un
commentaire que personne ne lit. Le jour où G-01 arrive, ce script disparaît ; il
n'est pas une source, c'est un bouchon daté.

CE QUI NE L'EST PAS. Les onces par mois viennent de la feuille 6, les départements
et leur part de gazole du paquet réel. La répartition des barres suit la production
réelle : un mois qui a coulé plus d'or porte plus de barres.

LE MODÈLE DE PRODUCTION (décision du 1er août 2026) :

  - un cycle de production dure un mois ;
  - les barres sont fondues en DÉBUT de mois — le volume est faible, donc la
    production est intermittente plutôt que continue ;
  - toutes les autres opérations sont dans les consommations des départements
    de production du mois PRÉCÉDENT.

Conséquence qu'il faut regarder en face : des barres coulées début janvier 2025
puiseraient dans décembre 2024, absent du paquet. La fenêtre pilote est donc
**février à décembre**, soit 93,2 % des onces de l'année. Décaler janvier sur
lui-même aurait été plus simple et aurait fait mentir le modèle sur le seul mois
où l'on pouvait le vérifier.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "poc-data" / "AGM_PoC_Physical_Data_Pack_Completed.xlsx"
ASSIGNMENT = ROOT / "poc-data" / "agm-h1-subpost-assignment.json"
OUT = ROOT / "site" / "static" / "engine" / "erp-fixture.json"

TOTAL_BARS = 378

#: Départements de production, ceux que la matière traverse. Le reste — camp,
#: HSSE, informatique, entrepôt, géologie — soutient la production sans être sur
#: le chemin d'un lot : ses émissions sont réelles et n'appartiennent à aucune
#: barre en particulier. Elles deviennent le non-alloué, que la règle du 1er août
#: divise entre les barres coulées le mois même.
INDUSTRIAL = {
    "Power Generation", "UG-Power Gen", "Sinohydro", "Mobile Maintenance",
    "UG-Mining (GMYM)", "UG-Mining (HDLS)", "UG-Mining Project", "Mine Operation",
    "Mill General Ops", "Mill Maintenance", "Buckhall", "BH Road Maint",
    "BH Contractor - Ping An", "BH Contractor - DTL", "BH Contractor - Yano",
    "BH Contractor - Morrison", "BH Contractor - SMS", "Tapir",
    "Fuel transport -DTL", "Fuel transport -SIR",
}


def previous_month(label: str) -> str:
    year, month = (int(x) for x in label.split("-"))
    return f"{year - (month == 1)}-{12 if month == 1 else month - 1:02d}"


def bars_per_month(ounces: dict[str, float], window: list[str]) -> dict[str, int]:
    """Au prorata des onces coulées, par plus grand reste.

    Le reste importe : arrondir chaque mois indépendamment donnerait 374 ou 381
    barres, et un total qui ne tombe pas juste se remarque tout de suite dans une
    démonstration.
    """
    total = sum(ounces[m] for m in window)
    raw = {m: TOTAL_BARS * ounces[m] / total for m in window}
    counts = {m: int(v) for m, v in raw.items()}
    for m, _ in sorted(raw.items(), key=lambda kv: kv[1] - int(kv[1]), reverse=True)[
        : TOTAL_BARS - sum(counts.values())
    ]:
        counts[m] += 1
    return counts


def main() -> int:
    import openpyxl

    wb = openpyxl.load_workbook(PACK, data_only=True)
    ounces, tonnes_milled = {}, {}
    for r in wb["6. Production"].iter_rows(min_row=6, values_only=True):
        if r[0] and isinstance(r[7], (int, float)):
            ounces[r[0]] = float(r[7])
            tonnes_milled[r[0]] = float(r[4]) if isinstance(r[4], (int, float)) else None

    assignment = json.loads(ASSIGNMENT.read_text("utf-8"))
    departments = [e["department"] for e in assignment["emissionBearing"]["fuel"]]

    # Un lot par mois de production ; la barre qu'il produit est coulée le mois
    # suivant. Le premier mois du paquet n'a pas de prédécesseur.
    window = sorted(m for m in ounces if previous_month(m) in ounces)
    counts = bars_per_month(ounces, window)

    lots, bars = [], []
    for pour_month in window:
        source = previous_month(pour_month)
        lot_id = f"LOT-{source}"
        lots.append({
            "id": lot_id,
            "productionMonth": source,
            "pourMonth": pour_month,
            "period": {"start": f"{source}-01T00:00:00Z",
                       "end": f"{pour_month}-01T00:00:00Z"},
            # « Les lots transitent par tous les départements industriels. »
            "departments": [d for d in departments if d in INDUSTRIAL],
            "tonnesMilled": tonnes_milled.get(source),
        })

        oz_each = ounces[pour_month] / counts[pour_month]
        for n in range(1, counts[pour_month] + 1):
            bars.append({
                # Aléa de 128 bits, jamais un numéro de séquence : une
                # numérotation ordonnée divulguerait le rythme de production.
                "subjectId": f"urn:aurora:dore:{secrets.token_hex(16)}",
                # L'identifiant interne de la mine reste une revendication à
                # divulgation contrôlée, il n'est pas l'identifiant du sujet.
                "internalId": f"AUR-{pour_month.replace('-', '')}-{n:03d}",
                "lot": lot_id,
                "pourDate": f"{pour_month}-01",
                "ounces": round(oz_each, 2),
                "weightKg": round(oz_each * 0.0311034768 / 0.92, 3),
                "assay": 0.92,
                "status": "AWAITING_ATTESTATION",
            })

    fixture = {
        "_": ("Données ERP fictives. Le registre de coulée G-01 d'AGM est encore Partial : "
              "date de coulée, identifiant, poids et titre sont fabriqués. Les onces par mois "
              "et les départements viennent du paquet réel."),
        "simulated": True,
        "eventModel": "simulated-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "assumptions": {
            "cycle": "un mois",
            "pour": "début de mois",
            "sourcing": "les opérations du lot sont les consommations du mois précédent",
            "window": f"{window[0]}..{window[-1]}",
            "windowReason": ("janvier 2025 puiserait dans décembre 2024, absent du paquet ; "
                             "la fenêtre couvre 93,2 % des onces de l'année"),
            "unallocatedRule": "unallocated/bars-poured-same-month",
        },
        "industrialDepartments": sorted(INDUSTRIAL),
        "supportDepartments": sorted(set(departments) - INDUSTRIAL),
        "lots": lots,
        "bars": bars,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"{len(bars)} barres, {len(lots)} lots, fenêtre {window[0]}..{window[-1]}")
    print(f"  {len(fixture['industrialDepartments'])} départements industriels, "
          f"{len(fixture['supportDepartments'])} de soutien")
    print(f"  -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
