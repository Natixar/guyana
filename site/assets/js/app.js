// Écran de signature. Sans dépendance : WebCrypto est natif.

import T from "./labels.js";
import { loadKeyPair, createKeyPair, thumbprint, readable } from "./keys.js";
import { buildDidDocument, downloadJson, verificationMethodId } from "./did.js";
import { wireDidMerge } from "./did-merge.js";
import { fetchMe, issuerDid, isDemo } from "./me.js";
import { fetchPour, renderPour, operatorClaims } from "./pour.js";
import { buildCredential, signCredential, newSubjectId } from "./credential.js";
import { signView } from "./sign-state.js";
import { putCredential, credentialsByRef } from "./wallet.js";
import { depositCredential } from "./deposit.js";

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
 *
 * Elle doit donc recevoir TOUT l'état dont dépend l'affichage. Elle n'a
 * longtemps connu ni la coulée ni la signature déjà produite, si bien que deux
 * des cinq contrôles qu'elle gouverne étaient écrits ailleurs, sans ordre
 * garanti : « créez d'abord une clé » survivait à la création de la clé, le
 * bouton s'activait sans coulée, et un retour arrière permettait de signer deux
 * fois la même coulée sous deux identifiants de sujet différents (#64).
 *
 * D'où la règle : cette fonction est le seul écrivain du bouton de signature et
 * de son statut. Si un état nouveau apparaît, il entre dans `ctx`, il n'est pas
 * écrit à côté.
 */
async function refreshState(ctx) {
  const { status, createBtn, signBtn, signStatus, did, pour, signed, deposit } = ctx;
  const pair = await loadKeyPair();

  setBadge(status, pair ? T.envKeyPresent : T.envKeyMissing, pair ? "verified" : "pending");

  if (createBtn) {
    createBtn.disabled = Boolean(pair);
    const why = $("[data-create-why]");
    if (why) why.textContent = pair ? T.keyAvailableHere : "";
  }

  const result = $("[data-setup-result]");
  if (pair) await showFingerprint(pair);
  else if (result) { result.hidden = true; $("[data-fingerprint]").textContent = "—"; }

  const view = signView({ pair, did, pour, signed });
  if (signBtn) signBtn.disabled = view.disabled;
  if (signStatus) signStatus.textContent = view.text;

  // Le compte rendu du dépôt est un état que l'affichage ne peut pas relire :
  // réinterroger le magasin ne dirait pas si CE dépôt-ci a abouti. Il passe donc
  // par `ctx`, comme tout le reste depuis #64.
  const depositLine = $("[data-deposit]");
  if (depositLine) {
    depositLine.hidden = !deposit;
    if (deposit) {
      depositLine.textContent = deposit.ok
        ? T.barDeposited
        : `${T.barDepositFailed} — ${deposit.why}`;
    }
  }

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

  // La coulée est un état de l'affichage, donc elle est connue AVANT le premier
  // calcul. La chercher après obligeait à corriger le statut de signature juste
  // derrière, ce qui est précisément la double écriture supprimée ici.
  const pour = await fetchPour();

  const ctx = { status, createBtn: $("[data-create-key]"), signBtn: $("[data-sign]"),
                signStatus: $("[data-sign-status]"), did,
                pour: pour && renderPour(pour) ? pour : null, signed: null, deposit: null };

  // Le portefeuille est consulté AVANT le premier rendu : une coulée déjà
  // confirmée dans une session précédente doit s'afficher comme telle, et non
  // se proposer une seconde fois.
  if (ctx.pour?.pourId) {
    const held = await credentialsByRef(ctx.pour.pourId);
    ctx.signed = held.DoreBarOriginCredential?.document ?? null;
  }

  if (ctx.pour?.dataOrigin && ctx.pour.dataOrigin !== "MEASURED") {
    const tag = $("[data-pour-origin]");
    if (tag) { tag.textContent = ctx.pour.dataOrigin.toLowerCase(); tag.hidden = false; }
  }

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
  const signBtn = ctx.signBtn;
  const signStatus = ctx.signStatus;

  signBtn?.addEventListener("click", async () => {
    signBtn.disabled = true;
    try {
      const pair = await loadKeyPair();
      const subjectId = newSubjectId();
      const cred = buildCredential({
        issuerDid: did,
        subjectId,
        claims: operatorClaims(ctx.pour),
        confirmedBy: me.person ? { id: me.person.id, name: me.person.name } : null,
      });
      // L'identifiant de la clé est son empreinte, pas un nom de politique :
      // deux clés portant le même nom se supprimaient l'une l'autre à la
      // publication. Voir `verificationMethodId`.
      ctx.signed = await signCredential(cred, pair, await verificationMethodId(pair, did));
      // Rangée avant tout affichage : une attestation signée qui ne survit pas
      // au rechargement est une attestation que l'opérateur croit détenir.
      await putCredential(ctx.signed, ctx.pour?.pourId ?? null);
      // Rangée d'abord, déposée ensuite — et un magasin injoignable ne retire
      // rien à ce qui est signé ici. Voir `deposit.js`.
      ctx.deposit = await depositCredential(ctx.signed);
      $("[data-signed-subject]").textContent = subjectId;
      $("[data-signed-by]").textContent = me.person?.name ?? T.operatorUnknown;
      $("[data-signed]").hidden = false;
      // L'état est dans ctx : c'est refreshState qui écrit le bouton et son
      // statut, ici comme au retour arrière.
      await refreshState(ctx);
    } catch (err) {
      // L'échec est la seule écriture directe : il porte un texte que
      // refreshState ne peut pas reconstruire depuis l'état.
      if (signStatus) signStatus.textContent = `${T.signFailed} — ${err.message ?? err}`;
      signBtn.disabled = false;
    }
  });

  $("[data-download-credential]")?.addEventListener("click", () => {
    if (ctx.signed) downloadJson(ctx.signed, demo ? "credential.demo.json" : "credential.json");
  });

  // La fusion se branche une fois ; `merge.previous()` rend le document que
  // l'exploitant a chargé, ou null s'il n'y en a pas.
  const merge = wireDidMerge(document, () => did);

  $("[data-download-did]")?.addEventListener("click", async () => {
    const p = await loadKeyPair();
    if (!p) return;
    if (!did) { setBadge(status, T.issuerUnknown, "warning"); return; }
    // En mode dégradé le nom du fichier porte la mention : rien de ce qui sort
    // d'ici sans authentification ne doit pouvoir être publié par inadvertance.
    downloadJson(await buildDidDocument(p, did, merge.previous()),
                 demo ? T.downloadDemoName : "did.json");
  });
});
