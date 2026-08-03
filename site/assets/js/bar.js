/**
 * La page d'une barre.
 *
 * Elle sert à quatre choses : montrer ce que la mine atteste, la **certifier**,
 * montrer ce que ce navigateur détient, et — quand l'attestation est ailleurs —
 * permettre de la rapatrier.
 *
 * CERTIFIER SE FAIT ICI, PAS DANS LE REGISTRE. Le registre montre trois cent
 * soixante-dix-huit lignes ; un bouton par ligne signerait un lingot que
 * l'opérateur n'a pas regardé. La règle de `pour.js` vaut pour les barres comme
 * pour la coulée : celui qui confirme doit voir ce qu'il atteste. Le registre
 * conduit donc ici, et il reflète ce qui a été signé.
 *
 * RAPATRIER EST UN ACTE, ET IL VÉRIFIE. Le portefeuille ne se remplit pas tout
 * seul depuis le serveur : cela ferait du magasin la source de vérité de ce que
 * la mine détient, alors que toute la page d'accueil dit à l'opérateur que sa
 * clé ne quitte pas son navigateur. La récupération est donc explicite, et elle
 * contrôle la signature à l'arrivée — ce qui démontre la chaîne une seconde
 * fois, depuis le côté de la mine.
 */
import T from "./labels.js";
import { credentialsByRef, putCredential, credentialType as credentialTypeOf } from "./wallet.js";
import { renderCertificates } from "./certificate-view.js";
import { verifyCredential, didWebUrl } from "./verify.js";
import { formatMass } from "./mass.js";
import { loadKeyPair } from "./keys.js";
import { fetchMe, issuerDid, issuerBlocker } from "./me.js";
import { barClaims } from "./bar-claims.js";
import { buildCredential, signCredential } from "./credential.js";
import { verificationMethodId } from "./did.js";
import { esc } from "./escape.js";
import { signView } from "./sign-state.js";
import { depositCredential } from "./deposit.js";
import { requestCarbonCredential, originRef } from "./carbon-request.js";
import { fetchLabels, applyTo } from "./pivot-labels.js";

const $ = (s) => document.querySelector(s);

const fact = (label, value) =>
  `<div><dt>${label}</dt><dd>${value ?? "—"}</dd></div>`;

/**
 * Le jour LOCAL de la mine, pas celui du navigateur.
 *
 * Un instant affiché dans le fuseau du lecteur ferait apparaître une coulée du
 * 1er mars comme datée du 28 février à quiconque regarde depuis l'Europe. Les
 * rapports d'AGM sont en jours guyaniens ; l'écran doit l'être aussi.
 */
const localDay = (iso) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Guyana" });

/**
 * Lit une réponse en exigeant du JSON.
 *
 * Le site répond 200 avec sa page d'accueil pour tout chemin inconnu : une
 * erreur de routage arrive donc ici sous la forme d'un succès contenant du
 * HTML, et `JSON.parse` répond « Unexpected token '<' » — un message qui ne
 * nomme ni le routage ni le service absent. On le nomme.
 */
async function asJson(res, what) {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new Error(`${what} : réponse non JSON (${type || "type absent"}) — routage ?`);
  }
  return res.json();
}

