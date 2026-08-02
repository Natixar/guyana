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
        c.execute("TRUNCATE cell, credential; DELETE FROM entity;")
        c.execute("INSERT INTO entity (id, label) VALUES (1, 'lot-1') ON CONFLICT DO NOTHING")
        yield c


def _cell(conn, cell_id: str, start: str, end: str, sub_post: int | None = 1000) -> None:
    conn.execute(
        """INSERT INTO cell (id, period, entity_id, sub_post, part_type, caracterisation,
                             flux, dimension, display_unit, display_scale,
                             factor, origin)
           VALUES (%s, tstzrange(%s::timestamptz, %s::timestamptz, '[)'),
                   1, %s, 1, 1, 1000, 'volume', 'L', 1000, 2680, 'MEASURED')""",
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


def test_a_served_cell_is_clipped_to_the_window(conn):
    """LA BASE FAIT L'ARITHMÉTIQUE DES INTERVALLES — décision du 2 août 2026.

    Rien de ce qui est servi ne doit porter du temps situé hors de la requête.
    Une cellule mensuelle interrogée sur un jour sort donc avec un jour de
    période, et son DÉBIT INCHANGÉ : un débit est extensif dans le temps, le lire
    sur un intervalle plus court ne le modifie pas. C'est ce qui rend
    l'intégration correcte chez celui qui recalcule sans qu'il ait à refaire le
    découpage de mémoire.
    """
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(conn, [_range("2026-01-10", "2026-01-11")])[0]

    assert got["periodStart"].startswith("2026-01-10")
    assert got["periodEnd"].startswith("2026-01-11")
    assert got["flux"] == 1000, "le débit a été modifié en même temps que la période"
    assert got["id"] == "janvier", "une cellule entière dans la fenêtre garde son identifiant"


def test_a_cell_straddling_two_windows_is_served_once_per_window(conn):
    """Deux morceaux, deux lignes, et deux identifiants distincts.

    Une enveloppe couvrant les deux prétendrait avoir intégré ce qui les sépare.
    Et deux lignes sous le MÊME identifiant se perdraient à la couche de
    couverture, qui exige une disposition par cellule servie et refuse un
    identifiant en double : le client rendrait compte d'une cellule en croyant
    en avoir couvert deux.
    """
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(
        conn, [_range("2026-01-05", "2026-01-06"), _range("2026-01-20", "2026-01-21")])

    assert len(got) == 2
    assert len({c["id"] for c in got}) == 2, "deux morceaux partagent un identifiant"
    assert all(c["id"].startswith("janvier@") for c in got)


def _integrated(cells) -> float:
    """Les émissions des cellules servies, en kgCO2e : débit x facteur x durée."""
    total = 0.0
    for c in cells:
        seconds = (datetime.fromisoformat(c["periodEnd"])
                   - datetime.fromisoformat(c["periodStart"])).total_seconds()
        total += c["flux"] * c["factor"] * seconds
    return total


def test_the_window_chosen_does_not_change_an_intensity(conn):
    """LE CHOIX DES BORNES EST LIBRE, ET C'EST DÉMONTRABLE — décision du 2 août.

    En H1 les opérations sont réputées parfaitement continues et étalées sur le
    mois. Sur une fenêtre plus courte les émissions diminuent au prorata du
    temps ; mais la production aussi — trente barres dans le mois en font quinze
    en quinze jours. Un numérateur deux fois plus petit divisé par un
    dénominateur deux fois plus petit donne le même nombre.

    Ce test existe parce que la propriété est ce qui autorise à ne contraindre
    aucune borne. Si elle se cassait — un jour où le découpage cesserait d'être
    exactement proportionnel — l'API continuerait d'accepter n'importe quelles
    dates en rendant des intensités qui dépendent du choix, ce qui est le genre
    de faux qu'on ne remarque pas.
    """
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")

    def over(start, end):
        return _integrated(db.cells_overlapping(conn, [_range(start, end)]))

    whole = over("2026-01-01", "2026-02-01")
    ten_days = over("2026-01-05", "2026-01-15")
    assert ten_days == pytest.approx(whole * 10 / 31), "les émissions ne suivent pas la durée"

    # Le dénominateur est lui aussi un débit : trente barres sur le mois.
    bars_per_second = 30 / (31 * 86400)
    per_bar = lambda emitted, days: emitted / (bars_per_second * days * 86400)
    assert per_bar(ten_days, 10) == pytest.approx(per_bar(whole, 31)), \
        "l'intensité par barre dépend de la fenêtre choisie"


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
    """Le facteur est un nombre en kgCO2e par unité SI d'activité, et cette unité
    se déduit de la dimension. La porter une seconde fois créerait deux sources
    de vérité pour une information unique."""
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(conn, [_range("2026-01-01", "2026-02-01")])[0]
    assert "factorUnit" not in got
    assert "unit" not in got, "l'unité d'activité est revenue doubler la dimension"
    assert got["dimension"] == "volume" and got["factor"] == 2680
    # Le facteur d'affichage voyage AVEC son unité : « en litres » ne veut rien
    # dire sans lui, à moins de tenir une table des symboles et de leurs
    # multiples — c'est ce système-là qu'on refuse d'écrire.
    assert got["displayUnit"] == "L" and got["displayScale"] == 1000
    # L'unité de production, donc l'étape : un entier d'une taxonomie masquée.
    assert got["step"] == 1


def test_no_decimal_crosses_the_boundary(conn):
    """Un Decimal traverserait vers JavaScript sans représentation convenue —
    le genre de divergence qui ne se voit qu'au moment où une signature ne se
    vérifie plus."""
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    got = db.cells_overlapping(conn, [_range("2026-01-01", "2026-02-01")])
    for key in ("flux", "factor"):
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


def test_overlapping_windows_are_refused_rather_than_merged(client, conn):
    """Deux intervalles demandés qui se recouvrent sont une erreur.

    Les fusionner rendrait un chiffre juste pour une requête qui ne veut rien
    dire, et apprendrait au client que la forme n'a pas d'importance : le jour où
    le recouvrement viendrait d'un bogue de son côté, rien ne le lui dirait.

    Les TROUS ne sont pas contrôlés, et c'est délibéré : entre deux opérations un
    produit intermédiaire peut dormir en stock sans rien émettre.
    """
    _cell(conn, "janvier", "2026-01-01", "2026-02-01")
    body = {"periods": [{"start": "2026-01-05T00:00:00Z", "end": "2026-01-20T00:00:00Z"},
                        {"start": "2026-01-15T00:00:00Z", "end": "2026-01-25T00:00:00Z"}]}
    r = _as(client, "agm-randy", "/api/v1/ranges", "post", json=body)
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "PERIODS_OVERLAP"

    # Les mêmes intervalles avec un trou entre eux passent le contrôle : c'est ce
    # qui prouve qu'il vise le recouvrement et non le multi-intervalle lui-même.
    # Appelé directement plutôt que par HTTP — la réponse serait signée, et une
    # clé de signature n'a rien à faire dans un cas qui parle d'intervalles.
    store_app._assert_disjoint(
        [_range("2026-01-05", "2026-01-20"), _range("2026-01-22", "2026-01-25")])


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
                             flux, dimension, display_unit, factor, origin, coverage)
           VALUES (%s, tstzrange('2025-01-01'::timestamptz, '2025-02-01'::timestamptz, '[)'),
                   %s, 1000, 1, 1, 10, 'volume', 'L', 2680, %s, %s)""",
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
    _quality_cell(conn, "q2", 10, origin="MEASURED", coverage="COMPLETE")

    row = _as(client, "natixar", "/api/v1/counts").json()["byOrganisation"][0]
    assert row["cells"] == 2
    assert row["measured"] == 2, "la couverture a mangé l'origine"
    assert row["missing"] == 1
    # Et rien de plus : H1 ne prétend pas dire si une règle de calcul attendait
    # une grandeur absente. Le savoir demande l'intention de calcul, qui n'est
    # pas stockée ; une colonne de plus ici serait une règle codée en dur
    # présentée comme un indice mesuré.
    assert "incomplete" not in row


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


def test_me_names_the_organisation_that_signs_origins(conn, client):
    """Le contrat que le front a écrit en premier : `organisation.did`.

    Ce service rendait `issuer.did`, et ce DID était celui de Natixar. Le front
    lisant `organisation.did`, il ne trouvait rien et désactivait la signature —
    « No organisation identity available » — sur toutes les pages, en ligne, sans
    qu'aucun test ne le voie. Les deux champs coexistent maintenant parce qu'ils
    désignent deux personnes morales : la mine signe l'origine, Natixar signe le
    chiffre carbone.
    """
    conn.execute("INSERT INTO entity (id, label, did, legal_name) "
                 "VALUES (100, 'AGM Inc.', 'did:web:guygold.com', 'AGM Inc')")

    body = _as(client, "agm-randy", "/api/v1/me").json()
    assert body["organisation"]["did"] == "did:web:guygold.com"
    assert body["organisation"]["name"] == "AGM Inc."
    assert body["organisation"]["legalName"] == "AGM Inc"
    # L'émetteur du chiffre carbone reste Natixar, et ce n'est PAS le même.
    assert body["issuer"]["did"] != body["organisation"]["did"]


def test_a_user_without_an_organisation_gets_null_not_a_guess(conn, client):
    """`natixar` exploite la plateforme ; il ne signe aucune origine.

    Rendre là une organisation par défaut lui ferait signer au nom d'un client.
    """
    body = _as(client, "natixar", "/api/v1/me").json()
    assert body["organisation"] is None
    assert body["authenticated"] is True


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
