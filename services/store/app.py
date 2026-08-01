"""Le magasin — la base, aucune clé de signature d'attestation.

Il signe ses EXTRACTIONS, ce qui n'est pas la même chose : cette signature dit
« ces enregistrements viennent bien de moi », jamais « ce chiffre carbone est
vrai ». L'invariant tient donc : la clé qui atteste et les données ne se
rencontrent pas.

Trois routes, et la troisième a la même réponse que la première pour une raison
qui n'est pas un hasard. Traefik authentifie par `basicAuth` et transmet
l'utilisateur en en-tête ; un serveur statique ne lit pas les en-têtes, donc le
nom arrive à la porte et n'entre pas dans la page. Le service qui reçoit les
attestations est aussi celui qui sait traduire l'en-tête en identité — deux
questions, une réponse, ce qui est le signe qu'on tient le bon découpage.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from fastapi import FastAPI, Header, HTTPException, Request
from psycopg.types.range import Range

import db
from signing import sign_payload

app = FastAPI(title="Aurora — magasin", docs_url=None, redoc_url=None)

#: LES RÔLES, ET CE QU'ILS PEUVENT ATTEINDRE.
#:
#: Un menu qui cache un lien ne protège de rien : la page est en JavaScript, le
#: lien se devine, et `curl` ne lit pas les menus. Si le vérificateur
#: indépendant n'a pas le droit de voir les autres barres, c'est ICI que ça se
#: décide — sinon la démonstration affirme une garantie qu'une seule requête
#: dément.
#:
#: Couche 0, délibérément : Traefik authentifie par `basicAuth`, ce service
#: autorise par nom d'utilisateur. Le cadre complet — permissions
#: `ressource.action`, portée en base — est l'issue #39 et relève de H2. Ce qui
#: suit tient en dix lignes et rend l'énoncé vrai.
ROLES = {
    # La mine : ses propres données, ses propres attestations. Ni « counts » ni
    # « tenants » — la vue de qualité porte sur la PLATEFORME, donc sur les
    # autres clients aussi, et un client n'a rien à savoir de qui d'autre est
    # là. Le commentaire disait déjà « ses propres données » et l'ensemble
    # contenait « counts » : la table contredisait sa propre légende, et
    # `test_the_mine_reaches_its_own_data` l'affirmait depuis le début sans
    # jamais s'exécuter — rien ne déclenche la CI sur une branche sans PR.
    "agm-randy": {"cube", "credentials"},
    # Natixar exploite la plateforme et ne parcourt pas les lingots du client.
    # Des dénombrements et des indicateurs de qualité, rien de nominatif — sauf
    # le nom des organisations de tête, sans lequel on ne peut pas intervenir
    # auprès du client dont les données se dégradent.
    "natixar": {"counts", "tenants"},
    # Le vérificateur indépendant ne consulte RIEN chez nous : on lui a remis
    # une attestation pour une barre, et il la vérifie hors ligne — clé publique
    # depuis le domaine de l'émetteur, signature, recalcul. Lui ouvrir le cube
    # lui donnerait le rythme de production d'AGM en prime.
    "demo": set(),
}


def _grants(user: str | None) -> set[str]:
    return ROLES.get(user or "", set())


def _require(user: str | None, grant: str) -> None:
    if grant not in _grants(user):
        raise HTTPException(403, {"error": "NOT_PERMITTED", "detail": grant})

ISSUER_DID = os.environ.get("STORE_ISSUER_DID", "did:web:natixar.pro")
KEY_PATH = os.environ.get("STORE_KEY_PATH", "/run/secrets/store_key")

#: Une extraction sans borne ramènerait tout le cube. La borne est une décision
#: de service, pas une limite technique : elle rend le coût d'une requête
#: prévisible, ce qui est la seule chose qui protège d'une requête maladroite.
MAX_INTERVALS = 64


def _load_key():
    return serialization.load_pem_private_key(Path(KEY_PATH).read_bytes(), password=None)


def _parse_period(item: dict) -> Range:
    try:
        start = datetime.fromisoformat(item["start"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(item["end"].replace("Z", "+00:00"))
    except (KeyError, AttributeError, ValueError) as exc:
        raise HTTPException(422, {"error": "PERIOD_INVALID", "detail": str(exc)}) from exc
    if end <= start:
        raise HTTPException(422, {"error": "PERIOD_EMPTY", "detail": f"{item['start']}..{item['end']}"})
    return Range(start.astimezone(timezone.utc), end.astimezone(timezone.utc), "[)")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/api/v1/me")
def me(x_webauth_user: str | None = Header(default=None)) -> dict:
    """L'identité vient de Traefik, jamais du client.

    Répondre `authenticated: false` n'est pas une panne : c'est la page qui dit
    la vérité sur son état. Le bandeau de mode dégradé en découle.
    """
    if not x_webauth_user:
        return {"authenticated": False, "issuer": {"did": ISSUER_DID}}
    return {
        "authenticated": True,
        "person": {"id": x_webauth_user, "name": x_webauth_user},
        # Ce que le porteur peut atteindre. Le menu s'en déduit, mais c'est le
        # service qui tranche : la liste est descriptive, pas normative.
        "grants": sorted(_grants(x_webauth_user)),
        "issuer": {"did": ISSUER_DID},
        "keyPolicy": {"keyName": "key-1"},
    }


@app.post("/api/v1/ranges")
async def ranges(request: Request, x_webauth_user: str | None = Header(default=None)) -> dict:
    """Les cellules qui recouvrent les intervalles demandés, signées.

    La requête ne porte QUE du temps. Le client filtre les autres dimensions
    après réception — c'est ce qui garde la surface de requête, donc la surface
    de fuite, réduite à un seul axe.
    """
    _require(x_webauth_user, "cube")
    body = await request.json()
    periods = body.get("periods") or []
    if not isinstance(periods, list) or not periods:
        raise HTTPException(422, {"error": "PERIODS_REQUIRED"})
    if len(periods) > MAX_INTERVALS:
        raise HTTPException(422, {"error": "TOO_MANY_INTERVALS", "detail": f"max {MAX_INTERVALS}"})

    ranges_ = [_parse_period(p) for p in periods]

    with db.connect() as conn:
        cells = db.cells_overlapping(conn, ranges_)

    # `servedAt` et le dénombrement entrent dans ce qui est signé : le
    # signataire doit pouvoir constater qu'il a reçu tout ce que le magasin dit
    # avoir servi, et non seulement que les cellules sont authentiques.
    payload = {
        "cells": cells,
        "count": len(cells),
        "servedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    return sign_payload(payload, _load_key())


@app.get("/api/v1/counts")
def counts(x_webauth_user: str | None = Header(default=None)) -> dict:
    """Des dénombrements, la répartition des origines, et la même chose par client.

    C'est la vue de l'exploitant : combien d'objets, de quelle qualité. Aucun
    identifiant de lingot, aucun nom de département — de quoi surveiller une
    plateforme sans lire les affaires d'un client.

    POURQUOI LE TOTAL NE SUFFIT PAS. Une moyenne sur toute la plateforme ne
    bouge pas quand un client sur vingt se dégrade : elle noie exactement le
    signal pour lequel on la regarde, et elle le noie d'autant mieux qu'il y a
    plus de clients. Or on n'intervient pas auprès d'une moyenne. La répartition
    par organisation de tête est donc l'instrument, et le total n'en est que le
    résumé.

    CE QU'ELLE DIVULGUE, ET À QUI. Elle nomme les organisations de tête, donc les
    clients. C'est réservé au grant `tenants`, que l'exploitant a et qu'un client
    n'a pas : apprendre à AGM qui d'autre est sur la plateforme n'est pas une
    fonctionnalité. Les départements, eux, restent invisibles des deux côtés.
    """
    _require(x_webauth_user, "counts")
    with db.connect() as conn:
        rows = conn.execute(
            """SELECT origin, count(*) AS n FROM cell GROUP BY origin ORDER BY n DESC"""
        ).fetchall()
        totals = conn.execute(
            """SELECT (SELECT count(*) FROM cell)       AS cells,
                      (SELECT count(*) FROM entity)     AS entities,
                      (SELECT count(*) FROM credential) AS credentials"""
        ).fetchone()

        by_org = []
        if "tenants" in _grants(x_webauth_user):
            by_org = conn.execute(
                # Le client d'une cellule est la RACINE de son entité. Remonter
                # l'arbre plutôt que porter un `tenant_id` sur la cellule : la
                # colonne dupliquerait ce que `parent` sait déjà, et le jour où
                # les deux divergeraient, c'est la colonne qu'on croirait.
                """
                WITH RECURSIVE root_of(id, root) AS (
                        SELECT id, id FROM entity WHERE parent IS NULL
                    UNION ALL
                        SELECT e.id, r.root
                          FROM entity e JOIN root_of r ON e.parent = r.id
                )
                SELECT head.label AS organisation,
                       count(*)                                             AS cells,
                       count(*) FILTER (WHERE c.origin = 'MEASURED')        AS measured,
                       count(*) FILTER (WHERE c.origin = 'DERIVED')         AS derived,
                       count(*) FILTER (WHERE c.origin = 'ESTIMATED')       AS estimated,
                       count(*) FILTER (WHERE c.origin = 'NOT_MEASURED')    AS "notMeasured",
                       count(*) FILTER (WHERE c.coverage = 'INCOMPLETE')    AS incomplete,
                       count(*) FILTER (WHERE c.coverage = 'MISSING')       AS missing
                  FROM cell c
                  JOIN root_of r  ON r.id = c.entity_id
                  JOIN entity head ON head.id = r.root
                 GROUP BY head.label
                 ORDER BY count(*) DESC
                """
            ).fetchall()

    return {"totals": totals, "byOrigin": rows, "byOrganisation": by_org}


@app.post("/api/v1/credentials", status_code=201)
async def receive_credential(request: Request,
                             x_webauth_user: str | None = Header(default=None)) -> dict:
    """Reçoit une attestation de la mine et la conserve telle quelle.

    Aucune reformulation : elle est signée, donc figée. La réécrire — même pour
    l'embellir — l'invaliderait.
    """
    doc = await request.json()
    try:
        with db.connect() as conn:
            stored = db.insert_credential(conn, doc, x_webauth_user)
    except ValueError as exc:
        raise HTTPException(422, {"error": "CREDENTIAL_INVALID", "detail": str(exc)}) from exc
    return stored


@app.get("/api/v1/credentials")
def list_credentials(limit: int = 100,
                     x_webauth_user: str | None = Header(default=None)) -> dict:
    _require(x_webauth_user, "credentials")
    with db.connect() as conn:
        return {"credentials": db.list_credentials(conn, min(limit, 500))}


@app.get("/api/v1/credentials/index")
def credential_index(x_webauth_user: str | None = Header(default=None)) -> dict:
    """Ce qui existe, sans les documents.

    Le registre du front interroge ceci pour savoir quelles barres sont
    certifiées ailleurs — celles dont le navigateur a perdu l'attestation. Trois
    cent soixante-dix-huit documents complets pour peupler un tableau seraient
    des mégaoctets là où quelques kilo-octets suffisent.
    """
    _require(x_webauth_user, "credentials")
    with db.connect() as conn:
        return {"index": db.credential_index(conn)}


@app.get("/api/v1/credentials/{subject:path}")
def credential_by_subject(subject: str,
                          x_webauth_user: str | None = Header(default=None)) -> dict:
    """Les attestations d'une barre — récupérées une par une, à la demande.

    Le portefeuille ne se repeuple pas tout seul : le navigateur détient ce que
    l'opérateur y a mis, et « certifiée ailleurs » reste un état visible plutôt
    qu'un trou comblé en silence. Récupérer est un acte, et il vérifie la
    signature à l'arrivée.
    """
    _require(x_webauth_user, "credentials")
    with db.connect() as conn:
        found = db.credential_by_subject(conn, subject)
    if not found:
        raise HTTPException(404, {"error": "CREDENTIAL_UNKNOWN", "detail": subject})
    return {"credentials": found}
