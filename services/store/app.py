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
        "issuer": {"did": ISSUER_DID},
        "keyPolicy": {"keyName": "key-1"},
    }


@app.post("/api/v1/ranges")
async def ranges(request: Request) -> dict:
    """Les cellules qui recouvrent les intervalles demandés, signées.

    La requête ne porte QUE du temps. Le client filtre les autres dimensions
    après réception — c'est ce qui garde la surface de requête, donc la surface
    de fuite, réduite à un seul axe.
    """
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
def list_credentials(limit: int = 100) -> dict:
    with db.connect() as conn:
        return {"credentials": db.list_credentials(conn, min(limit, 500))}


@app.get("/api/v1/credentials/index")
def credential_index() -> dict:
    """Ce qui existe, sans les documents.

    Le registre du front interroge ceci pour savoir quelles barres sont
    certifiées ailleurs — celles dont le navigateur a perdu l'attestation. Trois
    cent soixante-dix-huit documents complets pour peupler un tableau seraient
    des mégaoctets là où quelques kilo-octets suffisent.
    """
    with db.connect() as conn:
        return {"index": db.credential_index(conn)}


@app.get("/api/v1/credentials/{subject:path}")
def credential_by_subject(subject: str) -> dict:
    """Les attestations d'une barre — récupérées une par une, à la demande.

    Le portefeuille ne se repeuple pas tout seul : le navigateur détient ce que
    l'opérateur y a mis, et « certifiée ailleurs » reste un état visible plutôt
    qu'un trou comblé en silence. Récupérer est un acte, et il vérifie la
    signature à l'arrivée.
    """
    with db.connect() as conn:
        found = db.credential_by_subject(conn, subject)
    if not found:
        raise HTTPException(404, {"error": "CREDENTIAL_UNKNOWN", "detail": subject})
    return {"credentials": found}
