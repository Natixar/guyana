"""Le magasin signe ce qu'il sert.

Sans cette signature, le signataire recalcule à partir d'une charge que le
client lui a fournie, et recalculer ne prouve alors plus rien : les entrées
viennent de celui dont on ne veut justement pas croire la conclusion.

Deux pièges d'interopérabilité, tous deux invisibles à la lecture :

1. **DER contre P1363.** `cryptography` produit une signature ECDSA encodée en
   DER — une séquence ASN.1 de longueur variable. WebCrypto, lui, n'accepte que
   la forme brute `r || s`, 64 octets pour P-256. Une signature DER passée à
   `crypto.subtle.verify` ne lève pas : elle renvoie `false`, ce qui ressemble à
   une clé fausse ou à des octets altérés. La conversion est donc ici, et un
   test la vérifie en faisant réellement vérifier Node.

2. **base58btc.** Le champ `proofValue` est en multibase, préfixe `z`. Ce n'est
   pas du base64 et ce n'est pas le base58 de Bitcoin appliqué à un condensat :
   c'est l'encodage direct des octets, zéros de tête compris.
"""

from __future__ import annotations

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from jcs import canonical_bytes

__all__ = ["sign_payload", "base58btc_encode", "multibase58", "der_to_raw"]

_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

#: P-256 : r et s font chacun 32 octets une fois complétés à gauche.
_COORD = 32


def base58btc_encode(data: bytes) -> str:
    """base58btc, zéros de tête compris.

    Chaque octet nul de tête devient un « 1 » : c'est ce qui rend l'encodage
    injectif, et c'est la partie qu'une implémentation naïve oublie parce que
    l'arithmétique sur les grands entiers les perd.
    """
    leading = len(data) - len(data.lstrip(b"\x00"))
    number = int.from_bytes(data, "big")
    out = ""
    while number:
        number, rest = divmod(number, 58)
        out = _ALPHABET[rest] + out
    return "1" * leading + out


def multibase58(data: bytes) -> str:
    """Le préfixe `z` désigne base58btc dans la table multibase."""
    return "z" + base58btc_encode(data)


def der_to_raw(der: bytes) -> bytes:
    """DER (ASN.1) vers P1363 (`r || s`), la seule forme que WebCrypto accepte."""
    r, s = decode_dss_signature(der)
    return r.to_bytes(_COORD, "big") + s.to_bytes(_COORD, "big")


def sign_payload(payload: dict, private_key: ec.EllipticCurvePrivateKey) -> dict:
    """Renvoie la charge augmentée de sa preuve.

    La preuve porte sur la charge **privée de sa preuve** : une signature ne
    peut pas faire partie de ce qu'elle signe. Le signataire retire donc le
    champ `proof` avant de canonicaliser, et cette fonction ne l'ajoute qu'après
    avoir signé — les deux moitiés de la même règle.
    """
    if "proof" in payload:
        raise ValueError("la charge porte déjà une preuve")
    der = private_key.sign(canonical_bytes(payload), ec.ECDSA(hashes.SHA256()))
    return {**payload, "proof": {"proofValue": multibase58(der_to_raw(der))}}
