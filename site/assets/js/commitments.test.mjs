// site/assets/js/commitments.test.mjs — l'engagement sur le total, #104.
//
// Ces cas ont été écrits AVANT l'implémentation et ont d'abord échoué, six sur
// sept : c'est ce qui établit qu'ils discriminent l'ancien comportement du
// nouveau, et non qu'ils décrivent après coup ce que le code fait déjà.
//
// LE BUG, RAPPELÉ EN UNE PHRASE (#104). Le signataire engage un total obtenu
// par une sommation agrégée par ligne de taxonomie ; le vérificateur recalcule
// par somme directe cellule à cellule. Les deux sont mathématiquement égales
// et numériquement différentes — l'addition flottante n'est pas associative —
// et un engagement, condensat SHA-256, n'admet aucun voisinage : un ULP suffit
// à le faire échouer. Mesuré sur le cas réel : désaccord dans 76 % des cas,
// dérive de l'ordre de 1e-10 kgCO2e.
//
// LA DÉCISION DU MAINTENEUR (9 septembre 2026, commentaire sur #104) sépare le
// correctif en deux étapes indépendantes : ici, ÉTAPE 1 SEULE — assouplir le
// contrôle du total, sans toucher à la façon dont chaque côté somme. L'étape 2
// (harmoniser le calcul par une fonction partagée) est un lot séparé, dont ces
// tests ne dépendent pas : ils resteront verts après elle, et n'auront alors
// plus rien à rattraper — ce qui est le but.
//
// LE MÉCANISME QUANTIFIE, IL NE TOLÈRE PAS UN ÉCART CONTINU. Un engagement
// est un condensat : on ne peut pas comparer « à combien la valeur signée
// diffère-t-elle du recalcul », puisque la valeur signée n'est jamais lue en
// clair — seul son condensat l'est. La seule manœuvre possible est de proposer
// des CANDIDATS et de voir si l'un d'eux hache pareil. `commitTotal` arrondit
// donc son total au quantum le plus proche avant de le hacher — des deux
// côtés, à l'émission comme à la vérification, par LA MÊME fonction — et
// `checkTotalCommitment` essaie le recalcul et ses deux voisins immédiats sur
// la grille : {n−1, n, n+1}, jamais un intervalle ouvert.
//
// POURQUOI TROIS CANDIDATS ET PAS UN SEUL. Arrondir seulement le recalcul ne
// suffit pas : si la vraie somme (au sens mathématique, infiniment précise)
// tombe presque exactement sur une frontière de grille, un bruit flottant de
// 1e-10 peut faire arrondir un côté vers le bas et l'autre vers le haut — la
// grille elle-même se traverse. Le test « frontière » ci-dessous construit ce
// cas précisément : sans le filet à trois candidats, un total pourtant juste
// échouerait.
//
// POURQUOI UN GRAMME. Validé par le mainteneur : « 1g sur 612t c'est déjà
// bien ». Le choix de ce quantum pour ce type d'attestation — et sa
// pertinence pour un bilan proche de zéro — est débattu séparément (issue
// ouverte sur la limite basse de précision), pas ici.

import { test } from "node:test";
import assert from "node:assert/strict";
import { commitTotal, checkTotalCommitment } from "./commitments.js";

// Une matrice de cellules synthétique : ces tests portent sur le TOTAL, pas
// sur la matrice elle-même — verifyMatrix() et recomputeTotal() ont leurs
// propres tests, à écrire dans le même mouvement que l'étape 2.
const CELLS = [{ commitment: "abc" }, { commitment: "def" }];
const SALT = "0102030405060708090a0b0c0d0e0f10";

// --- commitTotal : le total doit se quantifier avant de se hacher ---------

