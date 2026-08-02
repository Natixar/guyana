// Wiring for the verification page. Two inputs, one verdict.

import T from "./labels.js";
import { verifyCredential, didWebUrl } from "./verify.js";
import { resolveDid } from "./did-source.js";
import { esc } from "./escape.js";
import { verifyMatrix, recomputeTotal, commitTotal } from "./commitments.js";
import { showLoaded } from "./loaded-text.js";

const $ = (s) => document.querySelector(s);
const state = { credential: null, didDoc: null, didSource: null,
                disclosures: [], totalSalt: null };

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
function provenance() {
  const label = {
    network: [T.vDidFromNetwork, "verified"],
    bundled: [T.vDidFromBundle, "warning"],
    browser: [T.vDidFromBrowser, "warning"],
    supplied: [T.vDidFromSupplied, "info"],
    none: [T.vDidUnresolved, "warning"],
  }[state.didSource];
  if (!label) return "";
  const [text, kind] = label;
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

async function refresh() {
  const hint = $("[data-did-hint]");
  const out = $("[data-verdict]");
  const body = $("[data-contents]");

  // As soon as the credential is in, say where its issuer's key lives.
  if (state.credential?.issuer) {
    const url = didWebUrl(state.credential.issuer);

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
    hint.innerHTML = `<p>${T.vIssuerIs} <code>${esc(state.credential.issuer)}</code></p>` +
      (url ? `<p>${T.vFetchAt} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>` +
             // POURQUOI C'EST À VOUS DE LE FAIRE. Un navigateur ne peut pas
             // lire le `.well-known` d'un domaine tiers : la politique de
             // sécurité de ce site interdit toute connexion sortante, et le
             // domaine de l'émetteur devrait en outre l'autoriser explicitement.
             // Vous, en revanche, pouvez ouvrir ce lien — et c'est mieux ainsi,
             // puisque le document ne passe alors par aucune de nos mains.
             `<p class="muted">${T.vCannotFetch}</p>` +
             `<p class="muted">${T.vFetchHow}</p>`
           : `<p class="muted">${T.vNotDidWeb}</p>`) +
      provenance();
  } else {
    hint.hidden = true;
  }

  if (!state.credential || !state.didDoc) { out.hidden = true; body.hidden = true; return; }

  const r = await verifyCredential(state.credential, state.didDoc);
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
