/**
 * D'où vient le document DID, et le dire.
 *
 * LE PROBLÈME RÉEL. `did:web` place la clé publique de l'émetteur sur son
 * propre domaine : c'est là toute la force du montage, puisqu'un vérificateur
 * n'a alors besoin de croire ni Natixar ni personne. Mais AGM n'a pas publié
 * `https://guygold.com/.well-known/did.json` et ne le fera pas pour la
 * démonstration. Sans repli, la page exige qu'on lui dépose un fichier à la
 * main — ce qui fonctionne et se filme mal.
 *
 * LE REPLI, ET POURQUOI IL EST VISIBLE. Servir un exemplaire local en laissant
 * croire qu'il vient du domaine de la mine rendrait fausse la seule phrase que
 * cette page existe pour démontrer. Et c'est vérifiable en trois secondes :
 * n'importe qui ouvre les outils de développement et constate qu'aucune requête
 * n'est partie vers guygold.com. Devant un jury, une triche découverte ne coûte
 * pas la démonstration — elle coûte la crédibilité de tout le reste, et presque
 * tout le reste est vrai.
 *
 * Déclaré, le repli devient un argument : « AGM n'a pas encore publié sa clé,
 * voici donc d'où vient celle-ci, et voici ce que ça donnera le jour où elle
 * l'aura publiée. » C'est d'ailleurs une fonction légitime plutôt qu'un
 * pis-aller : un vérificateur hors ligne, ou en réseau fermé, reçoit le
 * document DID avec l'attestation au lieu de le résoudre.
 *
 * TROIS VOIES, DANS CET ORDRE, ET LE RÉSEAU TOUJOURS EN PREMIER. Le jour où AGM
 * publie, il n'y a rien à changer : le repli cesse de servir et la mention
 * disparaît d'elle-même.
 */
import { didWebUrl } from "./verify.js";
import { loadKeyPair } from "./keys.js";
import { buildDidDocument } from "./did.js";

/** Documents DID embarqués, s'il en existe. Servis sous `/engine/did/`. */
const BUNDLED = "/engine/did";

/**
 * @typedef {object} Resolved
 * @property {object} document le document DID
 * @property {"network"|"bundled"|"browser"} source d'où il vient
 * @property {string|null} url l'adresse où il DEVRAIT être publié
 */

async function fromNetwork(did, url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    if (!(r.headers.get("content-type") ?? "").includes("json")) return null;
    return { document: await r.json(), source: "network", url };
  } catch {
    // Domaine muet, CORS, hors ligne. Ce n'est pas une erreur du vérificateur :
    // c'est l'état du monde, et la page va le dire.
    return null;
  }
}

async function fromBundle(did, url) {
  try {
    const r = await fetch(`${BUNDLED}/${encodeURIComponent(did)}.json`,
                          { headers: { accept: "application/json" } });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    return { document: await r.json(), source: "bundled", url };
  } catch {
    return null;
  }
}

/**
 * Le document que CE navigateur peut reconstruire depuis sa propre clé.
 *
 * La clé de la mine naît dans le navigateur et n'en sort pas : un document
 * figé, livré avec le site, porterait une clé qui ne correspondrait à aucune
 * signature. Reconstruire depuis la clé détenue ici donne le seul document
 * local qui puisse vérifier quoi que ce soit — et dit exactement ce qu'il est :
 * le vérificateur et le signataire sont la même machine.
 */
async function fromBrowser(did, url) {
  const pair = await loadKeyPair();
  if (!pair) return null;
  return { document: await buildDidDocument(pair, did), source: "browser", url };
}

/**
 * Résout un `did:web` : réseau, puis exemplaire embarqué, puis clé locale.
 *
 * @param {string} did
 * @param {{allowLocal?: boolean}} [options] `allowLocal` à false interdit les
 *        deux replis — ce que fera un vérificateur qui exige une résolution
 *        réelle.
 * @returns {Promise<Resolved>}
 * @throws {Error} `DID_UNRESOLVABLE`
 */
export async function resolveDid(did, { allowLocal = true } = {}) {
  const url = didWebUrl(did);

  const found = await fromNetwork(did, url)
    ?? (allowLocal ? (await fromBundle(did, url)) ?? (await fromBrowser(did, url)) : null);

  if (found) return found;

  const err = new Error(`no DID document for ${did}`);
  err.code = "DID_UNRESOLVABLE";
  throw err;
}
