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
import { credentialsByRef, putCredential } from "./wallet.js";
import { renderCertificates } from "./certificate-view.js";
import { verifyCredential, didWebUrl } from "./verify.js";
import { formatMass } from "./mass.js";
import { loadKeyPair } from "./keys.js";
import { fetchMe, issuerDid } from "./me.js";
import { barClaims } from "./bar-claims.js";
import { buildCredential, signCredential } from "./credential.js";
import { verificationMethodId } from "./did.js";
import { esc } from "./escape.js";
import { signView } from "./sign-state.js";
import { depositCredential } from "./deposit.js";

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
  const [fixture, me] = await Promise.all([
    loadFixture().catch(() => null),
    fetchMe(),
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
  const ctx = { deposit: null };

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
    certificatesBody.innerHTML = renderCertificates(foreign);

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
    signStatus.textContent = elsewhere ? T.barSignElsewhere : view.text;

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