test("commitTotal — deux sommes mathématiquement égales commitent pareil (0,1+0,2 ≡ 0,3)", async () => {
  // Le cas d'école de la non-associativité flottante, choisi précisément
  // parce qu'il ne demande aucun tirage aléatoire pour être reproduit : en
  // IEEE 754 double précision, 0.1 + 0.2 === 0.30000000000000004, et
  // 0.30000000000000004 !== 0.3. C'est la MÊME classe de désaccord que celle
  // mesurée sur l'attestation réelle — deux chemins de calcul équivalents,
  // un bit différent — à une échelle qu'il n'y a pas besoin de simuler.
  assert.notEqual(0.1 + 0.2, 0.3, "le cas d'école a cessé d'être un cas d'école");

  const a = await commitTotal(CELLS, 0.1 + 0.2, "kgCO2e", SALT);
  const b = await commitTotal(CELLS, 0.3, "kgCO2e", SALT);
  assert.equal(a.commitment, b.commitment,
    "sans quantification, ces deux totaux — pourtant égaux — commitent différemment");
});

test("commitTotal — un écart d'un demi-kilogramme reste discriminé (le quantum ne devient pas une porte ouverte)", async () => {
  // Un total à 500 g de plage d'accord serait un vérificateur qui ne
  // vérifie plus rien. Le quantum vaut 1 g (validé par le mainteneur) ;
  // 0,5 kg lui est très supérieur.
  const a = await commitTotal(CELLS, 100, "kgCO2e", SALT);
  const b = await commitTotal(CELLS, 100.5, "kgCO2e", SALT);
  assert.notEqual(a.commitment, b.commitment,
    "la quantification a supprimé le pouvoir de détecter un désaccord réel");
});

test("commitTotal — le quantum par défaut vaut un gramme pour kgCO2e", async () => {
  // Documente le choix, plutôt que de le laisser implicite dans le code : à
  // 0,0005 kg de distance (un demi-quantum), deux totaux tombent encore sur
  // la MÊME case de grille et doivent commiter pareil.
  const a = await commitTotal(CELLS, 100, "kgCO2e", SALT);
  const b = await commitTotal(CELLS, 100 + 0.0004, "kgCO2e", SALT);
  assert.equal(a.commitment, b.commitment,
    "0,4 g d'écart devrait rester dans la même case de grille au gramme");
});

// --- checkTotalCommitment : le filet à trois candidats ---------------------

test("checkTotalCommitment — le désaccord réel de #104 (dérive de sommation, ≪ 1 g) se vérifie", async () => {
  // Le total « signé » — obtenu ici par une sommation, comme l'agrégation par
  // ligne du signataire produirait la sienne.
  const { commitment } = await commitTotal(CELLS, 0.3, "kgCO2e", SALT);
  // Le total « recalculé » — une sommation DIFFÉRENTE, mathématiquement égale.
  const ok = await checkTotalCommitment(CELLS, 0.1 + 0.2, "kgCO2e", SALT, commitment);
  assert.equal(ok, true,
    "deux sommations équivalentes du même total doivent se vérifier l'une contre l'autre");
});

test("checkTotalCommitment — un total franchement différent est toujours rejeté", async () => {
  const { commitment } = await commitTotal(CELLS, 100, "kgCO2e", SALT);
  const ok = await checkTotalCommitment(CELLS, 250, "kgCO2e", SALT, commitment);
  assert.equal(ok, false,
    "150 kg d'écart ne doit jamais passer — le filet protège contre le bruit, pas contre une vraie divergence");
});

test("checkTotalCommitment — LA FRONTIÈRE : sans les trois candidats, un total pourtant juste échouerait", async () => {
  const Q = 1; // quantum explicite, pour construire une frontière exacte à zéro ambiguïté

  // Le total « signé » s'arrondit à 0 sur cette grille.
  const { commitment } = await commitTotal(CELLS, 0.4999999999, "unit", SALT, Q);

  // Le recalcul est à 2e-10 de distance — la même échelle que la dérive
  // mesurée sur l'attestation réelle — mais tombe de l'AUTRE côté de la
  // frontière 0,5, et s'arrondit donc à 1, pas à 0.
  const recomputed = 0.5000000001;
  const direct = await commitTotal(CELLS, recomputed, "unit", SALT, Q);
  assert.notEqual(direct.commitment, commitment,
    "la frontière doit être réelle : sans le filet, ce cas échouerait — c'est ce que ce test démontre");

  // Le filet à trois candidats {n−1, n, n+1} contient la case 0, même si le
  // recalcul brut, seul, arrondit à 1.
  const ok = await checkTotalCommitment(CELLS, recomputed, "unit", SALT, commitment, Q);
  assert.equal(ok, true,
    "le candidat n−1 doit rattraper un total qui a basculé de l'autre côté de la frontière");
});