async function loadFixture() {
  const r = await fetch("/engine/erp-fixture.json", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return asJson(r, "erp-fixture.json");
}

/** Vérifie une attestation rapatriée contre le DID de son émetteur. */
async function verifyFetched(doc) {
  const url = didWebUrl(doc.issuer);
  if (!url) return { ok: false, why: "issuer is not a did:web" };
  const res = await fetch(url);
  if (!res.ok) return { ok: false, why: `DID document: HTTP ${res.status}` };
  const outcome = await verifyCredential(doc, await res.json());
  return { ok: outcome?.ok === true, why: outcome?.reason ?? "" };
}

document.addEventListener("DOMContentLoaded", async () => {
  const root = $("[data-bar]");
  if (!root) return;

  const wanted = new URLSearchParams(location.search).get("id");
  // L'identité en même temps que le jeu d'essai : elle décide au nom de qui on
  // signe, et la page ne peut pas afficher son bouton avant de le savoir.
  // Les libellés de la taxonomie, chargés une fois. Leur absence ne casse
  // rien : les positions s'affichent alors en clair, sous leur numéro.
  const [fixture, me, labels] = await Promise.all([
    loadFixture().catch(() => null),
    fetchMe(),
    fetchLabels(),
  ]);
  const did = issuerDid(me);
  const bar = fixture?.bars?.find((b) => b.internalId === wanted);

  if (!bar) {
    // ÉCHAPPÉ : `wanted` vient de l'URL. Sans cela, un lien fabriqué exécute
    // du script sur la page qui détient la clé de signature.
    root.innerHTML = `<p class="badge badge--warning">${T.barUnknown} — ${esc(wanted)}</p>`;
    return;
  }

  const lot = fixture.lots.find((l) => l.id === bar.lot);
  root.innerHTML = `
    <h2>${esc(bar.internalId)}</h2>
    <dl class="facts">
      ${fact(T.barSubject, `<code>${esc(bar.subjectId)}</code>`)}
      ${fact(T.barLot, `${esc(bar.lot)} — ${T.registerDrawnFrom} ${esc(lot?.productionMonth ?? "?")}`)}
      ${fact(T.barPourDate, localDay(bar.pouredAt))}
      ${fact(T.barFineGold, formatMass(bar.fineGoldKg))}
      ${fact(T.barGrossMass, formatMass(bar.grossMassKg))}
      ${fact(T.barAssay, `${(bar.assay * 100).toFixed(2)} %`)}
    </dl>

    <h3 class="subhead">${T.barCredentials}</h3>
    <p><span data-bar-status class="badge badge--pending"></span></p>
    <p class="muted" data-bar-hint hidden>${T.barStatusHint}</p>
    <p class="actions">
      <button class="btn btn--primary" data-bar-sign hidden>${T.barSign}</button>
      <button class="btn btn--primary" data-bar-fetch hidden>${T.barFetch}</button>
      <span class="muted" data-bar-fetch-status></span>
    </p>
    <p class="muted" data-bar-sign-status></p>
    <p class="muted" data-bar-deposit hidden></p>

    <h3 class="subhead">${T.certIntensity}</h3>
    <p class="muted">${T.barCarbonWhy}</p>
    <p class="actions">
      <button class="btn" data-bar-carbon>${T.barCarbon}</button>
      <a class="btn btn--ghost" data-bar-carbon-download hidden download>${T.barCarbonDownload}</a>
    </p>
    <p class="muted" data-bar-carbon-status></p>

    <section data-bar-certificates hidden>
      <h3 class="subhead">${T.certHeld}</h3>
      <p class="muted">${T.certHeldWhy}</p>
      <div data-bar-certificates-body></div>
    </section>

    <p><a href="/register/">${T.barBackToRegister}</a></p>
  `;

  const badge = $("[data-bar-status]");
  const hint = $("[data-bar-hint]");
  const signBtn = $("[data-bar-sign]");
  const signStatus = $("[data-bar-sign-status]");
  const deposit = $("[data-bar-deposit]");
  const fetchBtn = $("[data-bar-fetch]");
  const fetchStatus = $("[data-bar-fetch-status]");
  const certificates = $("[data-bar-certificates]");
  const certificatesBody = $("[data-bar-certificates-body]");

  /**
   * L'état que l'affichage ne peut pas relire.
   *
   * Le compte rendu du dépôt en fait partie : le magasin a répondu une fois, et
   * l'interroger de nouveau ne dirait pas si CE dépôt-ci a abouti. Il entre
   * donc dans le contexte plutôt que d'être écrit à côté — règle de `app.js`
   * après #64 : un état nouveau entre dans `ctx`, il ne s'écrit pas ailleurs.
   */
  const ctx = { deposit: null, carbon: null };

  const carbonBtn = $("[data-bar-carbon]");
  const carbonStatus = $("[data-bar-carbon-status]");
  const carbonLink = $("[data-bar-carbon-download]");

  /**
   * Ce que le magasin détient pour CETTE barre. L'index complet n'a pas sa place ici.
   *
   * Un seul aller-retour sert deux questions — « la barre est-elle certifiée
   * ailleurs ? » et « que dit ce que Natixar a signé ? ». Les poser séparément
   * ferait deux requêtes pour une réponse, et laisserait les deux vues diverger
   * le jour où l'une répondrait et l'autre non.
   */
  async function storeHolds() {
    const res = await fetch(`/api/v1/credentials/${encodeURIComponent(bar.subjectId)}`)
      .catch(() => null);
    // Un 200 portant du HTML n'est pas une attestation : c'est le site qui a
    // répondu à la place du magasin.
    if (!res?.ok || !(res.headers.get("content-type") ?? "").includes("json")) return [];
    const body = await res.json().catch(() => null);
    return Array.isArray(body?.credentials) ? body.credentials : [];
  }

  /** Un seul écrivain de l'état, comme sur la page d'accueil (#64). */
  async function render() {
    const [pair, current] = await Promise.all([loadKeyPair(), credentialsByRef(bar.internalId)]);
    const mine = current.DoreBarOriginCredential?.document ?? null;

    // CE QUE LE MAGASIN DÉTIENT SE DEMANDE TOUJOURS, même quand le portefeuille
    // a l'attestation d'origine. Ce qu'on vient chercher n'est pas seulement
    // « est-elle certifiée ailleurs » : c'est l'attestation CARBONE, que la mine
    // n'a pas faite, qui est signée sous une autre clé que la sienne, et qu'elle
    // n'a aucun autre endroit où lire.
    const held = await storeHolds();
    const elsewhere = mine ? false : held.length > 0;

    // Ce qui vient d'être signé dans ce navigateur est déjà à l'écran juste
    // au-dessus ; le répéter ici n'apprendrait rien. Ne s'affiche donc que ce
    // que quelqu'un d'AUTRE a signé.
    const foreign = held.filter((r) => r?.document?.issuer && r.document.issuer !== did);
    certificates.hidden = foreign.length === 0;
    // LES DIVULGATIONS NE VIENNENT JAMAIS DU MAGASIN, et c'est pour cela
    // qu'elles sont passées ici depuis le contexte plutôt que lues avec le
    // document. Le magasin détient l'attestation — des engagements scellés — ;
    // les montants qui les ouvrent sont nés dans la réponse du signataire et
    // n'ont pas bougé de ce navigateur. Sans elles, la matrice affiche son
    // dénombrement et rien d'autre, ce qui est la propriété, pas une panne.
    // LES LIBELLÉS SONT CONFRONTÉS À LA VERSION QUE L'ATTESTATION DÉCLARE.
    // Un libellé emprunté à une autre version se lirait comme une information
    // alors qu'il serait une supposition.
    //
    // ON LES RELIT DU PORTEFEUILLE, et non d'une variable de page : celle-ci ne
    // survivait pas à un rechargement, et l'écran affichait alors une matrice de
    // tirets — un calcul signé dont plus une ligne n'était lisible. Le
    // rapprochement se fait par TYPE, la seule clé que les deux côtés
    // partagent : le magasin calcule sa propre empreinte, et rien ne garantit
    // qu'elle coïncide avec la nôtre.
    const declared = foreign[0]?.document?.credentialSubject?.method?.taxonomy;
    const withLocal = foreign.map((r) => {
      const held = current[r?.type ?? credentialTypeOf(r?.document)];
      return held?.disclosures ? { ...r, disclosures: held.disclosures } : r;
    });
    certificatesBody.innerHTML = renderCertificates(
      withLocal, {}, applyTo(labels, declared));

    // Le carbone se demande une fois l'origine signée : `derivedFrom` la
    // désigne par empreinte, et sans elle l'intensité flotterait sur un
    // identifiant que personne n'a revendiqué.
    const hasCarbon = foreign.some(
      (r) => r?.document?.credentialSubject?.carbonIntensity);
    carbonBtn.disabled = !mine || hasCarbon;
    if (!ctx.carbon?.text) {
      carbonStatus.textContent = mine
        ? (hasCarbon ? T.barCarbonDone : "")
        : T.barCarbonNeedOrigin;
    }

    badge.textContent = mine ? T.barStatusHere : (elsewhere ? T.barStatusElsewhere : T.barStatusNone);
    badge.className = `badge badge--${mine ? "verified" : (elsewhere ? "warning" : "pending")}`;
    hint.hidden = !elsewhere;
    fetchBtn.hidden = !elsewhere;

    // Certifier une barre que le magasin détient déjà émettrait une seconde
    // attestation pour le même lingot physique. La récupérer est la bonne
    // action, et c'est celle que la page propose alors.
    const view = signView({ pair, did, pour: bar, signed: mine });
    signBtn.hidden = Boolean(mine);
    signBtn.disabled = view.disabled || elsewhere;
    // L'OBSTACLE D'IDENTITÉ NOMME LE COMPTE ET LE REMÈDE. « No organisation
    // identity available » est vrai et inutilisable : il ne dit ni qui est
    // connecté, ni que le refus est NORMAL, ni quoi faire. L'opérateur en
    // conclut que le produit est cassé, alors qu'une règle d'autorisation vient
    // de faire son travail — signer l'origine d'un lingot est un acte de la
    // MINE, et un compte de la plateforme n'est pas la mine.
    const identity = issuerBlocker(me);
    signStatus.textContent = elsewhere ? T.barSignElsewhere
                           : (view.text === T.issuerUnknown && identity) ? identity
                           : view.text;

    deposit.hidden = !ctx.deposit;
    if (ctx.deposit) {
      deposit.textContent = ctx.deposit.ok
        ? T.barDeposited
        : `${T.barDepositFailed} — ${ctx.deposit.why}`;
    }
  }

  signBtn?.addEventListener("click", async () => {
    signBtn.disabled = true;
    signStatus.textContent = T.barSigning;
    try {
      const pair = await loadKeyPair();
      const cred = buildCredential({
        issuerDid: did,
        // L'identifiant de sujet vient du jeu d'essai, il ne se tire pas ici :
        // c'est lui que le magasin indexe et que le registre interroge pour
        // savoir si la barre est certifiée ailleurs. En tirer un nouveau à
        // chaque signature rendrait cette question sans réponse.
        subjectId: bar.subjectId,
        claims: barClaims(bar, fixture),
        confirmedBy: me.person ? { id: me.person.id, name: me.person.name } : null,
      });
      const signed = await signCredential(cred, pair, await verificationMethodId(pair, did));
      // Rangée avant d'être déposée : un dépôt réussi que le portefeuille aurait
      // manqué ferait croire à l'opérateur qu'il ne détient rien.
      await putCredential(signed, bar.internalId);
      ctx.deposit = await depositCredential(signed);
    } catch (err) {
      // L'échec de signature est la seule écriture directe : il porte un texte
      // que `render` ne peut pas reconstruire depuis l'état.
      signStatus.textContent = `${T.signFailed} — ${err.message ?? err}`;
      signBtn.disabled = false;
      return;
    }
    await render();
  });

  /**
   * Faire signer par Natixar le contenu carbone de CETTE barre.
   *
   * LE GESTE QUI MANQUAIT. Tout le reste existait — le magasin sert et signe ce
   * qu'il sert, le signataire recalcule avant de signer, la page publique
   * recalcule sans nous appeler — mais rien ne les reliait, et le vérificateur
   * n'avait donc jamais de carbone à vérifier.
   *
   * AUCUNE SAISIE. La sélection des données se dérive de la barre : les deux
   * mois de son lot, les départements que le procédé place sur le chemin de la
   * matière, et le partage des frais généraux entre les lots actifs sur la
   * fenêtre. L'opérateur clique ; il ne choisit pas, et deux opérateurs
   * obtiennent le même chiffre.
   *
   * LES DIVULGATIONS RESTENT ICI. Elles partent dans le contexte de la page, pas
   * au magasin : c'est ce qui laisse au porteur le droit d'en retirer avant de
   * présenter, sans toucher à un octet de ce qui a été signé.
   */
  carbonBtn?.addEventListener("click", async () => {
    carbonBtn.disabled = true;
    ctx.carbon = { text: T.barCarbonRunning };
    carbonStatus.textContent = ctx.carbon.text;
    try {
      const origin = (await credentialsByRef(bar.internalId))
        .DoreBarOriginCredential?.document;
      if (!origin) throw new Error(T.barCarbonNeedOrigin);

      const out = await requestCarbonCredential({
        bar, fixture, origin: await originRef(origin),
      });

      // Rangée avant tout affichage : une attestation reçue puis perdue parce
      // que le dépôt a échoué serait le pire des deux.
      await putCredential(out.credential, bar.internalId,
                          { disclosures: out.disclosures, totalSalt: out.totalSalt });
      const deposited = await depositCredential(out.credential);

      // La présentation — attestation, divulgations, sel du total — sous la
      // forme même que la page de vérification sait déposer. Un seul fichier,
      // parce que c'est le seul geste qu'on puisse demander à un vérificateur
      // de faire juste.
      const presentation = new Blob([JSON.stringify({
        credential: out.credential,
        disclosures: out.disclosures,
        totalSalt: out.totalSalt,
      }, null, 2)], { type: "application/json" });
      carbonLink.href = URL.createObjectURL(presentation);
      carbonLink.download = `${bar.internalId}-carbon.json`;
      carbonLink.hidden = false;

      ctx.carbon = {
        text: `${T.barCarbonDone} — ${T.barCarbonCounts
          .replace("{served}", String(out.cellsServed))
          .replace("{used}", String(out.counts.USED))
          .replace("{shared}", String(out.counts.SHARED))
          .replace("{excluded}", String(out.counts.EXCLUDED))}`
          + (deposited.ok ? ` — ${T.barDeposited}` : ` — ${T.barDepositFailed}`)
          + ` — ${T.barCarbonSaved}`,
      };
    } catch (err) {
      // Le code du refus, pas seulement son texte : le signataire répond par des
      // codes stables pour qu'on corrige sans lire une phrase.
      ctx.carbon = { text: `${T.barCarbonFailed} — ${err.code ?? ""} ${err.message ?? err}` };
      carbonBtn.disabled = false;
    }
    carbonStatus.textContent = ctx.carbon.text;
    await render();
    carbonStatus.textContent = ctx.carbon.text;
  });

  fetchBtn?.addEventListener("click", async () => {
    fetchBtn.disabled = true;
    fetchStatus.textContent = T.barFetching;
    try {
      const res = await fetch(`/api/v1/credentials/${encodeURIComponent(bar.subjectId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { credentials } = await asJson(res, "credentials");

      for (const rec of credentials) {
        const checked = await verifyFetched(rec.document);
        // Une attestation qui ne se vérifie pas n'entre pas dans le
        // portefeuille : y ranger un document invalide serait pire que de ne
        // rien ranger, puisque l'opérateur le présenterait de bonne foi.
        if (!checked.ok) throw new Error(`${T.barFetchFailed} — ${checked.why}`);
        await putCredential(rec.document, bar.internalId);
      }
      fetchStatus.textContent = T.barFetched;
    } catch (err) {
      fetchStatus.textContent = `${T.barFetchFailed} — ${err.message}`;
      fetchBtn.disabled = false;
    }
    await render();
  });

  await render();
});
