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


def _digits_and_point(text: str) -> tuple[str, int]:
    """Décompose `repr` en (chiffres significatifs, position du point).

    Rend `(s, n)` tels que la valeur vaut `0.s × 10ⁿ`, `s` étant dépourvu de
    zéro de tête comme de queue. C'est la forme dans laquelle ECMAScript énonce
    sa règle, et la traduire une fois évite de la réinventer par cas.
    """
    mantissa, _, exponent = text.partition("e")
    exp = int(exponent) if exponent else 0
    integer, _, fraction = mantissa.partition(".")

    raw = integer + fraction
    stripped = raw.lstrip("0")
    lead = len(raw) - len(stripped)
    return stripped.rstrip("0"), len(integer) + exp - lead


def _number(value: float | int) -> str:
    """Le format ECMAScript, seul format que la RFC 8785 admette.

    ─── POURQUOI CETTE FONCTION EST ÉCRITE EN ENTIER ────────────────────────

    Elle se contentait de retoucher la sortie de `repr`, et cela paraissait
    suffire parce que les deux langages choisissent les MÊMES chiffres — la plus
    courte chaîne qui reconstruit le flottant. Ils ne choisissent pas la même
    NOTATION, et le seuil diffère : Python passe en exponentiel sous 1e-4,
    ECMAScript seulement sous 1e-6.

    Tout nombre de l'intervalle [1e-7, 1e-4[ était donc écrit `2.08e-5` d'un
    côté et `0.0000208` de l'autre. Deux chaînes, deux condensats, une signature
    qui ne se vérifie pas.

    C'EST L'INTERVALLE OÙ VIVENT LES DÉBITS. Une métrique mensuelle divisée par
    la durée du mois — deux millions six cent mille secondes — y tombe presque
    toujours. Aucune extraction du cube ne pouvait donc être vérifiée par le
    signataire : `EXTRACTION_SIGNATURE_INVALID` sur la première demande
    d'attestation carbone réellement faite en ligne, le 3 août 2026.

    Le raccourci `value == int(value)` disparaît : l'algorithme le couvre, et un
    raccourci qui double une règle est un endroit où les deux peuvent diverger.

    ─── LA RÈGLE, TELLE QUE ECMAScript L'ÉNONCE ────────────────────────────

    La valeur vaut `0.s × 10ⁿ`, où `s` porte `k` chiffres significatifs. Alors :

        k ≤ n ≤ 21      s suivi de (n − k) zéros
        0 < n ≤ 21      s, point décimal après n chiffres
        −6 < n ≤ 0      « 0. », (−n) zéros, puis s
        sinon           notation exponentielle, exposant n − 1

    Les quatre branches sont écrites telles quelles plutôt que dérivées les unes
    des autres : c'est la forme sous laquelle on peut les relire contre la
    spécification, et c'est la seule relecture qui protège de ce défaut-ci.
    """
    if isinstance(value, bool):  # bool hérite de int en Python : à intercepter avant
        raise JcsError("un booléen n'est pas un nombre")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise JcsError(f"nombre non sérialisable : {value}")
    if value == 0:
        return "0"  # couvre -0.0, que ECMAScript écrit « 0 »

    sign = "-" if value < 0 else ""
    s, n = _digits_and_point(repr(abs(value)))
    k = len(s)

    if k <= n <= 21:
        return sign + s + "0" * (n - k)
    if 0 < n <= 21:
        return sign + s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * -n + s
    exponent = n - 1
    mantissa = s if k == 1 else s[0] + "." + s[1:]
    return f"{sign}{mantissa}e{'+' if exponent >= 0 else '-'}{abs(exponent)}"


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
