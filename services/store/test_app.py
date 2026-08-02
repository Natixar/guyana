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
        c.execute("INSERT INTO unit (id, symbol) VALUES (1, 'm3') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO entity (id, label) VALUES (1, 'lot-1') ON CONFLICT DO NOTHING")
        yield c


def _cell(conn, cell_id: str, start: str, end: str, sub_post: int | None = 1000) -> None:
    conn.execute(
        """INSERT INTO cell (id, period, entity_id, sub_post, part_type, caracterisation,
                             value, unit_id, factor, origin)
           VALUES (%s, tstzrange(%s::timestamptz, %s::timestamptz, '[)'),
                   1, %s, 1, 1, 1000, 1, 2680, 'MEASURED')""",
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


def test_a_cell_carries_a_number_not_a_representation(conn):
    """Le facteur est un nombre en kgCO2e par unité d'activité, et cette unité
    est déjà celle de la cellule. La porter une seconde fois créerait deux
    sources de vérité pour une information unique."""
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(conn, [_range("2026-01-01", "2026-02-01")])[0]
    assert "factorUnit" not in got
    assert got["unit"] == "m3" and got["factor"] == 2680


def test_no_decimal_crosses_the_boundary(conn):
    """Un Decimal traverserait vers JavaScript sans représentation convenue —
    le genre de divergence qui ne se voit qu'au moment où une signature ne se
    vérifie plus."""
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(conn, [_range("2026-01-01", "2026-02-01")])
    for key in ("value", "factor"):
        assert isinstance(got[0][key], float), f"{key} n'est pas un flottant"


SUBJECT = "urn:aurora:dore:abc"


def _origin(**over):
    return {"type": ["VerifiableCredential", "DoreBarOriginCredential"],
            "credentialSubject": {"id": SUBJECT}, "proof": {"proofValue": "zORIGIN"}, **over}


def _carbon(**over):
    return {"type": ["VerifiableCredential", "CarbonIntensityCredential"],
            "credentialSubject": {"id": SUBJECT}, "proof": {"proofValue": "zCARBON"}, **over}


def test_a_credential_is_stored_verbatim(conn):
    doc = _origin()
    db.insert_credential(conn, doc, "agm-randy")
    listed = db.list_credentials(conn)
    assert listed[0]["document"] == doc
    assert listed[0]["receivedBy"] == "agm-randy"


def test_the_same_credential_twice_is_not_duplicated(conn):
    db.insert_credential(conn, _origin(), None)
    db.insert_credential(conn, _origin(), None)
    assert len(db.list_credentials(conn)) == 1


def test_both_credentials_of_one_bar_are_kept(conn):
    """Le défaut que ce fichier n'attrapait pas.

    L'origine et l'intensité carbone d'une barre portent le MÊME
    `credentialSubject.id` — c'est ce que `derivedFrom` relie. Clé sur le sujet,
    la seconde arrivée était jetée en silence, et un vérificateur ne recevait que
    la moitié de ce dont il a besoin. C'est le cas d'usage central, pas un cas
    limite.
    """
    db.insert_credential(conn, _origin(), "agm-randy")
    db.insert_credential(conn, _carbon(), "natixar")

    kinds = {c["type"] for c in db.list_credentials(conn)}
    assert kinds == {"DoreBarOriginCredential", "CarbonIntensityCredential"}


def test_a_reissue_supersedes_without_erasing(conn):
    """Une réémission est une ligne de plus ; le registre prend la plus récente."""
    db.insert_credential(conn, _carbon(), None)
    db.insert_credential(conn, _carbon(validFrom="2026-09-01T00:00:00Z"), None)

    latest = [c for c in db.list_credentials(conn) if c["type"] == "CarbonIntensityCredential"]
    assert len(latest) == 1
    assert latest[0]["document"].get("validFrom") == "2026-09-01T00:00:00Z"
    assert conn.execute("SELECT count(*) AS n FROM credential").fetchone()["n"] == 2


def test_the_index_carries_no_documents(conn):
    """378 attestations complètes pour peupler un tableau seraient des
    mégaoctets là où quelques kilo-octets suffisent."""
    db.insert_credential(conn, _origin(), None)
    entry = db.credential_index(conn)[0]
    assert "document" not in entry
    assert entry["subject"] == SUBJECT and entry["digest"]


def test_fetching_one_bar_returns_both_of_its_credentials(conn):
    db.insert_credential(conn, _origin(), None)
    db.insert_credential(conn, _carbon(), None)
    found = db.credential_by_subject(conn, SUBJECT)
    assert {c["type"] for c in found} == {"DoreBarOriginCredential", "CarbonIntensityCredential"}
    assert db.credential_by_subject(conn, "urn:aurora:dore:inconnu") == []


# --- Les rôles ------------------------------------------------------------
# Un menu qui cache un lien ne protège de rien. Ces cas affirment que le refus
# est dans le service, là où `curl` le rencontre aussi.

from fastapi.testclient import TestClient  # noqa: E402

import app as store_app  # noqa: E402


@pytest.fixture()
def client(conn):
    return TestClient(store_app.app)


def _as(client, user, path, method="get", **kw):
    return getattr(client, method)(path, headers={"X-Webauth-User": user}, **kw)


def test_the_verifier_cannot_browse_the_cube(client):
    """`demo` vérifie une barre qu'on lui a remise, hors ligne. Lui ouvrir le
    cube lui donnerait le rythme de production d'AGM en prime."""
    r = _as(client, "demo", "/api/v1/ranges", "post",
            json={"periods": [{"start": "2025-01-01T04:00:00Z", "end": "2025-02-01T04:00:00Z"}]})
    assert r.status_code == 403


def test_the_verifier_cannot_list_the_other_bars(client):
    assert _as(client, "demo", "/api/v1/credentials/index").status_code == 403
    assert _as(client, "demo", "/api/v1/credentials").status_code == 403


def test_natixar_sees_counts_but_never_a_bar(client):
    """L'exploitant surveille une plateforme ; il ne parcourt pas les lingots."""
    assert _as(client, "natixar", "/api/v1/counts").status_code == 200
    assert _as(client, "natixar", "/api/v1/credentials/index").status_code == 403


def test_the_mine_reaches_its_own_data(client):
    assert _as(client, "agm-randy", "/api/v1/credentials/index").status_code == 200
    assert _as(client, "agm-randy", "/api/v1/counts").status_code == 403


# --- La répartition par client -------------------------------------------
# Ce que le total ne peut pas dire, et ce que la répartition ne doit pas dire.


def _tenants(conn):
    """Deux clients, et une entité PETITE-FILLE d'une tête.

    Le petit-enfant n'est pas un ornement : c'est le seul cas qui distingue une
    remontée récursive d'une jointure à un niveau. Sans lui, un `JOIN` naïf
    passerait le test et perdrait en production toutes les cellules d'un atelier
    rattaché à un département.
    """
    conn.execute("INSERT INTO entity (id, label) VALUES (100, 'AGM Inc.'), (200, 'Autre Mine')")
    conn.execute("INSERT INTO entity (id, label, parent) VALUES "
                 "(10, 'Power Generation', 100), (11, 'Atelier', 10), (20, 'Dept X', 200)")


def _quality_cell(conn, cell_id, entity, origin="MEASURED", coverage="COMPLETE"):
    conn.execute(
        """INSERT INTO cell (id, period, entity_id, sub_post, part_type, caracterisation,
                             value, unit_id, factor, origin, coverage)
           VALUES (%s, tstzrange('2025-01-01'::timestamptz, '2025-02-01'::timestamptz, '[)'),
                   %s, 1000, 1, 1, 10, 1, 2680, %s, %s)""",
        (cell_id, entity, origin, coverage),
    )


def test_a_client_is_the_subtree_under_its_head(conn, client):
    """Une cellule appartient au client à la RACINE de son entité."""
    _tenants(conn)
    _quality_cell(conn, "q1", 10)
    _quality_cell(conn, "q2", 11, origin="ESTIMATED")     # petite-fille d'AGM
    _quality_cell(conn, "q3", 20, origin="NOT_MEASURED")  # l'autre client

    rows = _as(client, "natixar", "/api/v1/counts").json()["byOrganisation"]
    by_name = {r["organisation"]: r for r in rows}

    assert by_name["AGM Inc."]["cells"] == 2, "l'atelier rattaché au département a été perdu"
    assert by_name["AGM Inc."]["measured"] == 1
    assert by_name["AGM Inc."]["estimated"] == 1
    assert by_name["Autre Mine"]["cells"] == 1
    assert by_name["Autre Mine"]["notMeasured"] == 1


def test_coverage_is_a_second_axis_not_a_fifth_origin(conn, client):
    """Une cellule MEASURED peut être MISSING : le mois recopié était mesuré.

    Si les deux axes étaient un seul, cette cellule devrait choisir, et le
    dénombrement des origines cesserait de faire 100 %.
    """
    _tenants(conn)
    _quality_cell(conn, "q1", 10, origin="MEASURED", coverage="MISSING")
    _quality_cell(conn, "q2", 10, origin="MEASURED", coverage="INCOMPLETE")

    row = _as(client, "natixar", "/api/v1/counts").json()["byOrganisation"][0]
    assert row["cells"] == 2
    assert row["measured"] == 2, "la couverture a mangé l'origine"
    assert row["missing"] == 1
    assert row["incomplete"] == 1


def test_a_client_never_learns_who_else_is_on_the_platform(conn, client):
    """La répartition nomme les clients : elle est réservée à l'exploitant.

    Le contrôle porte sur le CONTENU et pas seulement sur le code de retour :
    servir la liste avec un 200 en espérant que le front ne l'affiche pas serait
    une confidentialité de façade.
    """
    _tenants(conn)
    _quality_cell(conn, "q1", 10)

    assert _as(client, "agm-randy", "/api/v1/counts").status_code == 403
    assert _as(client, "demo", "/api/v1/counts").status_code == 403
    assert _as(client, "natixar", "/api/v1/counts").json()["byOrganisation"]


def test_an_unknown_user_gets_nothing(client):
    """Un nom inconnu n'hérite d'aucun droit — le défaut est le refus."""
    assert _as(client, "inconnu", "/api/v1/credentials/index").status_code == 403
    assert client.get("/api/v1/credentials/index").status_code == 403


def test_me_stays_open_and_declares_the_grants(client):
    """Le menu se déduit de /me, donc /me reste lisible par tous — mais il
    DÉCRIT les droits, il ne les accorde pas."""
    body = _as(client, "demo", "/api/v1/me").json()
    assert body["authenticated"] is True
    assert body["grants"] == []
