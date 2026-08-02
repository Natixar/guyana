"""Ce que le magasin signe, Node doit savoir le vérifier.

    python3 -m pytest services/store/test_signing.py -q

Ces cas couvrent le côté Python. La preuve réelle de l'interopérabilité est
ailleurs : ce fichier ÉCRIT un échantillon signé, et `services/verify-store-signature.mjs`
le vérifie avec WebCrypto. Deux implémentations qui se croient d'accord ne
valent rien tant qu'aucune n'a vérifié la signature de l'autre.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from signing import base58btc_encode, der_to_raw, multibase58, sign_payload

HERE = Path(__file__).resolve().parent

# Les mêmes vecteurs que la page d'auto-test exécute côté navigateur.
BASE58 = [
    (b"hello world", "StV1DL6CwTryKyV"),
    (bytes([0, 0, 1]), "112"),
]


@pytest.mark.parametrize("data,expected", BASE58, ids=["vecteur connu", "zéros de tête"])
def test_base58btc(data, expected):
    assert base58btc_encode(data) == expected


def test_multibase_prefix():
    assert multibase58(b"hello world").startswith("z")


def test_der_to_raw_is_always_64_bytes():
    """Une signature DER varie de longueur ; la forme brute, jamais.

    C'est le cœur du piège : une valeur de r ou s dont l'octet de poids fort est
    nul raccourcit la forme DER, et une conversion naïve produirait 63 octets que
    WebCrypto refuserait — en renvoyant simplement `false`.
    """
    key = ec.generate_private_key(ec.SECP256R1())
    from cryptography.hazmat.primitives import hashes

    for _ in range(50):
        der = key.sign(b"essai", ec.ECDSA(hashes.SHA256()))
        assert len(der_to_raw(der)) == 64


def test_refuses_to_sign_a_payload_that_already_has_a_proof():
    key = ec.generate_private_key(ec.SECP256R1())
    with pytest.raises(ValueError):
        sign_payload({"cells": [], "proof": {"proofValue": "z"}}, key)


def test_writes_a_sample_for_the_javascript_host():
    """Écrit l'échantillon que Node vérifiera. Ce n'est pas un test au sens
    strict — c'est la moitié Python d'un contrôle qui se termine ailleurs."""
    key = ec.generate_private_key(ec.SECP256R1())
    payload = {
        "cells": [{
            "id": "c1", "subPost": 1000, "partType": 1, "caracterisation": 1,
            "flux": 1000, "dimension": "volume", "displayUnit": "L",
            "factor": 2.68, "origin": "MEASURED",
        }],
        "servedAt": "2026-08-01T00:00:00Z",
        # Non-ASCII et décimaux : les deux endroits où les sérialisations
        # divergent si l'on n'y prend pas garde.
        "note": "coulée à 1 083 °C",
    }
    signed = sign_payload(payload, key)

    public_jwk = json.loads(
        key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ) and _jwk(key)
    )

    (HERE / "store-signature-sample.json").write_text(
        json.dumps({"publicKey": public_jwk, "extraction": signed}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    assert signed["proof"]["proofValue"].startswith("z")


def _jwk(key: ec.EllipticCurvePrivateKey) -> str:
    """JWK public, la forme que `crypto.subtle.importKey` attend."""
    import base64

    numbers = key.public_key().public_numbers()
    b64 = lambda n: base64.urlsafe_b64encode(n.to_bytes(32, "big")).decode().rstrip("=")
    return json.dumps({
        "kty": "EC", "crv": "P-256",
        "x": b64(numbers.x), "y": b64(numbers.y),
    })