test("checkTotalCommitment — la frontière ne devient pas non plus une porte ouverte", async () => {
  const Q = 1;
  const { commitment } = await commitTotal(CELLS, 0.4999999999, "unit", SALT, Q); // grille sur 0

  // Deux quanta plus loin : hors de portée de {n−1, n, n+1}, quelle que soit
  // la frontière la plus proche.
  const ok = await checkTotalCommitment(CELLS, 2.5, "unit", SALT, commitment, Q);
  assert.equal(ok, false,
    "un total à deux quanta de distance ne doit pas se vérifier — le filet est {n−1,n,n+1}, pas {n−k…n+k}");
});

// --- Cas limites (tâche 5) -------------------------------------------------
//
// Les six cas ci-dessus tiennent le mécanisme. Ceux-ci tiennent ses bords :
// l'échelle réelle, le zéro, le signe négatif, et un quantum non par défaut.

test("cas limite — à l'échelle réelle de #104, une dérive d'un ULP se vérifie", async () => {
  // Le total mesuré sur l'attestation qui a révélé le bug, et un voisin à un
  // ULP de distance. À cette magnitude l'ULP d'un double vaut 1,16 × 10⁻¹⁰ :
  // les cas d'école à 0,3 ne prouvent rien de ce qui se passe à 6 × 10⁵.
  const signed = 612284.41127249971032;
  const drifted = signed + 1.16e-10;
  assert.notEqual(signed, drifted, "le voisin choisi doit être un autre double");

  const { commitment } = await commitTotal(CELLS, signed, "kgCO2e", SALT);
  assert.equal(await checkTotalCommitment(CELLS, drifted, "kgCO2e", SALT, commitment), true);
});

test("cas limite — la case zéro est la même par en dessous et par au-dessus", async () => {
  // `Math.round` rend -0 pour tout total dans la moitié négative de la case
  // zéro. Un engagement qui dépendrait de la distinction entre -0 et +0
  // dépendrait de la façon dont un langage sérialise le zéro signé — la
  // faute #82, exactement. Ce cas l'interdit.
  const below = await commitTotal(CELLS, -0.0004, "kgCO2e", SALT);
  const above = await commitTotal(CELLS, 0.0004, "kgCO2e", SALT);
  const exact = await commitTotal(CELLS, 0, "kgCO2e", SALT);
  assert.equal(below.commitment, exact.commitment, "-0,4 g doit tomber dans la case zéro");
  assert.equal(above.commitment, exact.commitment, "+0,4 g doit tomber dans la case zéro");
});

test("cas limite — un total négatif se vérifie comme un autre", async () => {
  // Un bilan net peut être négatif par compensation. Ce n'est pas le cas d'un
  // doré aujourd'hui, mais rien dans l'engagement ne doit le refuser — la
  // question de la PRÉCISION près de zéro, elle, est ouverte en #108.
  const { commitment } = await commitTotal(CELLS, -1234.567, "kgCO2e", SALT);
  assert.equal(await checkTotalCommitment(CELLS, -1234.567 - 2e-10, "kgCO2e", SALT, commitment), true);
  assert.equal(await checkTotalCommitment(CELLS, -1234.5, "kgCO2e", SALT, commitment), false,
    "67 g d'écart doit rester un désaccord, même du côté négatif");
});

test("cas limite — un quantum explicite l'emporte sur le défaut", async () => {
  // Au kilogramme, deux totaux distants de 400 g tombent dans la même case ;
  // au gramme — le défaut — ils n'y tombent pas. Le paramètre doit donc
  // réellement gouverner, et pas être ignoré silencieusement.
  const { commitment } = await commitTotal(CELLS, 100, "kgCO2e", SALT, 1);
  assert.equal(await checkTotalCommitment(CELLS, 100.4, "kgCO2e", SALT, commitment, 1), true);
  assert.equal(await checkTotalCommitment(CELLS, 100.4, "kgCO2e", SALT, commitment), false,
    "au quantum par défaut, 400 g d'écart ne doivent pas passer");
});
