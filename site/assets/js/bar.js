/**
 * La page d'une barre.
 *
 * Elle sert à trois choses : montrer ce que la mine atteste, montrer ce que ce
 * navigateur détient, et — quand l'attestation est ailleurs — permettre de la
 * rapatrier.
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
import { verifyCredential, didWebUrl } from "./verify.js";

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

async function loadFixture() {
  const r = await fetch("/engine/erp-fixture.json", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
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
  const fixture = await loadFixture().catch(() => null);
  const bar = fixture?.bars?.find((b) => b.internalId === wanted);

  if (!bar) {
    root.innerHTML = `<p class="badge badge--warning">${T.barUnknown} — ${wanted ?? ""}</p>`;
    return;
  }

  const lot = fixture.lots.find((l) => l.id === bar.lot);
  root.innerHTML = `
    <h2>${bar.internalId}</h2>
    <dl class="facts">
      ${fact(T.barSubject, `<code>${bar.subjectId}</code>`)}
      ${fact(T.barLot, `${bar.lot} — ${T.registerDrawnFrom} ${lot?.productionMonth ?? "?"}`)}
      ${fact(T.barPourDate, localDay(bar.pouredAt))}
      ${fact(T.barOunces, `${bar.ounces.toFixed(2)} oz`)}
      ${fact(T.barWeight, `${bar.weightKg.toFixed(3)} kg`)}
      ${fact(T.barAssay, `${(bar.assay * 100).toFixed(2)} %`)}
    </dl>

    <h3 class="subhead">${T.barCredentials}</h3>
    <p><span data-bar-status class="badge badge--pending"></span></p>
    <p class="muted" data-bar-hint hidden>${T.barStatusHint}</p>
    <p class="actions">
      <button class="btn btn--primary" data-bar-fetch hidden>${T.barFetch}</button>
      <span class="muted" data-bar-fetch-status></span>
    </p>
    <p><a href="/register/">${T.barBackToRegister}</a></p>
  `;

  const badge = $("[data-bar-status]");
  const hint = $("[data-bar-hint]");
  const fetchBtn = $("[data-bar-fetch]");
  const fetchStatus = $("[data-bar-fetch-status]");

  /** Un seul écrivain de l'état, comme sur la page d'accueil (#64). */
  async function render() {
    const current = await credentialsByRef(bar.internalId);
    if (current.DoreBarOriginCredential) {
      badge.textContent = T.barStatusHere;
      badge.className = "badge badge--verified";
      hint.hidden = true;
      fetchBtn.hidden = true;
      return;
    }
    // Le magasin l'a-t-il ? On ne le demande que pour CETTE barre : l'index
    // complet n'a pas sa place sur une page qui en montre une.
    const res = await fetch(`/api/v1/credentials/${encodeURIComponent(bar.subjectId)}`)
      .catch(() => null);
    const elsewhere = res?.ok === true;

    badge.textContent = elsewhere ? T.barStatusElsewhere : T.barStatusNone;
    badge.className = `badge badge--${elsewhere ? "warning" : "pending"}`;
    hint.hidden = !elsewhere;
    fetchBtn.hidden = !elsewhere;
  }

  fetchBtn?.addEventListener("click", async () => {
    fetchBtn.disabled = true;
    fetchStatus.textContent = T.barFetching;
    try {
      const res = await fetch(`/api/v1/credentials/${encodeURIComponent(bar.subjectId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { credentials } = await res.json();

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
