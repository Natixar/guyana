/**
 * Traduire les entiers de la taxonomie pivot en mots.
 *
 * « Sub-post 1002 » ne veut rien dire pour un affineur, un acheteur ou un
 * auditeur. C'est un identifiant de référentiel, et le référentiel EXISTE :
 * 1002 est « Internal freight », sous le poste Fret. L'afficher nu revenait à
 * exiger du lecteur qu'il possède la table — c'est-à-dire à faire d'un document
 * autoportant un document qu'il faut nous demander d'interpréter.
 *
 * ─── POURQUOI LA TABLE VIENT DU RÉSEAU, ET CE QUI SE PASSE SANS ELLE ─────
 *
 * Les libellés appartiennent à une VERSION de taxonomie, et l'attestation nomme
 * la sienne dans `method.taxonomy`. Figer une table dans le code la rendrait
 * fausse le jour où la taxonomie évolue, sans que rien ne le signale : un
 * sous-poste renuméroté afficherait tranquillement le mauvais mot dans un
 * document signé. La table est donc servie, versionnée, et confrontée à ce que
 * l'attestation déclare.
 *
 * SI ELLE MANQUE, ON REVIENT AU NOMBRE. Un vérificateur hors ligne, ou qui
 * refuse de nous joindre, garde une page qui fonctionne : les chiffres, les
 * engagements et le recalcul ne dépendent en rien de cette table. Elle
 * n'apporte que des mots, et une page qui tomberait faute de mots aurait
 * confondu la présentation avec la preuve.
 *
 * SI LA VERSION DIFFÈRE, ON REVIENT AUSSI AU NOMBRE, et on le dit. Un libellé
 * emprunté à une autre version serait pire que pas de libellé du tout : il se
 * lirait comme une information alors qu'il serait une supposition.
 */

/** Ce qu'on sait traduire. Vide tant que rien n'est chargé. */
const empty = { version: null, subPosts: new Map(), postes: new Map(),
                caracterisations: new Map(), partTypes: new Map(), modes: new Map() };

const byId = (list, pick) =>
  new Map((list ?? []).map((x) => [x.id, pick(x)]));

/** Construit les tables depuis un document de taxonomie. Fonction pure. */
export function labelsFrom(taxonomy) {
  if (!taxonomy) return empty;
  const postes = byId(taxonomy.postes, (p) => p.key);
  return {
    version: taxonomy.version ?? null,
    postes,
    subPosts: byId(taxonomy.subPosts, (s) => ({
      label: s.label ?? s.key, poste: postes.get(s.poste) ?? null })),
    caracterisations: byId(taxonomy.caracterisations, (c) => c.key),
    partTypes: byId([...(taxonomy.partTypes?.retained ?? []),
                     ...(taxonomy.partTypes?.excluded ?? [])], (p) => p.key),
    modes: byId(taxonomy.modes?.values, (m) => m.key),
  };
}

/**
 * Charge la taxonomie servie, ou rend des tables vides.
 *
 * Ne lève jamais : l'absence de libellés n'est pas une panne de vérification.
 */
export async function fetchLabels(fetchImpl = fetch) {
  try {
    // `credentials: "omit"` : la table est publique, et si elle cessait de
    // l'être un 401 ferait ouvrir la fenêtre d'identification au lieu de nous
    // faire retomber sur les numéros. Le repli doit rester silencieux.
    const r = await fetchImpl("/engine/taxonomy.json",
                              { headers: { accept: "application/json" }, credentials: "omit" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return empty;
    return labelsFrom(await r.json());
  } catch {
    return empty;
  }
}

/**
 * Les tables valent-elles pour CETTE attestation ?
 *
 * `null` dans le document veut dire « il ne le dit pas » : on traduit alors,
 * faute de mieux, plutôt que de refuser des mots sur un doute. Une version
 * DIFFÉRENTE, en revanche, est une raison ferme de s'abstenir.
 */
export function applyTo(labels, declaredVersion) {
  if (!labels.version) return empty;
  if (declaredVersion && declaredVersion !== labels.version) return empty;
  return labels;
}

const named = (map, id, prefix) => {
  const found = map.get(id);
  if (found === undefined || found === null) return id === null || id === undefined ? "—" : `${prefix}${id}`;
  return found;
};

/** « Internal freight » plutôt que « 1002 ». Le poste suit, entre parenthèses. */
export function subPostLabel(labels, id) {
  const found = labels.subPosts.get(id);
  if (!found) return id === null || id === undefined ? "—" : `#${id}`;
  return found.poste ? `${found.label} (${found.poste})` : found.label;
}

export const caracterisationLabel = (labels, id) => named(labels.caracterisations, id, "#");
export const partTypeLabel = (labels, id) => named(labels.partTypes, id, "#");
export const modeLabel = (labels, id) => named(labels.modes, id, "#");
