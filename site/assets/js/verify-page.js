// Wiring for the verification page. Two inputs, one verdict.

import T from "./labels.js";
import { verifyCredential, didWebUrl } from "./verify.js";
import { resolveDid } from "./did-source.js";
import { esc } from "./escape.js";
import { verifyMatrix, recomputeTotal, commitTotal } from "./commitments.js";
import { showLoaded } from "./loaded-text.js";

const $ = (s) => document.querySelector(s);
const state = { credential: null, didDoc: null, didSource: null,
                disclosures: [], totalSalt: null,
                // Ce que le document a RÉELLEMENT fait, et non d'où il vient.
                // Les deux étaient confondus : voir `provenance`.
                didUsed: null };

/**
 * Ce que le porteur remet : une PRÉSENTATION, ou une attestation nue.
 *
 * Le signataire rend `{credential, disclosures, totalSalt}`, et c'est ce triplet
 * que le porteur transmet — après en avoir retiré les divulgations qu'il ne veut
 * pas remettre. Le distinguer d'une attestation nue par la présence de
 * `credential` évite un second dépôt de fichier : le vérificateur reçoit UN
 * objet et le dépose tel quel, ce qui est le seul geste qu'on puisse lui
 * demander de faire juste.
 */
function unwrap(json) {
  if (json && typeof json === "object" && json.credential) {
    state.disclosures = Array.isArray(json.disclosures) ? json.disclosures : [];
    state.totalSalt = json.totalSalt ?? null;
    return json.credential;
  }
  state.disclosures = [];
  state.totalSalt = null;
  return json;
}

/** Accolades équilibrées, en ignorant celles qui sont dans une chaîne. */
function looksComplete(raw) {
  if (!raw.startsWith("{") && !raw.startsWith("[")) return false;
  let depth = 0, inStr = false, escaped = false;
  for (const ch of raw) {
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return !inStr && depth === 0;
}

// L'échappement vit dans son propre module : trois versions partielles
// valaient moins qu'une complète. Celle-ci couvre aussi les attributs.

/** Accepts either a chosen file or pasted text — pasting is the easier path. */
function wireInput(name, onLoad) {
  const file = $(`[data-${name}-file]`);
  const text = $(`[data-${name}-text]`);
  const status = $(`[data-${name}-status]`);

  const accept = (raw, origin) => {
    try {
      onLoad(JSON.parse(raw));
      status.textContent = `${T.vLoaded} (${origin})`;
      status.className = "badge badge--verified";
    } catch (e) {
      state[name === "vc" ? "credential" : "didDoc"] = null;
      status.textContent = `${T.vNotJson} ${e.message}`;
      status.className = "badge badge--warning";
    }
    refresh();
  };

  // Le fichier déposé s'écrit dans la zone et déplie le tiroir. Le postulat de
  // cette page est que le vérificateur ne nous fait pas confiance : lui
  // demander de nous croire sur le contenu de son PROPRE fichier était le seul
  // endroit de la démonstration où l'on exigeait de la confiance.
  // Voir loaded-text.js.
  file?.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    accept(showLoaded(text, await f.text()), f.name);
  });
  // Un JSON incomplet n'est pas une erreur : c'est quelqu'un en train de taper.
  // On attend une pause, et l'on ne signale un défaut que si le texte semble
  // fini — accolades équilibrées hors chaînes. Sinon on reste « en attente ».
  let timer;
  text?.addEventListener("input", () => {
    clearTimeout(timer);
    const raw = text.value.trim();
    if (!raw) {
      status.textContent = T.vAwaiting;
      status.className = "badge badge--pending";
      return;
    }
    status.textContent = T.vTyping;
    status.className = "badge badge--pending";
    timer = setTimeout(() => {
      if (looksComplete(raw)) accept(raw, T.vPasted);
    }, 400);
  });
}

function renderClaims(doc) {
  const rows = [];
  const s = doc.credentialSubject ?? {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "id") continue;
    const value = v && typeof v === "object" ? v.value : v;
    const origin = v && typeof v === "object" ? v.origin : null;
    // L'unité voyage à côté de la valeur plutôt que collée dedans : signer
    // « 12,7 kg » figerait une mise en forme et une langue. C'est donc au rendu
    // de les réunir, et c'est ici. Une revendication sans unité n'en a pas.
    const unit = v && typeof v === "object" && v.unit ? ` ${v.unit}` : "";
    rows.push(`<div><dt>${esc(k)}</dt><dd>${esc(value ?? "—")}${esc(unit)}` +
      (origin && origin !== "MEASURED" ? ` <span class="origin-tag">${esc(origin.toLowerCase())}</span>` : "") +
      `</dd></div>`);
  }
  return rows.join("");
}

