"""Le magasin, contre un vrai PostgreSQL.

    python3 -m pytest services/store/test_app.py -q

Un vrai serveur et non un bouchon, pour une raison précise : ce qui est testé
ici est en grande partie du comportement de PostgreSQL — le recouvrement
`tstzrange`, l'index GiST, la contrainte d'intervalle non vide. Un bouchon
confirmerait mes hypothèses sur ces trois points au lieu de les éprouver.

Sauté proprement si aucune base n'est joignable, plutôt qu'échouer : un test
d'intégration absent doit se voir, pas se confondre avec une régression.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

psycopg = pytest.importorskip("psycopg")

import db  # noqa: E402


def _available() -> bool:
    try:
        with db.connect() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not os.environ.get("STORE_DSN") or not _available(),
    reason="aucun PostgreSQL joignable — définir STORE_DSN",
)


@pytest.fixture()
def conn():
    with db.connect() as c:
        db.apply_schema(c)
        c.execute("TRUNCATE cell, credential; DELETE FROM entity; DELETE FROM unit;")
        c.execute("INSERT INTO unit (id, symbol) VALUES (1, 'L') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO entity (id, label) VALUES (1, 'lot-1') ON CONFLICT DO NOTHING")
        yield c


def _cell(conn, cell_id: str, start: str, end: str, sub_post: int | None = 1000) -> None:
    conn.execute(
        """INSERT INTO cell (id, period, entity_id, sub_post, part_type, caracterisation,
                             value, unit_id, factor, factor_unit, origin)
           VALUES (%s, tstzrange(%s::timestamptz, %s::timestamptz, '[)'),
                   1, %s, 1, 1, 1000, 1, 2.68, 'kgCO2e/L', 'MEASURED')""",
        (cell_id, start, end, sub_post),
    )


def _range(start: str, end: str):
    return psycopg.types.range.Range(
        datetime.fromisoformat(start).replace(tzinfo=timezone.utc),
        datetime.fromisoformat(end).replace(tzinfo=timezone.utc), "[)")


def test_overlap_selects_a_cell_that_straddles_the_boundary(conn):
    """L'intérêt même de l'intervalle : une cellule à cheval est retenue.

    Avec deux colonnes scalaires et une comparaison sur la date de début, elle
    serait manquée — et c'est le cas exact d'une consommation mensuelle
    interrogée sur une fenêtre de date à date.
    """
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(conn, [_range("2026-01-15", "2026-01-20")])
    assert [c["id"] for c in got] == ["janvier"]


def test_a_touching_but_disjoint_period_is_not_selected(conn):
    """Les bornes sont [début, fin) : une période qui commence là où l'autre
    finit ne recouvre rien. Sans cela une cellule serait comptée deux fois sur
    deux fenêtres adjacentes."""
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    assert db.cells_overlapping(conn, [_range("2026-02-01", "2026-03-01")]) == []


def test_a_multirange_does_not_over_collect(conn):
    """L'empreinte d'un lot est un multi-intervalle, pas une fenêtre.

    Deux opérations en janvier et en mars : demander les deux ne doit PAS
    ramener février. C'est toute la différence avec l'enveloppe convexe.
    """
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    _cell(conn, "février", "2026-02-01", "2026-03-01")
    _cell(conn, "mars", "2026-03-01", "2026-04-01")
    got = db.cells_overlapping(
        conn, [_range("2026-01-10", "2026-01-11"), _range("2026-03-10", "2026-03-11")])
    assert [c["id"] for c in got] == ["janvier", "mars"]


def test_an_empty_period_is_refused_by_the_database(conn):
    """Une ligne qui existe sans rien dire fausserait un dénombrement de
    couverture : le signataire exigerait une disposition pour une cellule qui ne
    porte aucun flux."""
    with pytest.raises(psycopg.errors.CheckViolation):
        _cell(conn, "vide", "2026-01-01", "2026-01-01")


def test_an_unallocated_cell_is_served_like_any_other(conn):
    """`sub_post` nul est un état légitime, pas une erreur : c'est le seau
    non-alloué, et il doit sortir du magasin pour pouvoir être déclaré."""
    _cell(conn, "non-alloué", "2026-01-01", "2026-02-01", sub_post=None)
    got = db.cells_overlapping(conn, [_range("2026-01-01", "2026-02-01")])
    assert got[0]["subPost"] is None


def test_no_decimal_crosses_the_boundary(conn):
    """Un Decimal traverserait vers JavaScript sans représentation convenue —
    le genre de divergence qui ne se voit qu'au moment où une signature ne se
    vérifie plus."""
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(conn, [_range("2026-01-01", "2026-02-01")])
    for key in ("value", "factor"):
        assert isinstance(got[0][key], float), f"{key} n'est pas un flottant"


def test_a_credential_is_stored_verbatim(conn):
    doc = {"credentialSubject": {"id": "urn:aurora:dore:abc"}, "proof": {"proofValue": "zXYZ"}}
    db.insert_credential(conn, doc, "agm-randy")
    listed = db.list_credentials(conn)
    assert listed[0]["document"] == doc
    assert listed[0]["receivedBy"] == "agm-randy"


def test_the_same_credential_twice_is_not_duplicated(conn):
    doc = {"credentialSubject": {"id": "urn:aurora:dore:abc"}}
    db.insert_credential(conn, doc, None)
    db.insert_credential(conn, doc, None)
    assert len(db.list_credentials(conn)) == 1
