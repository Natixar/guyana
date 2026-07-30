// Écran de signature. Sans dépendance : WebCrypto est natif.

import T from "@params";
import { loadKeyPair, createKeyPair, thumbprint, readable } from "./keys.js";
import { buildDidDocument, downloadJson } from "./did.js";
import { fetchMe, issuerDid, isDemo } from "./me.js";

const $ = (s) => document.querySelector(s);

/**
 * Écrit dans une pastille. Refuse le vide : une pastille sans texte a été
 * observée deux fois sans être reproductible, et je n'ai pas d'explication.
 * Plutôt que de laisser le symptôme muet, on le rend visible.
 */
function setBadge(el, text, kind) {
  if (!el) return;
  el.textContent = text || `[libellé manquant: ${kind}]`;
  el.className = "badge badge--" + (kind === "warning" ? "warning" : kind);
}

// Les libellés viennent du document, pas du code.


async function environmentOk() {
  if (!globalThis.isSecureContext) return T.notSecure;
  if (!globalThis.crypto?.subtle) return T.noWebCrypto;
  if (!globalThis.indexedDB) return T.noIndexedDb;
  return null;
}

async function showFingerprint(pair) {
  $("[data-fingerprint]").textContent = readable(await thumbprint(pair));
  $("[data-setup-result]").hidden = false;
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

  const pair = await loadKeyPair();

  setBadge(status, pair ? T.keyPresent : T.keyMissing, pair ? "verified" : "pending");

  const setup = $("[data-setup]");
  if (setup) setup.hidden = false;
  if (pair) await showFingerprint(pair);

  $("[data-create-key]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await showFingerprint(await createKeyPair());
      setBadge(status, T.keyCreated, "verified");
    } catch (err) {
      setBadge(status, err.code === "KEY_EXISTS" ? T.keyExists : String(err.message ?? err), "warning");
      e.target.disabled = false;
    }
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