/**
 * D'où vient la clé qui sert à vérifier — annoncé, jamais tu.
 *
 * C'est la seule phrase que cette page existe pour démontrer : si la clé ne
 * vient pas du domaine de l'émetteur, le dire vaut mieux que de le laisser
 * découvrir dans les outils de développement.
 */
/**
 * La couleur de la pastille de provenance — décision pure, donc éprouvable.
 *
 * `null` veut dire « pas encore employé » : ni vert ni rouge, parce que le
 * document est là et n'a pas encore eu l'occasion de servir. C'est un état
 * réel, et le confondre avec l'échec ferait clignoter du rouge sur un dépôt
 * parfaitement valide en attendant l'attestation.
 */
export function provenanceKind(didUsed, didSource) {
  if (didUsed === true) return "verified";
  if (didUsed === false) return "warning";
  return didSource === "none" ? "warning" : "info";
}

/**
 * La clé qui a signé figure-t-elle dans le document ? Sinon, les deux listes.
 *
 * Rendu séparément du HTML pour être exercé sans DOM : c'est la décision qui
 * compte, et elle doit rester vraie quelle que soit la mise en forme.
 *
 * @returns {{signed: string, published: string[]}|null} `null` si tout va bien
 */
export function missingKey(credential, didDoc) {
  // PAS DE DOCUMENT N'EST PAS UN DOCUMENT SANS LA CLÉ. Tant que le vérificateur
  // n'a rien déposé, annoncer « ce document ne publie aucune clé » désignerait
  // une faute là où il n'y a qu'une étape pas encore franchie.
  if (!didDoc) return null;
  const signed = credential?.proof?.verificationMethod;
  const published = (didDoc.verificationMethod ?? []).map((m) => m.id);
  if (!signed || published.includes(signed)) return null;
  return { signed, published };
}

function provenance() {
  // LA COULEUR DIT CE QUE LE DOCUMENT A FAIT ; LE TEXTE DIT D'OÙ IL VIENT.
  //
  // Correction du 3 août 2026. Les deux étaient portés par la même pastille, et
  // « réseau » était le seul état vert. Or cette page interdit toute connexion
  // sortante — `connect-src 'self'` — et le domaine de l'émetteur devrait en
  // outre l'autoriser. La voie réseau ne peut donc pas aboutir, et le document
  // que le vérificateur apporte lui-même restait éternellement bleu : le DID NE
  // POUVAIT STRUCTURELLEMENT PAS VERDIR, quoi qu'on dépose.
  //
  // C'était doublement faux. Un document apporté par le vérificateur n'est pas
  // un pis-aller : c'est la meilleure provenance qui soit, puisqu'il ne passe
  // par aucune de nos mains. Ce qui mérite d'être jugé, c'est s'il a servi —
  // s'il contenait la clé et si la signature a tenu.
  //
  // La provenance reste écrite, en toutes lettres, parce que c'est l'argument
  // de la page. Elle cesse seulement de gouverner la couleur.
  const text = {
    network: T.vDidFromNetwork,
    bundled: T.vDidFromBundle,
    browser: T.vDidFromBrowser,
    supplied: T.vDidFromSupplied,
    none: T.vDidUnresolved,
  }[state.didSource];
  if (!text) return "";
  const kind = provenanceKind(state.didUsed, state.didSource);
  const badge = `<p><span class="badge badge--${kind}">${esc(text)}</span></p>`;

  // Le bandeau. La pastille suffit à qui sait la lire ; le bandeau s'adresse à
  // qui regarde l'écran sans connaître le montage. Tant qu'AGM n'a pas déposé
  // son document — l'installation n'est que partielle — le « téléchargement »
  // affiché plus haut n'a pas eu lieu, et le taire ferait de cette page une
  // démonstration truquée.
  if (state.didSource === "network" || state.didSource === "supplied") return badge;
  return badge + `<p class="banner banner--warning">${esc(T.vDidSimulated)}</p>`;
}

/**
 * Le recalcul — ce que cette page existe pour rendre possible.
 *
 * LE VÉRIFICATEUR NE NOUS APPELLE PAS. C'est l'énoncé central du dossier, et
 * c'est ici qu'il devient constatable : le compte du vérificateur n'a AUCUN
 * droit sur la plateforme, il ne peut donc rien demander. Tout ce que cette
 * section affiche vient de l'attestation qu'on lui a remise, et de rien d'autre.
 *
 * TROIS RÉPONSES, ET LA TROISIÈME EST CELLE QUI MANQUE PARTOUT AILLEURS. Une
 * signature vérifiée dit que le document n'a pas bougé ; elle ne dit pas que le
 * total est la somme de ses parts. Le recalcul le dit — quand toutes les
 * cellules qui comptent ont été divulguées. Sinon la réponse honnête est « on ne
 * peut pas savoir », et la distinguer de « faux » est essentiel : une
 * divulgation partielle est un droit du porteur, pas une fraude, et l'afficher
 * en rouge apprendrait au lecteur à ignorer l'alerte.
 */
