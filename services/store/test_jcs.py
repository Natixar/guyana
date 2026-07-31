"""Le magasin sérialise-t-il comme le navigateur ?

    python3 -m pytest services/store/test_jcs.py -q

Les cas ne sont pas écrits ici : ils viennent de `site/static/engine/jcs-vectors.json`,
que le navigateur et le signataire exécutent aussi. Une implémentation qui passe
ses propres tests et diverge de l'autre langage est exactement la panne que ce
fichier existe pour rendre impossible — et elle serait silencieuse, puisqu'une
signature qui ne se vérifie pas ressemble à une signature invalide.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from jcs import JcsError, canonical_bytes, canonicalize

ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads((ROOT / "site/static/engine/jcs-vectors.json").read_text("utf-8"))


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_vector(case):
    assert canonicalize(case["value"]) == case["expect"]


@pytest.mark.parametrize("case", VECTORS["refuse"], ids=lambda c: c["name"])
def test_refused(case):
    value = {"NaN": math.nan, "Infinity": math.inf}[case["value"]]
    with pytest.raises(JcsError):
        canonicalize({"a": value})


def test_bytes_are_utf8():
    """Ce qui est signé, ce sont des octets, et l'encodage en fait partie."""
    assert canonical_bytes({"a": "é"}) == b'{"a":"\xc3\xa9"}'


def test_refuses_a_non_string_key():
    with pytest.raises(JcsError):
        canonicalize({1: "un"})


def test_surrogate_pair_sorts_as_utf16():
    """Au-delà du plan de base, l'ordre UTF-16 et l'ordre par point de code
    divergent. JavaScript trie en UTF-16 ; s'aligner sur les points de code
    produirait un ordre différent pour ces clés — donc une autre signature."""
    got = canonicalize({"\U0001F525": 1, "�": 2})
    # U+FFFD est un seul code unit (0xFFFD) ; U+1F525 est la paire D83D DD25,
    # dont le premier code unit vaut 0xD83D — donc l'émoji vient AVANT.
    assert got.index('"\U0001F525"') < got.index('"�"')
