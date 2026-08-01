/**
 * Ajouter une clé à un document DID existant, sans effacer les précédentes.
 *
 * LE DÉFAUT QUE CE MODULE CORRIGE. Créer une paire de clés produisait jusqu'ici
 * un document DID bâti de zéro, ne portant que la clé du jour. Le publier
 * remplace le document en ligne — et **toutes les attestations déjà émises
 * deviennent invérifiables**, définitivement, puisque la clé qui les a signées
 * a disparu du seul endroit où un vérificateur va la chercher. La perte n'est
 * pas rattrapable après coup : republier l'ancienne clé suppose de l'avoir
 * gardée, or elle vit dans un navigateur.
 *
 * `buildDidDocument` savait déjà fusionner ; rien ne lui passait le document
 * précédent. C'est ici que l'exploitant le fournit.
 *
 * L'ATOMICITÉ, ET CE QU'ON NE PEUT PAS FAIRE ICI. La séquence lire / modifier /
 * publier n'est pas atomique : deux personnes qui ajoutent chacune une clé en
 * partant du même document publient deux documents, et le second efface la clé
 * du premier — silencieusement, ce qui est le pire des cas. Le vrai remède est
 * un `If-Match` sur l'hébergement, que nous ne contrôlons pas : le fichier est
 * déposé chez le client. Reste à rendre l'écrasement DÉTECTABLE, et c'est le
 * rôle de l'empreinte.
 *
 * POURQUOI L'EMPREINTE PORTE SUR LE DOCUMENT ET NON SUR LA CLÉ. Les deux
 * empreintes existent dans cette application et répondent à deux questions
 * différentes : celle de la CLÉ dit *laquelle* se trouve sur cette machine —
 * l'opérateur la lit à voix haute — ; celle du DOCUMENT dit *sur quel état* le
 * nouveau document a été construit. Seule la seconde détecte l'écrasement :
 * une empreinte de clé ne peut pas exprimer « il y en avait deux, il n'en reste
 * qu'une », alors qu'une empreinte de document change dès qu'un élément bouge.
 * C'est un ETag, et l'opération voulue est un If-Match.
 */
import T from "./labels.js";
import { documentDigest } from "./did.js";

const $ = (root, sel) => root.querySelector(sel);

/** Ce qu'on accepte comme document DID précédent. */
function validate(doc, did) {
  if (!doc || typeof doc !== "object") throw new Error(T.didMergeNotJson);
  // Un document portant un autre identifiant fusionnerait des clés qui n'ont
  // rien à faire ensemble — et publierait, sous le nom de la mine, une clé
  // appartenant à quelqu'un d'autre.
  if (did && doc.id && doc.id !== did) throw new Error(`${T.didMergeWrongDid} — ${doc.id}`);
  if (!Array.isArray(doc.verificationMethod)) throw new Error(T.didMergeNoKeys);
  return doc;
}

/**
 * Branche le bloc « document existant » et rend son état lisible.
 *
 * @param {ParentNode} root
 * @param {() => string|null} currentDid le DID en cours de construction
 * @returns {{previous: () => object|null}}
 */
export function wireDidMerge(root, currentDid) {
  const box = $(root, "[data-did-merge]");
  if (!box) return { previous: () => null };

  const status = $(box, "[data-did-previous-status]");
  const facts = $(box, "[data-did-previous-facts]");
  const digestOut = $(box, "[data-did-previous-digest]");
  const keptOut = $(box, "[data-did-keys-kept]");

  let previous = null;

  async function accept(text) {
    try {
      previous = validate(JSON.parse(text), currentDid());
      const digest = await documentDigest(previous);
      digestOut.textContent = digest;
      keptOut.textContent = String(previous.verificationMethod.length);
      facts.hidden = false;
      status.className = "badge badge--verified";
      status.textContent = T.didMergeLoaded;
    } catch (err) {
      // Repli explicite sur « aucun document » : garder un document à moitié lu
      // laisserait croire à une fusion qui n'aura pas lieu.
      previous = null;
      facts.hidden = true;
      status.className = "badge badge--warning";
      status.textContent = `${T.didMergeRejected} — ${err.message}`;
    }
  }

  $(box, "[data-did-previous-file]")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await accept(await file.text());
  });

  const text = $(box, "[data-did-previous-text]");
  text?.addEventListener("input", async () => {
    const v = text.value.trim();
    if (!v) {
      previous = null;
      facts.hidden = true;
      status.className = "badge badge--warning";
      status.textContent = T.didMergeNone;
      return;
    }
    await accept(v);
  });

  return { previous: () => previous };
}
