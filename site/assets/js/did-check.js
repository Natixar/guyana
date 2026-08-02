/**
 * Comparer une empreinte de document DID, sur n'importe quel poste.
 *
 * LE PROBLÈME QUE CETTE PAGE RÉSOUT. Avant de publier un `did.json` neuf,
 * l'exploitant doit s'assurer que le document en ligne est toujours celui sur
 * lequel il a bâti le sien — sinon il efface les clés qu'un collègue a ajoutées
 * entre-temps, silencieusement. Le document neuf porte pour cela un champ
 * `previousVersionDigest`. Restait à savoir calculer l'empreinte de celui qui
 * est en ligne, et la page ne le disait nulle part.
 *
 * POURQUOI `Get-FileHash` DONNE UNE AUTRE RÉPONSE, ET POURQUOI CE N'EST PAS UN
 * DÉTAIL. L'empreinte porte sur la forme CANONIQUE du document (JCS, RFC 8785),
 * pas sur les octets du fichier. C'est délibéré : un éditeur qui reformate le
 * JSON — indentation, ordre des clés, fin de ligne Windows — changerait
 * l'empreinte du fichier sans rien changer au contenu, et l'avertissement
 * crierait au loup à chaque fois. La contrepartie est qu'aucun outil de hachage
 * généraliste ne peut la calculer : ni `Get-FileHash` ni `certutil` sous
 * Windows, ni `sha256sum` sous Linux. Ils hachent des octets ; nous hachons un
 * document. D'où ce contrôle, qui tourne dans le navigateur et ne suppose donc
 * aucun système.
 *
 * RIEN NE SORT D'ICI. La politique de sécurité du site interdit toute connexion
 * hors de son propre domaine (`connect-src 'self'`), donc la page ne peut pas
 * aller lire `guygold.com` elle-même — et c'est aussi bien : le fichier reste
 * chez celui qui le contrôle. On le dépose ou on le colle.
 */
import T from "./labels.js";
import { documentDigest } from "./did.js";
import { showLoaded } from "./loaded-text.js";

const $ = (s) => document.querySelector(s);

/** Ce qui a été lu de chaque côté. Un seul écrivain du verdict, comme ailleurs. */
const state = { online: null, next: null, onlineError: "", nextError: "" };

function parse(text) {
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== "object") throw new Error(T.didCheckNotJson);
  return doc;
}

async function readOnline(text) {
  // Une zone vidée revient à « rien lu », pas à « illisible » : afficher une
  // erreur parce que l'exploitant a effacé son collage serait le gronder.
  if (!text) { state.online = null; state.onlineError = ""; render(); return; }
  try {
    const doc = parse(text);
    if (!Array.isArray(doc.verificationMethod)) throw new Error(T.didMergeNoKeys);
    state.online = { doc, digest: await documentDigest(doc), keys: doc.verificationMethod.length };
    state.onlineError = "";
  } catch (err) {
    state.online = null;
    state.onlineError = err.message ?? String(err);
  }
  render();
}

async function readNext(text) {
  if (!text) { state.next = null; state.nextError = ""; render(); return; }
  try {
    const doc = parse(text);
    state.next = { doc, previous: doc.previousVersionDigest ?? null };
    state.nextError = "";
  } catch (err) {
    state.next = null;
    state.nextError = err.message ?? String(err);
  }
  render();
}

/**
 * Le verdict, et les quatre états qu'il doit distinguer.
 *
 * Le troisième est celui qui compte : un document neuf SANS
 * `previousVersionDigest` n'est pas « en attente », c'est un document qui
 * remplacera tout ce qui est en ligne. Le confondre avec « je n'ai pas encore
 * regardé » serait taire exactement ce qu'il faut dire.
 */
function verdict() {
  if (!state.online || !state.next) return { text: T.didCheckWaiting, kind: "pending" };
  if (!state.next.previous) return { text: T.didCheckNoPrevious, kind: "warning" };
  return state.next.previous === state.online.digest
    ? { text: T.didCheckMatch, kind: "verified" }
    : { text: T.didCheckMismatch, kind: "warning" };
}

function render() {
  const onlineOut = $("[data-check-online-digest]");
  const onlineKeys = $("[data-check-online-keys]");
  const nextOut = $("[data-check-next-previous]");
  const badge = $("[data-check-verdict]");

  onlineOut.textContent = state.online?.digest ?? (state.onlineError || "—");
  onlineKeys.textContent = state.online ? String(state.online.keys) : "—";
  nextOut.textContent = state.next
    ? (state.next.previous ?? T.didCheckNoneDeclared)
    : (state.nextError || "—");

  const v = verdict();
  badge.textContent = v.text;
  badge.className = `badge badge--${v.kind}`;
}

/**
 * Branche un couple fichier + zone de texte sur le même lecteur.
 *
 * Le fichier choisi s'écrit dans la zone et déplie le tiroir qui la contient.
 * C'est une page où l'on COMPARE deux documents : afficher un verdict sans
 * montrer ce sur quoi il porte n'y a aucun sens.
 *
 * @see site/assets/js/loaded-text.js
 */
function wire(fileSel, textSel, read) {
  const box = $(textSel);
  $(fileSel)?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await read(showLoaded(box, await file.text()).trim());
  });
  box?.addEventListener("input", () => read(box.value.trim()));
}

document.addEventListener("DOMContentLoaded", () => {
  if (!$("[data-did-check]")) return;
  wire("[data-check-online-file]", "[data-check-online-text]", readOnline);
  wire("[data-check-next-file]", "[data-check-next-text]", readNext);
  render();
});
