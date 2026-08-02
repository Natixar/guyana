/**
 * La vue de l'exploitant : des nombres, jamais un lingot.
 *
 * C'est ce que Natixar voit de la plateforme — combien d'objets, de quelle
 * origine — et c'est délibérément presque tout. Aucun identifiant de barre,
 * aucun nom de département : de quoi surveiller un service sans lire les
 * affaires d'un client. L'énoncé de confidentialité de la page publique se tient
 * ou tombe ici.
 *
 * CE QUE LE TOTAL NE PEUT PAS DIRE. Une moyenne de plateforme ne bouge pas quand
 * un client sur vingt se dégrade — elle noie le signal d'autant mieux qu'il y a
 * plus de clients, et on n'intervient pas auprès d'une moyenne. D'où la
 * répartition par organisation de tête, qui est l'instrument ; les totaux
 * au-dessus n'en sont que le résumé.
 *
 * Elle nomme donc les clients, et rien d'autre : le service ne la sert qu'aux
 * porteurs du droit `tenants`, qu'un client n'a pas. Quand elle est absente,
 * c'est que le compte n'y a pas droit, et la page le dit plutôt que d'afficher
 * un tableau vide.
 *
 * DEUX AXES DANS UN SEUL TABLEAU, ET IL FAUT LE MONTRER. Les quatre origines se
 * partagent 100 % d'une ligne ; INCOMPLETE et MISSING sont un autre axe — une
 * cellule mesurée peut combler un trou de calendrier. Additionner les sept
 * colonnes n'a aucun sens, donc l'en-tête les sépare.
 *
 * Le refus vient du service, pas de cet écran : un compte sans le droit reçoit
 * un 403 même en tapant l'adresse. La page se contente de le dire lisiblement.
 */
import T from "./labels.js";
import { esc } from "./escape.js";

const $ = (s) => document.querySelector(s);

const card = (label, value) =>
  `<div><dt>${label}</dt><dd>${value}</dd></div>`;

/**
 * Un pourcentage de ligne, ou un tiret.
 *
 * Zéro s'écrit « 0,0 % » et non « — » : un zéro est un résultat, l'absence de
 * dénominateur n'en est pas un. Les confondre ferait passer un client sans
 * aucune donnée pour un client irréprochable.
 */
const share = (n, total) =>
  total ? `${((100 * n) / total).toFixed(1)} %` : "—";

/** Une part digne d'être remarquée : le rouge n'est pas décoratif. */
const alarming = (n, total) => total > 0 && n / total >= 0.1;

function organisationRow(r) {
  const cells = [
    ["measured", false], ["derived", false], ["estimated", false],
    ["notMeasured", true], ["incomplete", true], ["missing", true],
  ].map(([key, watch]) => {
    const value = r[key] ?? 0;
    const flag = watch && alarming(value, r.cells);
    return `<td class="num${flag ? " num--warning" : ""}">${share(value, r.cells)}</td>`;
  }).join("");

  return `<tr><td>${esc(r.organisation)}</td>${cells}<td class="num">${r.cells.toLocaleString("fr-FR")}</td></tr>`;
}

function breakdown(byOrganisation) {
  if (!Array.isArray(byOrganisation) || byOrganisation.length === 0) {
    return `<h3 class="subhead">${T.qualityByOrganisation}</h3>
            <p class="muted">${T.qualityNoTenants}</p>`;
  }
  return `
    <h3 class="subhead">${T.qualityByOrganisation}</h3>
    <p class="muted">${T.qualityByOrganisationWhy}</p>
    <table class="register">
      <thead>
        <tr>
          <th rowspan="2">${T.qualityOrganisation}</th>
          <th colspan="4" class="num">${T.qualityAxisOrigin}</th>
          <th colspan="2" class="num">${T.qualityAxisCoverage}</th>
          <th rowspan="2" class="num">${T.qualityCells}</th>
        </tr>
        <tr>
          <th class="num">MEASURED</th><th class="num">DERIVED</th>
          <th class="num">ESTIMATED</th><th class="num">NOT MEASURED</th>
          <th class="num">INCOMPLETE</th><th class="num">MISSING</th>
        </tr>
      </thead>
      <tbody>${byOrganisation.map(organisationRow).join("")}</tbody>
    </table>
    <p class="muted">${T.qualityAxesNote}</p>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const target = $("[data-quality]");
  if (!target) return;

  let res;
  try {
    res = await fetch("/api/v1/counts", { headers: { accept: "application/json" } });
  } catch (err) {
    target.innerHTML = `<p class="badge badge--warning">${esc(err.message)}</p>`;
    return;
  }

  if (res.status === 403) {
    target.innerHTML = `<p class="badge badge--warning">${T.qualityDenied}</p>`;
    return;
  }
  // Le site répond 200 avec sa page d'accueil pour tout chemin inconnu : sans
  // ce contrôle, une erreur de routage passerait pour une plateforme vide.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
    target.innerHTML = `<p class="badge badge--warning">${T.registerEmpty}</p>`;
    return;
  }

  const { totals, byOrigin, byOrganisation } = await res.json();
  const total = byOrigin.reduce((a, r) => a + r.n, 0) || 1;

  target.innerHTML = `
    <dl class="facts">
      ${card(T.qualityCells, totals.cells.toLocaleString("fr-FR"))}
      ${card(T.qualityEntities, totals.entities.toLocaleString("fr-FR"))}
      ${card(T.qualityCredentials, totals.credentials.toLocaleString("fr-FR"))}
    </dl>

    <h3 class="subhead">${T.qualityByOrigin}</h3>
    <table class="register">
      <thead><tr><th>Origin</th><th class="num">Records</th><th class="num">Share</th></tr></thead>
      <tbody>${byOrigin.map((r) => `<tr>
        <td>${esc(r.origin)}</td>
        <td class="num">${r.n.toLocaleString("fr-FR")}</td>
        <td class="num">${((100 * r.n) / total).toFixed(1)} %</td>
      </tr>`).join("")}</tbody>
    </table>

    ${breakdown(byOrganisation)}
  `;
});