async function renderMatrix(doc) {
  const matrix = doc?.credentialSubject?.breakdown;
  if (!Array.isArray(matrix) || !matrix.length || !("commitment" in (matrix[0] ?? {}))) {
    return "";                                   // pas une attestation à matrice
  }

  const checked = await verifyMatrix(matrix, state.disclosures);
  const sum = recomputeTotal(matrix, state.disclosures);

  const rows = [];
  const badge = (kind, text) => `<span class="badge badge--${kind}">${esc(text)}</span>`;

  rows.push(`<div><dt>${T.vCells}</dt><dd>${matrix.length} — ` +
            `${checked.disclosed} ${T.vDisclosed}, ${checked.withheld} ${T.vWithheld}</dd></div>`);

  rows.push(`<div><dt>${T.vCommitments}</dt><dd>` +
    (checked.ok ? badge("verified", T.vCommitmentsOk)
                : badge("warning", `${T.vCommitmentsBad} — ${checked.mismatched.join(", ")}`)) +
    `</dd></div>`);

  if (sum.known) {
    // L'engagement sur le total lie le chiffre à la matrice : sans lui, on
    // pourrait divulguer un sous-ensemble et annoncer le total de son choix.
    let bound = null;
    if (state.totalSalt) {
      const again = await commitTotal(matrix, sum.total, "kgCO2e", state.totalSalt);
      bound = again.commitment === doc.credentialSubject.totalCommitment;
    }
    rows.push(`<div><dt>${T.vRecomputed}</dt><dd>${sum.total.toLocaleString("fr-FR")} kgCO2e ` +
      (bound === null ? badge("info", T.vNoTotalSalt)
       : bound ? badge("verified", T.vTotalBound) : badge("warning", T.vTotalUnbound)) +
      `</dd></div>`);
  } else {
    rows.push(`<div><dt>${T.vRecomputed}</dt><dd>` +
      badge("info", `${T.vCannotKnow} — ${sum.withheld} ${T.vWithheldCounted}`) + `</dd></div>`);
  }

  // Ce que la décision 1 de #61 demande de rendre appréciable : ce qui n'a pas
  // compté, et pourquoi — visible même sur une cellule non divulguée.
  const unusable = checked.unusable.length
    ? `<h3 class="subhead">${T.vNotCounted}</h3><ul>` +
      checked.unusable.map((c) => `<li>${T.vCell} ${c.index} — ${esc(c.reason || T.vNoReason)}</li>`).join("") +
      `</ul>`
    : "";

  return `<h3 class="subhead">${T.vMatrix}</h3>
          <p class="muted">${T.vMatrixBody}</p>
          <dl class="facts">${rows.join("")}</dl>${unusable}`;
}

/**
 * Pourquoi CE document ne vérifie pas CETTE attestation — dit sur la carte du
 * document, là où le vérificateur regarde.
 *
 * LE MESSAGE QUI MANQUAIT. Une attestation signée par une clé absente du
 * document donnait un refus dans l'étape 3, à l'autre bout de l'écran, sous une
 * formulation qui ne nommait pas le geste à faire. Or c'est le cas le PLUS
 * fréquent en pratique : la mine a fait tourner sa clé, ou signé depuis un
 * autre poste, et le document apporté ne porte que la clé du jour. Le produit a
 * déjà la réponse — le document DID est append-only et l'écran de fusion existe
 * pour cela — encore faut-il que le vérificateur sache que c'est de cela qu'il
 * s'agit.
 *
 * On nomme donc les deux côtés : la clé qui a signé, et celles que le document
 * publie. Le rapprochement se fait à l'œil, en une seconde.
 */
function keyMismatch() {
  const gap = missingKey(state.credential, state.didDoc);
  if (!gap) return null;
  return `<p class="muted">${T.vSignedBy} <code>${esc(gap.signed)}</code></p>` +
         `<p class="muted">${T.vDocPublishes} ${
           gap.published.length
             ? gap.published.map((id) => `<code>${esc(id)}</code>`).join(", ")
             : `<em>${esc(T.vDocPublishesNone)}</em>`}</p>` +
         `<p class="muted">${T.vKeyRotated}</p>`;
}

/**
 * L'encart qui suit l'attestation : qui l'émet, où sa clé devrait vivre, d'où
 * celle-ci vient, et — le cas échéant — pourquoi elle ne convient pas.
 *
 * Extrait de `refresh` pour pouvoir être rendu APRÈS la vérification. Tant
 * qu'il était construit avant, la pastille de provenance ne pouvait pas
 * refléter le résultat.
 */
