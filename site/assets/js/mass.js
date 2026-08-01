/**
 * Affichage des masses — le calcul est en SI, la lecture ne l'est pas.
 *
 * Le moteur produit des kgCO2e et ne convertit rien : c'est ce qui a supprimé
 * les erreurs de facteur mille. Mais `32808.56 kgCO2e` est exact et illisible,
 * et un chiffre qu'on ne lit pas est un chiffre qu'on ne vérifie pas. La
 * conversion appartient donc au RENDU, ici, et nulle part ailleurs.
 *
 * DEUX RÈGLES, ET LA SECONDE EST LA MOINS ÉVIDENTE.
 *
 * 1. Le préfixe est choisi pour que la partie entière tienne entre 0 et 999.
 *    Les exposants vont de trois en trois — mg, g, kg, t, kt, Mt — jamais de
 *    notation scientifique intermédiaire : `1,22 Mt` et non `1,22e+9 kg`.
 *
 * 2. Jamais plus de TROIS chiffres significatifs. La précision des données ne
 *    les porte pas : les facteurs d'émission sont donnés à trois chiffres, et
 *    cinq d'entre les six sont marqués provisoires par AGM. Écrire
 *    `784,2 kgCO2e` afficherait une précision que personne ne possède.
 *
 * Pour une COLONNE, le même préfixe partout — sinon l'œil compare des nombres
 * qui ne sont pas comparables. Le préfixe se choisit sur la MÉDIANE, pas sur le
 * maximum : une seule valeur aberrante ne doit pas écraser tout le reste à
 * zéro. Quand les ordres de grandeur s'écartent trop pour qu'un préfixe unique
 * garde du sens, la colonne bascule en notation scientifique — c'est le seul
 * endroit où elle est justifiée.
 */

/** Puissances de mille, du milligramme à la mégatonne. Base : le kilogramme. */
const SCALE = [
  { symbol: "mg", exponent: -6 },
  { symbol: "g", exponent: -3 },
  { symbol: "kg", exponent: 0 },
  { symbol: "t", exponent: 3 },
  { symbol: "kt", exponent: 6 },
  { symbol: "Mt", exponent: 9 },
];

const SIGNIFICANT = 3;

/**
 * Le nombre de décimales qui laisse trois chiffres significatifs.
 *
 * Calculé APRÈS mise à l'échelle et sur la valeur absolue arrondie : 999,6
 * s'arrondit à 1000, qui a quatre chiffres — le cas se traite en remontant d'un
 * préfixe, pas en tronquant.
 */
function decimalsFor(scaled) {
  const magnitude = Math.abs(scaled);
  if (magnitude >= 100) return 0;
  if (magnitude >= 10) return 1;
  return 2;
}

/** L'échelon dont la partie entière tient entre 1 et 999, ou le plus proche. */
function pick(kg) {
  const magnitude = Math.abs(kg);
  if (!Number.isFinite(magnitude) || magnitude === 0) return SCALE[2];   // kg

  for (const step of SCALE) {
    const scaled = magnitude / 10 ** step.exponent;
    // On teste la valeur ARRONDIE : 999,7 g doit passer en kg plutôt que
    // s'afficher « 1000 g », qui a quatre chiffres significatifs.
    if (Number(scaled.toPrecision(SIGNIFICANT)) < 1000) return step;
  }
  return SCALE[SCALE.length - 1];
}

/**
 * Une masse isolée, en kg, rendue lisible.
 *
 * @param {number} kg
 * @param {{suffix?: string, locale?: string}} [options] `suffix` complète le
 *        symbole — « CO2e » donne « 32,8 tCO2e ».
 * @returns {string}
 */
export function formatMass(kg, { suffix = "", locale = "fr-FR" } = {}) {
  if (!Number.isFinite(kg)) return "—";
  const step = pick(kg);
  const scaled = kg / 10 ** step.exponent;
  const text = scaled.toLocaleString(locale, {
    minimumFractionDigits: decimalsFor(scaled),
    maximumFractionDigits: decimalsFor(scaled),
  });
  return `${text} ${step.symbol}${suffix}`;
}

/**
 * Décimales nécessaires pour que CETTE valeur porte trois chiffres significatifs.
 *
 * Dans une colonne, l'unité est au titre et non sur chaque ligne : la place
 * ainsi gagnée se dépense en zéros. `0,0273` vaut mieux que `0,03`, qui n'a
 * qu'un chiffre significatif et fait croire à une mesure grossière là où la
 * donnée en porte trois.
 */
function decimalsForPrecision(value) {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude) || magnitude === 0) return 0;
  const exponent = Math.floor(Math.log10(magnitude));
  return Math.max(0, SIGNIFICANT - 1 - exponent);
}

/** Au-delà, la colonne devient illisible et la notation scientifique sert. */
const MAX_DECIMALS = 6;

/**
 * Le préfixe commun d'une colonne, choisi sur la médiane.
 *
 * L'UNITÉ EST AU TITRE, JAMAIS SUR LA LIGNE. C'est ce qui rend la colonne
 * comparable d'un coup d'œil, et c'est aussi ce qui libère la place : chaque
 * valeur peut alors porter ses trois chiffres significatifs, quitte à aligner
 * des zéros. Une colonne en ktCO2e affiche `5,93` et `0,0273`, pas `5,93` et
 * `0,03`.
 *
 * La notation scientifique n'intervient que si la plus petite valeur non nulle
 * demanderait plus de six décimales pour garder ses trois chiffres : au-delà,
 * la colonne cesse d'être lisible et le seul choix honnête est de changer de
 * registre.
 */
export function massColumn(values, { suffix = "", locale = "fr-FR" } = {}) {
  const finite = values.filter((v) => Number.isFinite(v));
  const nonZero = finite.map(Math.abs).filter((v) => v > 0).sort((a, b) => a - b);

  if (nonZero.length === 0) {
    return { unit: `kg${suffix}`, scientific: false, format: () => "—" };
  }

  const median = nonZero[Math.floor(nonZero.length / 2)];
  const step = pick(median);
  const scale = 10 ** step.exponent;

  if (decimalsForPrecision(nonZero[0] / scale) > MAX_DECIMALS) {
    return {
      unit: `kg${suffix}`,
      scientific: true,
      format: (v) => (Number.isFinite(v) ? v.toExponential(2) : "—"),
    };
  }

  return {
    unit: `${step.symbol}${suffix}`,
    scientific: false,
    format: (v) => {
      if (!Number.isFinite(v)) return "—";
      const scaled = v / scale;
      // Un zéro exact est un zéro, pas « 0,000 » : il n'a pas de chiffre
      // significatif à montrer.
      if (scaled === 0) return "0";
      const decimals = decimalsForPrecision(scaled);
      return scaled.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    },
  };
}
