/**
 * Ce que la mine atteste d'une barre du registre.
 *
 * La page d'accueil signe la coulée que sert `/api/v1/pour`, laquelle arrive
 * déjà étiquetée par son origine. Le registre part d'ailleurs — de
 * `erp-fixture.json`, où les champs sont nus. Il faut donc dire d'où vient
 * chaque valeur, et le dire juste, puisque c'est signé.
 *
 * L'ORIGINE N'EST PAS ÉCRITE ICI, ELLE EST LUE. `simulatedFields` est déclaré
 * par le générateur du jeu d'essai. Le jour où AGM livrera son registre de
 * coulées — G-01 est encore « Partial » —, `make_fixture.py` retirera de cette
 * liste les champs devenus réels, et les attestations suivront sans que
 * personne ait à y penser. La même liste recopiée ici mentirait dès la première
 * livraison, et elle mentirait dans un document signé.
 *
 * RIEN D'UNE BARRE N'EST « MEASURED » EN H1. Ce qui est mesuré, c'est l'or du
 * mois — feuille 6 du paquet AGM — dont `fineGoldKg` est le quotient par le
 * nombre de barres. Deux origines suffisent donc : ESTIMATED pour ce que le
 * modèle invente, DERIVED pour ce qu'il calcule à partir du réel.
 *
 * LES VALEURS SONT BRUTES, JAMAIS MISES EN FORME. `mass.js` choisit un préfixe
 * et trois chiffres significatifs pour l'œil ; signer « 12,7 kg » figerait une
 * perte de précision et une langue dans un document qu'un vérificateur devra
 * relire dans dix ans. La revendication porte donc le nombre et son unité
 * séparément, l'unité venant du jeu de données et non de ce module.
 *
 * Fonction pure, sans DOM : l'auto-test l'exerce sans charger la page barre.
 */

/** Le jour LOCAL de la mine. Voir `bar.js` : un lingot ne change pas de date. */
const localDay = (iso) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Guyana" });

/**
 * Les revendications de l'opérateur pour une barre.
 *
 * Le vocabulaire est celui de la coulée — `barId`, `pourDate`, `weight`,
 * `assay` — parce que les deux chemins produisent la MÊME sorte d'attestation :
 * un `DoreBarOriginCredential`. Deux vocabulaires donneraient deux documents
 * qu'un vérificateur devrait apprendre séparément. `fineGold` s'y ajoute, qui
 * n'existe pas dans la coulée d'exemple et qui est pourtant la masse sur
 * laquelle l'intensité carbone se divise.
 *
 * Le lot n'y est pas : c'est une maille de calcul, pas un fait que l'opérateur
 * observe sur le lingot. Le registre l'affiche, l'attestation carbone le
 * portera avec ses périodes (#61).
 *
 * @param {object} bar     une entrée de `bars` du jeu d'essai
 * @param {object} fixture le jeu d'essai entier — pour ses unités et ses aveux
 * @returns {object} revendications `{clé: {value, unit?, origin}}`
 */
export function barClaims(bar, fixture) {
  const simulated = new Set(fixture?.simulatedFields ?? []);
  const kg = fixture?.units?.mass ?? "kg";

  // Une valeur simulée n'est pas dérivée d'une mesure : elle sort du modèle.
  const originOf = (field) => (simulated.has(field) ? "ESTIMATED" : "DERIVED");

  return {
    barId: { value: bar.internalId, origin: originOf("internalId") },
    pourDate: { value: localDay(bar.pouredAt), origin: originOf("pouredAt") },
    fineGold: { value: bar.fineGoldKg, unit: kg, origin: originOf("fineGoldKg") },
    weight: { value: bar.grossMassKg, unit: kg, origin: originOf("grossMassKg") },
    // Un titre est un rapport de masses : il n'a pas d'unité, et lui en donner
    // une (« % ») obligerait à choisir entre 0,92 et 92 dans un champ signé.
    assay: { value: bar.assay, origin: originOf("assay") },
  };
}
