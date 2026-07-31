"""Sérialisation canonique JSON — RFC 8785 (JCS), côté Python.

C'est la pièce qu'il ne faut pas rater, et pour une raison propre à ce
découpage : **le magasin signe ce qu'il sert, et le signataire vérifie cette
signature dans un autre langage**. Si Python et JavaScript ne produisent pas le
même octet pour le même objet, aucune extraction ne se vérifie — et la panne est
silencieuse jusqu'au moment où quelqu'un essaie de signer.

D'où `jcs-vectors.json`, partagé par les trois hôtes. Un vecteur qui passe des
deux côtés vaut mieux qu'une lecture attentive de la RFC des deux côtés.

Deux pièges que Python tend et que JavaScript ne tend pas :

- `json.dumps` écrit `1.0` là où ECMAScript écrit `1`, et `1e-07` là où
  ECMAScript écrit `1e-7` ;
- `True`/`False` s'écrivent capitalisés, et `-0.0` doit devenir `0`.

Le format des nombres suit donc ECMAScript `Number::toString`, réimplémenté ici
plutôt qu'emprunté à `repr`, qui n'a pas les mêmes règles.
"""

from __future__ import annotations

import json
import math
import re

__all__ = ["canonicalize", "canonical_bytes", "JcsError"]


class JcsError(ValueError):
    """Ce que la RFC exclut, refusé plutôt que sérialisé approximativement."""


def _number(value: float | int) -> str:
    """Le format ECMAScript, seul format que la RFC 8785 admette."""
    if isinstance(value, bool):  # bool hérite de int en Python : à intercepter avant
        raise JcsError("un booléen n'est pas un nombre")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise JcsError(f"nombre non sérialisable : {value}")
    if value == 0:
        return "0"  # couvre -0.0, que ECMAScript écrit « 0 »
    if value == int(value) and abs(value) < 1e21:
        return str(int(value))

    # `repr` donne la plus courte chaîne qui reconstruit la valeur — la même
    # propriété que ECMAScript. Restent les différences de notation.
    text = repr(value)
    if "e" in text or "E" in text:
        mantissa, _, exponent = text.partition("e")
        exp = int(exponent)
        mantissa = mantissa.rstrip("0").rstrip(".") if "." in mantissa else mantissa
        # ECMAScript n'emploie la notation exponentielle que hors de [1e-7, 1e21[
        # et écrit « e+21 » / « e-7 », sans zéro de tête dans l'exposant.
        return f"{mantissa}e{'+' if exp >= 0 else '-'}{abs(exp)}"
    return text


_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _string(value: str) -> str:
    """Échappement minimal : seuls les contrôles et les deux caractères réservés.

    Le non-ASCII reste tel quel — l'échapper en \\u serait valide en JSON mais
    donnerait d'autres octets que JavaScript, donc une autre signature.
    """
    out = ['"']
    for ch in value:
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif ord(ch) < 0x20:
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _serialize(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_serialize(v) for v in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise JcsError(f"clé non textuelle : {key!r}")
        # Tri par unités de code UTF-16, et non par points de code : au-delà du
        # plan de base les deux ordres diffèrent, et JavaScript trie en UTF-16.
        items = sorted(value.items(), key=lambda kv: _utf16_key(kv[0]))
        return "{" + ",".join(f"{_string(k)}:{_serialize(v)}" for k, v in items) + "}"
    raise JcsError(f"type non sérialisable : {type(value).__name__}")


def _utf16_key(text: str) -> tuple[int, ...]:
    return tuple(text.encode("utf-16-be").hex(" ", 2).split()) and tuple(
        int(unit, 16) for unit in text.encode("utf-16-be").hex(" ", 2).split()
    )


def canonicalize(value: object) -> str:
    """La forme canonique, en texte."""
    return _serialize(value)


def canonical_bytes(value: object) -> bytes:
    """Ce qui est réellement signé."""
    return canonicalize(value).encode("utf-8")