function renderHint(url) {
  return `<p>${T.vIssuerIs} <code>${esc(state.credential.issuer)}</code></p>` +
    (url ? `<p>${T.vFetchAt} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>` +
           // POURQUOI C'EST À VOUS DE LE FAIRE. Un navigateur ne peut pas lire
           // le `.well-known` d'un domaine tiers : la politique de sécurité de
           // ce site interdit toute connexion sortante, et le domaine de
           // l'émetteur devrait en outre l'autoriser explicitement. Vous, en
           // revanche, pouvez ouvrir ce lien — et c'est mieux ainsi, puisque le
           // document ne passe alors par aucune de nos mains.
           `<p class="muted">${T.vCannotFetch}</p>` +
           `<p class="muted">${T.vFetchHow}</p>`
         : `<p class="muted">${T.vNotDidWeb}</p>`) +
    provenance() + (keyMismatch() ?? "");
}

/** Le compte rendu du document, sur SA carte — étape 2, pas étape 3. */
function renderDidStatus() {
  const status = $("[data-did-status]");
  if (!status || !state.didDoc) return;
  if (state.didUsed === true) {
    status.textContent = T.vDidVerified;
    status.className = "badge badge--verified";
  } else if (state.didUsed === false) {
    status.textContent = T.vDidDidNotVerify;
    status.className = "badge badge--warning";
  }
}

async function refresh() {
  const hint = $("[data-did-hint]");
  const out = $("[data-verdict]");
  const body = $("[data-contents]");

  // As soon as the credential is in, say where its issuer's key lives.
  let url = null;
  if (state.credential?.issuer) {
    url = didWebUrl(state.credential.issuer);

    // Résolution automatique, réseau d'abord. Sans elle il fallait déposer un
    // fichier à la main, ce qui fonctionne et se filme mal.
    if (!state.didDoc) {
      try {
        const got = await resolveDid(state.credential.issuer);
        state.didDoc = got.document;
        state.didSource = got.source;
      } catch { state.didSource = "none"; }
    }

    hint.hidden = false;
  } else {
    hint.hidden = true;
  }

  // LA VÉRIFICATION D'ABORD, L'AFFICHAGE ENSUITE, et l'ordre est le correctif.
  // La provenance se colore selon ce que le document a FAIT ; la rendre avant de
  // le savoir affichait la couleur du passage précédent — donc jamais la bonne
  // au premier dépôt, ce qui se lisait comme « le DID ne passe jamais vert ».
  const r = state.credential && state.didDoc
    ? await verifyCredential(state.credential, state.didDoc)
    : null;
  state.didUsed = r ? r.ok : null;
  renderDidStatus();
  if (!hint.hidden) hint.innerHTML = renderHint(url);

  if (!r) { out.hidden = true; body.hidden = true; return; }

  out.hidden = false;
  out.innerHTML = r.ok
    ? `<span class="badge badge--verified">${T.vValid}</span> <span class="muted">${T.vValidBody}</span>`
    : `<span class="badge badge--warning">${T.vInvalid}</span> <span class="muted">${esc(r.reason ?? "")}</span>`;
  for (const n of r.notes ?? []) out.innerHTML += `<p class="muted">${esc(n)}</p>`;

  if (!r.ok) { body.hidden = true; return; }

  const d = r.document;
  body.hidden = false;
  const matrix = await renderMatrix(d);
  body.innerHTML = `
    ${matrix}
    <h3 class="subhead">${T.vAttested}</h3>
    <dl class="facts">${renderClaims(d)}</dl>
    <h3 class="subhead">${T.vProvenance}</h3>
    <dl class="facts">
      <div><dt>${T.vIssuer}</dt><dd>${esc(d.issuer ?? "—")}</dd></div>
      <div><dt>${T.vSubject}</dt><dd>${esc(d.credentialSubject?.id ?? "—")}</dd></div>
      <div><dt>${T.vSignedOn}</dt><dd>${esc(r.proof?.created ?? "—")}</dd></div>
      <div><dt>${T.vConfirmedBy}</dt><dd>${esc(d.confirmedBy?.name ?? T.vNotIdentified)}</dd></div>
    </dl>`;
}

document.addEventListener("DOMContentLoaded", () => {
  wireInput("vc", (j) => { state.credential = unwrap(j); });
  // Un document déposé à la main l'emporte : le vérificateur qui apporte le
  // sien sait ce qu'il fait, et la provenance devient « fourni ».
  wireInput("did", (j) => { state.didDoc = j; state.didSource = "supplied"; });
});
