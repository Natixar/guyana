"""La conversion des facteurs vers le SI, et le sens dans lequel elle va.

    python3 -m pytest services/store/test_units.py -q

POURQUOI CE FICHIER EXISTE. La question « faut-il multiplier ou diviser par
mille ? » s'est posée deux fois en relecture, et deux fois la réponse a été
donnée de mémoire. Une réponse de mémoire sur un facteur mille est exactement
ce que la doctrine SI de ce dépôt existe pour supprimer : elle produit un
nombre plausible, elle passe la relecture, et la signature la fige.

Ces cas ne demandent ni base, ni réseau, ni paquet AGM. Ils ne testent pas une
valeur — ils testent une PROPRIÉTÉ, et c'est ce qui les rend décisifs : un
changement d'unité ne change pas l'émission. Toute erreur de sens la déplace
d'un facteur un million, et le test la voit.
"""

from __future__ import annotations

import pytest

pytest.importorskip("psycopg")

import load_2025  # noqa: E402


def test_a_litre_emits_the_same_whichever_unit_it_is_stored_in():
    """LA PROPRIÉTÉ QUI TRANCHE. Un litre de gazole émet 2,68 kgCO2e.

    Le paquet AGM compte en litres, la base en mètres cubes. Le passage à
    l'unité SI divise la VALEUR par mille — un litre est un millième de mètre
    cube — et multiplie donc le FACTEUR par mille, pour que le produit ne bouge
    pas. C'est le produit qui est physique ; les deux nombres ne le sont pas.

    Diviser le facteur au lieu de le multiplier donnerait 2,68 microgrammes de
    CO2 par litre de gazole, ce qui est faux d'un facteur un million.
    """
    source_factor, source_unit = load_2025.SOURCE_FACTORS["diesel-combustion"]
    assert (source_factor, source_unit) == (2.68, "L")

    si_factor, si_unit = load_2025.si_factor("diesel-combustion")
    assert si_unit == "m3"

    one_litre_as_stored = 1 / 1000.0            # ce que fait `read_pack`
    assert one_litre_as_stored * si_factor == pytest.approx(source_factor * 1.0)


def test_going_to_a_larger_unit_makes_the_factor_larger():
    """Le sens, énoncé seul plutôt que déduit du cas précédent.

    Un mètre cube est mille fois PLUS GRAND qu'un litre, donc il émet mille fois
    plus, donc le facteur par mètre cube est mille fois PLUS GRAND. Écrit ainsi
    la question ne se repose pas.
    """
    si, _ = load_2025.si_factor("diesel-combustion")
    source, _ = load_2025.SOURCE_FACTORS["diesel-combustion"]
    assert si == pytest.approx(source * 1000)
    assert si > source, "le facteur a été divisé au lieu d'être multiplié"


def test_the_diesel_factors_are_the_ones_the_pack_gives():
    """Les trois facteurs, en SI, en clair — pour qu'un écart se voie ici."""
    assert load_2025.si_factor("diesel-combustion") == (2680.0, "m3")
    assert load_2025.si_factor("diesel-upstream") == (610.0, "m3")
    # Le kilogramme est déjà SI : rien à convertir, et surtout pas par mille.
    assert load_2025.si_factor("explosive") == (0.17, "kg")


def test_an_unconvertible_unit_is_refused_rather_than_guessed():
    """Convertir au jugé produirait un nombre plausible et faux.

    L'once troy, le gallon, le baril : chacun porte un facteur que quelqu'un
    finit par appliquer une fois de trop. Refuser oblige la source à se
    déclarer, ce qui est le seul moyen de ne pas se tromper à sa place.
    """
    load_2025.SOURCE_FACTORS["essai-non-convertible"] = (1.0, "gal")
    try:
        with pytest.raises(ValueError, match="non convertible"):
            load_2025.si_factor("essai-non-convertible")
    finally:
        del load_2025.SOURCE_FACTORS["essai-non-convertible"]


def test_the_loaded_total_stays_in_its_order_of_magnitude():
    """Un garde-fou grossier, et c'est voulu.

    Il ne vérifie pas un chiffre — il vérifie qu'aucun facteur mille ne s'est
    glissé quelque part. 57 440 m3 de gazole à 2 680 kgCO2e/m3 font environ
    154 kt pour la seule combustion ; un facteur divisé donnerait 154 kg, un
    facteur doublement multiplié 154 Mt. Les trois se distinguent d'un coup
    d'œil, et c'est tout ce qu'on demande à ce cas.
    """
    volume_m3 = 57_440.0
    factor, _ = load_2025.si_factor("diesel-combustion")
    tonnes = volume_m3 * factor / 1000
    assert 100_000 < tonnes < 200_000, f"{tonnes:,.0f} tCO2e — un facteur mille s'est glissé"
