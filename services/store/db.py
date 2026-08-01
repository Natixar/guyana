"""Accès à PostgreSQL. Le magasin est le seul à en avoir un.

Le signataire n'a aucune route vers cette base — vérifié deux fois par
`deploy/verify/verify-service-isolation.bats`, parce que l'absence de réseau se
lit dans la configuration alors que l'injoignabilité se constate, et que la
première peut être vraie pendant que la seconde est fausse.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.range import Range

from jcs import canonical_bytes

HERE = Path(__file__).resolve().parent


def dsn() -> str:
    """La chaîne de connexion vient de l'environnement, jamais du dépôt."""
    return os.environ.get("STORE_DSN", "postgresql:///aurora")


def connect() -> psycopg.Connection:
    return psycopg.connect(dsn(), row_factory=dict_row, autocommit=True)


def apply_schema(conn: psycopg.Connection) -> None:
    conn.execute((HERE / "schema.sql").read_text("utf-8"))


def cells_overlapping(conn: psycopg.Connection, periods: list[Range]) -> list[dict]:
    """Les cellules dont la période recouvre l'un des intervalles demandés.

    Une liste d'intervalles, et non un seul : l'empreinte temporelle d'un lot est
    un multi-intervalle — un par opération — et c'est précisément pourquoi un lot
    n'est pas réductible à une fenêtre. Passer l'enveloppe convexe sur-collecte ;
    passer les intervalles réels ne sur-collecte pas, et le serveur n'apprend
    toujours pas que ce multi-intervalle désigne un lot.

    `&& ANY(...)` reste indexable par le GiST, là où une disjonction construite
    à la main ne le serait pas nécessairement.
    """
    if not periods:
        return []
    rows = conn.execute(
        """
        SELECT c.id, c.sub_post AS "subPost", c.part_type AS "partType",
               c.caracterisation, c.value, u.symbol AS unit,
               c.factor, c.factor_unit AS "factorUnit", c.origin,
               lower(c.period) AS "periodStart", upper(c.period) AS "periodEnd"
          FROM cell c
          JOIN unit u ON u.id = c.unit_id
         WHERE c.period && ANY(%s)
         ORDER BY c.id
        """,
        (periods,),
    ).fetchall()
    return [_json_ready(r) for r in rows]


def _json_ready(row: dict) -> dict:
    """Les horodatages partent en ISO 8601 ; le reste est déjà scalaire.

    Aucun `Decimal` ne sort d'ici : `double precision` donne des flottants, et
    c'est délibéré. Un `NUMERIC` traverserait la frontière vers JavaScript sans
    représentation convenue, ce qui est le genre de divergence qui ne se voit
    qu'au moment où une signature ne se vérifie plus.
    """
    out = dict(row)
    for key in ("periodStart", "periodEnd"):
        if out.get(key) is not None:
            out[key] = out[key].isoformat().replace("+00:00", "Z")
    return out


def credential_type(doc: dict) -> str:
    """Le type significatif, « VerifiableCredential » étant porté par toutes.

    Sans lui, l'origine et l'intensité carbone d'une même barre seraient
    indistinguables — et elles partagent le même sujet.
    """
    types = doc.get("type") or []
    if isinstance(types, str):
        types = [types]
    meaningful = [t for t in types if t != "VerifiableCredential"]
    return meaningful[0] if meaningful else "VerifiableCredential"


def insert_credential(conn: psycopg.Connection, doc: dict, received_by: str | None) -> dict:
    """Range une attestation. L'identité est l'empreinte du document.

    Renvoyer deux fois le même fichier ne crée rien ; une réémission pour le
    même sujet est une ligne de plus, et le registre prendra la plus récente.
    """
    subject = (doc.get("credentialSubject") or {}).get("id")
    if not subject:
        raise ValueError("attestation sans credentialSubject.id")

    digest = hashlib.sha256(canonical_bytes(doc)).hexdigest()
    kind = credential_type(doc)

    conn.execute(
        """
        INSERT INTO credential (digest, subject, type, received_by, document)
             VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (digest) DO NOTHING
        """,
        (digest, subject, kind, received_by, psycopg.types.json.Jsonb(doc)),
    )
    return {"subject": subject, "type": kind, "digest": digest}


def list_credentials(conn: psycopg.Connection, limit: int = 100) -> list[dict]:
    """La plus récente par (sujet, type), documents compris."""
    rows = conn.execute(
        """
        SELECT DISTINCT ON (subject, type)
               digest, subject, type,
               received_at AS "receivedAt", received_by AS "receivedBy", document
          FROM credential
         ORDER BY subject, type, received_at DESC
         LIMIT %s
        """,
        (limit,),
    ).fetchall()
    for r in rows:
        r["receivedAt"] = r["receivedAt"].isoformat().replace("+00:00", "Z")
    return rows


def credential_index(conn: psycopg.Connection) -> list[dict]:
    """Le registre : qui existe, sans les documents.

    Trois cent soixante-dix-huit attestations complètes pour peupler un tableau
    seraient plusieurs mégaoctets là où quelques kilo-octets suffisent. Le
    document ne part que si on le demande, une barre à la fois.
    """
    rows = conn.execute(
        """
        SELECT DISTINCT ON (subject, type)
               subject, type, digest, received_at AS "receivedAt"
          FROM credential
         ORDER BY subject, type, received_at DESC
        """
    ).fetchall()
    for r in rows:
        r["receivedAt"] = r["receivedAt"].isoformat().replace("+00:00", "Z")
    return rows


def credential_by_subject(conn: psycopg.Connection, subject: str) -> list[dict]:
    """Les attestations d'une barre, la plus récente de chaque type."""
    rows = conn.execute(
        """
        SELECT DISTINCT ON (type)
               digest, subject, type,
               received_at AS "receivedAt", received_by AS "receivedBy", document
          FROM credential
         WHERE subject = %s
         ORDER BY type, received_at DESC
        """,
        (subject,),
    ).fetchall()
    for r in rows:
        r["receivedAt"] = r["receivedAt"].isoformat().replace("+00:00", "Z")
    return rows
