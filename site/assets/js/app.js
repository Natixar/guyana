// Écran de signature. Sans dépendance : WebCrypto est natif.

import T from "./labels.js";
import { loadKeyPair, createKeyPair, thumbprint, readable } from "./keys.js";
import { buildDidDocument, downloadJson } from "./did.js";
import { fetchMe, issuerDid, isDemo } from "./me.js";
import { fetchPour, renderPour, operatorClaims } from "./pour.js";
import { buildCredential, signCredential, newSubjectId } from "./credential.js";

const $ = (s) => document.querySelector(s);

/**
 * Écrit dans une pastille. Refuse le vide : une pastille sans texte a été
 * observée deux fois sans être reproductible, et je n'ai pas d'explication.
 * Plutôt que de laisser le symptôme muet, on le rend visible.
 *
 * Le garde nommait auparavant la sorte de pastille — « libellé manquant:
 * pending » — c'est-à-dire sa couleur, pas ce qu'il fallait corriger. Nommer la
 * clé introuvable revient désormais à `labels.js`, qui la connaît ; ce garde-ci
 * ne couvre plus que le texte absent pour une autre raison (#62).
 */
function setBadge(el, text, kind) {
  if (!el) return;
  el.textContent = text || `[texte absent: ${kind}]`;
  el.className = "badge badge--" + (kind === "warning" ? "warning" : kind);
}

// Les libellés viennent du document, pas du code.


async function environmentOk() {
  if (!globalThis.isSecureContext) return T.envNotSecure;
  if (!globalThis.crypto?.subtle) return T.envNoWebCrypto;
  if (!globalThis.indexedDB) return T.envNoIndexedDb;
  return null;
}

async function showFingerprint(pair) {
  $("[data-fingerprint]").textContent = readable(await thumbprint(pair));
  $("[data-setup-result]").hidden = false;
}

/**
 * Recalcule tout l'affichage à partir de l'état réel.
 *
 * Appelée au chargement ET au retour arrière : sans cela, le navigateur
 * restaure le DOM depuis son cache de session sans réexécuter les scripts, et
 * la page affiche un état périmé — un bouton de création actif alors qu'une clé
 * existe, ou l'inverse. C'est une classe de bug, pas un cas particulier.
 */
async function refreshState(ctx) {
  const { status, createBtn, signBtn, signStatus, did } = ctx;
  const pair = await loadKeyPair();

  setBadge(status, pair ? T.envKeyPresent : T.envKeyMissing, pair ? "verified" : "pending");

  if (createBtn) {
    createBtn.disabled = Boolean(pair);
    const why = $("[data-create-why]");
    if (why) why.textContent = pair ? T.keyAlreadyThere : "";
  }

  const result = $("[data-setup-result]");
  if (pair) await showFingerprint(pair);
  else if (result) { result.hidden = true; $("[data-fingerprint]").textContent = "—"; }

  if (signBtn) signBtn.disabled = !pair || !did;
  if (signStatus && !pair) signStatus.textContent = T.signNeedsKey;

  return pair;
}

document.addEventListener("DOMContentLoaded", async () => {
  const status = $("[data-key-status]");

  // L'identité d'abord : elle décide de ce qu'on signe et au nom de qui.
  const me = await fetchMe();
  const did = issuerDid(me);
  const demo = isDemo(me);

  if (demo) $("[data-demo-banner]")?.removeAttribute("hidden");
  const problem = await environmentOk();

  if (problem) {
    setBadge(status, problem, "warning");
    return;
  }

  const setup = $("[data-setup]");
  if (setup) setup.hidden = false;

  const ctx = { status, createBtn: $("[data-create-key]"), signBtn: $("[data-sign]"),
                signStatus: $("[data-sign-status]"), did };

  await refreshState(ctx);

  // Le retour arrière restaure la page depuis le cache de session sans
  // réexécuter le module : on recalcule explicitement.
  window.addEventListener("pageshow", (e) => { if (e.persisted) refreshState(ctx); });

  ctx.createBtn?.addEventListener("click", async () => {
    ctx.createBtn.disabled = true;
    try {
      await createKeyPair();
      await refreshState(ctx);
      setBadge(status, T.envKeyCreated, "verified");
    } catch (err) {
      setBadge(status, err.code === "KEY_EXISTS" ? T.envKeyExists : String(err.message ?? err), "warning");
      await refreshState(ctx);
    }
  });

  // --- La coulée en attente -------------------------------------------
  const pour = await fetchPour();
  const signBtn = ctx.signBtn;
  const signStatus = ctx.signStatus;
  let signed = null;

  if (pour && renderPour(pour)) {
    if (pour.dataOrigin && pour.dataOrigin !== "MEASURED") {
      const tag = $("[data-pour-origin]");
      if (tag) { tag.textContent = pour.dataOrigin.toLowerCase(); tag.hidden = false; }
    }
  } else if (signStatus) {
    signStatus.textContent = T.signNoPour;
  }

  signBtn?.addEventListener("click", async () => {
    signBtn.disabled = true;
    try {
      const pair = await loadKeyPair();
      const subjectId = newSubjectId();
      const cred = buildCredential({
        issuerDid: did,
        subjectId,
        claims: operatorClaims(pour),
        confirmedBy: me.person ? { id: me.person.id, name: me.person.name } : null,
      });
      signed = await signCredential(cred, pair, `${did}#${me.keyPolicy?.keyName ?? "key-1"}`);
      $("[data-signed-subject]").textContent = subjectId;
      $("[data-signed-by]").textContent = me.person?.name ?? T.operatorUnknown;
      $("[data-signed]").hidden = false;
      if (signStatus) signStatus.textContent = T.signDone;
    } catch (err) {
      if (signStatus) signStatus.textContent = `${T.signFailed} — ${err.message ?? err}`;
      signBtn.disabled = false;
    }
  });

  $("[data-download-credential]")?.addEventListener("click", () => {
    if (signed) downloadJson(signed, demo ? "credential.demo.json" : "credential.json");
  });

  $("[data-download-did]")?.addEventListener("click", async () => {
    const p = await loadKeyPair();
    if (!p) return;
    if (!did) { setBadge(status, T.issuerUnknown, "warning"); return; }
    // En mode dégradé le nom du fichier porte la mention : rien de ce qui sort
    // d'ici sans authentification ne doit pouvoir être publié par inadvertance.
    downloadJson(await buildDidDocument(p, did, me.keyPolicy?.keyName ?? "key-1"),
                 demo ? T.downloadDemoName : "did.json");
  });
});
