#!/usr/bin/env python3
"""Vérifie que tout libellé demandé existe dans la table de sa langue.

Les libellés vivent dans `data/ui/<lang>.toml` et sont consommés de deux
manières : `T.<clé>` dans les modules JavaScript, `partial "t" "<clé>"` dans les
gabarits. Rien dans la chaîne Hugo ne relie les deux — renommer une entrée
casse son consommateur sans erreur de construction ni test rouge. C'est la
faute #62, neuf libellés muets dont trois messages qui expliquent pourquoi la
page ne peut pas signer.

Ce contrôle est la spécification de l'invariant : *une clé demandée est une clé
définie*. Il échoue sur une clé introuvable, et signale sans échouer les clés
définies mais jamais employées — la famille `v*` est légitimement inemployée
tant que la page de vérification n'est pas câblée, et un avertissement qui
bloque la construction serait vite désactivé.

    python3 site/check-labels.py            # depuis la racine du dépôt
    python3 check-labels.py                 # depuis site/
"""

import re
import sys
from pathlib import Path

KEY_IN_TOML = re.compile(r"^(\w+)\s*=", re.M)
KEY_IN_JS = re.compile(r"\bT\.(\w+)")
KEY_IN_TEMPLATE = re.compile(r'partial\s+"t"\s+"(\w+)"')


def collect(root: Path) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Renvoie (clés définies par langue, clés employées avec leurs fichiers)."""
    defined = {
        p.stem: set(KEY_IN_TOML.findall(p.read_text(encoding="utf-8")))
        for p in sorted((root / "data" / "ui").glob("*.toml"))
    }

    used: dict[str, set[str]] = {}
    for path, pattern in [
        *((p, KEY_IN_JS) for p in sorted((root / "assets" / "js").rglob("*.js"))),
        *((p, KEY_IN_TEMPLATE) for p in sorted((root / "layouts").rglob("*.html"))),
    ]:
        for key in pattern.findall(path.read_text(encoding="utf-8")):
            used.setdefault(key, set()).add(str(path.relative_to(root)))

    return defined, used


def main() -> int:
    root = Path(__file__).resolve().parent
    defined, used = collect(root)

    if not defined:
        print("échec : aucune table de libellés sous data/ui/", file=sys.stderr)
        return 1

    failed = False
    for lang, keys in sorted(defined.items()):
        missing = {k: v for k, v in used.items() if k not in keys}
        if missing:
            failed = True
            print(f"\néchec — libellés demandés et non définis dans data/ui/{lang}.toml :", file=sys.stderr)
            for key in sorted(missing):
                print(f"  T.{key}  employé dans {', '.join(sorted(missing[key]))}", file=sys.stderr)
                # Le renommage par préfixe est la faute observée : on propose la clé.
                near = sorted(k for k in keys if k.lower().endswith(key.lower()))
                if near:
                    print(f"      vouliez-vous dire {' ou '.join(near)} ?", file=sys.stderr)

        unused = sorted(keys - set(used))
        if unused:
            print(f"note — définis dans data/ui/{lang}.toml et jamais employés : {', '.join(unused)}")

    if failed:
        print("\nUne clé demandée doit être une clé définie.", file=sys.stderr)
        return 1

    total = sum(len(v) for v in defined.values())
    print(f"ok — {len(used)} libellés demandés, tous définis ({total} clés sur {len(defined)} langue(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
