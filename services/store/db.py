"""Accès à PostgreSQL. Le magasin est le seul à en avoir un.

Le signataire n'a aucune route vers cette base — vérifié deux fois par
`deploy/verify/verify-service-isolation.bats`, parce que l'absence de réseau se
lit dans la configuration alors que l'injoignabilité se constate, et que la
première peut être vraie pendant que la seconde est fausse.
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.range import Range

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


def insert_credential(conn: psycopg.Connection, doc: dict, received_by: str | None) -> str:
    subject = (doc.get("credentialSubject") or {}).get("id")
    if not subject:
        raise ValueError("attestation sans credentialSubject.id")
    conn.execute(
        """
        INSERT INTO credential (id, received_by, document)
             VALUES (%s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (subject, received_by, psycopg.types.json.Jsonb(doc)),
    )
    return subject


def list_credentials(conn: psycopg.Connection, limit: int = 100) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, received_at AS "receivedAt", received_by AS "receivedBy", document
          FROM credential
         ORDER BY received_at DESC
         LIMIT %s
        """,
        (limit,),
    ).fetchall()
    for r in rows:
        r["receivedAt"] = r["receivedAt"].isoformat().replace("+00:00", "Z")
    return rows
