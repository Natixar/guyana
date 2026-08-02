/**
 * Lire une attestation qu'on a reçue — la vue du PORTEUR, pas celle du vérificateur.
 *
 * POURQUOI CET ÉCRAN EXISTE. L'intensité carbone d'une barre est calculée par
 * Natixar et signée sous la clé de Natixar : la mine la subit sans l'avoir
 * faite. Que la justification des données soit automatique ne change rien à
 * cela — un chiffre qui engage un client doit pouvoir être regardé par ce
 * client, et pas seulement par l'acheteur à qui il le remettra.
 *
 * CE N'EST PAS LA PAGE DE VÉRIFICATION, et les deux ne doivent pas fusionner.
 * `/verify/` s'adresse à quelqu'un qui ne nous fait pas confiance : elle est
 * publique, elle ne nous appelle pas, et elle refait le calcul. Cet écran-ci
 * s'adresse à quelqu'un qui est déjà authentifié chez nous et qui regarde SES
 * propres documents. Les mêmes octets, deux lectures, deux positions.
 *
 * CE QUE LE MAGASIN DÉTIENT, ET CE QU'IL NE DÉTIENT PAS. Une attestation
 * carbone déposée porte les ENGAGEMENTS de sa matrice, jamais les montants :
 * ceux-ci voyagent à côté, en divulgations, et c'est ce qui permet d'en retirer
 * une sans casser la signature. Cet écran affiche donc ce que le document dit
 * réellement — combien de cellules, lesquelles ont compté, et pourquoi les
 * autres non — et il le dit au lieu de laisser croire à un affichage tronqué.
 *
 * Tout ce qui vient du document est échappé. Le document arrive du réseau ;
 * qu'il soit signé prouve son origine, pas son innocuité.
 *
 * @see site/assets/js/verify-page.js — l'autre lecture, celle du vérificateur
 * @see site/assets/js/commitments.js — d'où vient le recalcul quand on a les divulgations
 */
import T from "./labels.js";
import { esc } from "./escape.js";
import { groupCells, summarise } from "./matrix-blocks.js";
import { subPostLabel, caracterisationLabel, partTypeLabel } from "./pivot-labels.js";

/** Le type W3C significatif : celui qui n'est pas « VerifiableCredential ». */
export function meaningfulType(doc) {
  const types = Array.isArray(doc?.type) ? doc.type : [doc?.type];
  return types.find((t) => t && t !== "VerifiableCredential") ?? "VerifiableCredential";
}

/** Aucune table : on rend les nombres, et la page fonctionne quand même. */
const emptyLabels = { version: null, subPosts: new Map(), postes: new Map(),
                      caracterisations: new Map(), partTypes: new Map(), modes: new Map() };

const row = (label, value) =>
  `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

/** Un intervalle lisible, ou un tiret. Les bornes sont des instants ISO. */
const period = (p) =>
  p?.start ? `${esc(String(p.start).slice(0, 10))} → ${esc(String(p.end ?? "").slice(0, 10))}` : "—";

/**
 * La matrice, telle qu'elle est DANS le document.
 *
 * Une cellule retenue et une cellule écartée se ressemblent ici, et c'est le
 * sujet : la seconde est présente, dénombrable, avec son motif. Un tableau d'où
 * les exclusions auraient disparu ressemblerait trait pour trait à un tableau
 * complet, ce qui est exactement ce que la décision 1 de l'issue #61 refuse.
 */
const num = (x, digits = 3) => (typeof x === "number"
  ? x.toLocaleString("fr-FR", { maximumSignificantDigits: digits }) : "—");

/** Un intervalle de blocs : « 2024-12 → 2025-02 », ou un seul mois. */
function span(from, to) {
  const a = String(from ?? "").slice(0, 7);
  const b = String(to ?? "").slice(0, 7);
  if (!a) return "—";
  return a === b || !b ? esc(a) : `${esc(a)} → ${esc(b)}`;
}

/**
 * Les unités de production couvertes par un bloc.
 *
 * Elles ne sont pas dans la maille — cela donnerait un bloc par cellule — mais
 * elles restent nommées : l'étendue du plus petit au plus grand mesure
 * justement leur dispersion, et savoir combien elles sont donne au lecteur de
 * quoi la juger. Au-delà de six, on compte plutôt que d'énumérer : une liste de
 * vingt-huit entiers n'apprend rien.
 */
function units(b) {
  const list = [...(b.steps ?? [])].sort((x, y) => x - y);
  if (list.length === 0) return esc(T.certStep) + " —";
  if (list.length > 6) return `${list.length} ${esc(T.certUnits)}`;
  return `${esc(T.certStep)} ${list.map((x) => esc(String(x))).join(", ")}`;
}

/**
 * Un bloc, rendu en carte.
 *
 * Le sous-poste vient EN TÊTE et en toutes lettres. C'est ce que le lecteur
 * cherche, et « 1002 » ne le lui donnait pas : un identifiant de référentiel
 * n'est une information que pour qui détient la table.
 */
function block(b, labels) {
  const context = [
    partTypeLabel(labels, b.partType),
    caracterisationLabel(labels, b.caracterisation),
  ].filter((x) => x && x !== "—").join(" · ");

  const figures = [
    [T.certBlockTotal, `${num(b.total)} kgCO2e`],
    [T.certBlockCells, String(b.cells)],
    [T.certBlockUnits, String((b.steps ?? new Set()).size)],
    // MIN ET MAX NE SONT PAS DE L'ORNEMENT : un total seul ne distingue pas
    // douze mois réguliers d'un mois qui porte tout, et l'écart est la première
    // chose qu'un auditeur regarde.
    [T.certBlockRange, b.cells > 1 ? `${num(b.min)} … ${num(b.max)}` : "—"],
    [T.certBlockShare, b.share === null ? "—" : num(b.share, 4)],
    [T.certBlockBorne, b.used ? `${num(b.borneTotal)} kgCO2e` : "0"],
  ];

  return `<article class="block${b.used ? "" : " block--withheld"}">
    <h5>${esc(subPostLabel(labels, b.subPost))}</h5>
    <p class="muted">${units(b)}${
      context ? ` · ${esc(context)}` : ""} · ${span(b.from, b.to)}${
      b.origin ? ` · ${esc(String(b.origin).toLowerCase())}` : ""}</p>
    <p><span class="badge badge--${b.used ? (b.reason ? "info" : "verified") : "warning"}">${
      esc(b.used ? (b.reason ? T.certShared : T.certCounted) : T.certExcluded)}</span>${
      // LE MOTIF S'AFFICHE DÈS QU'IL EXISTE, et non seulement sur les écartées.
      // Un bloc partagé compte, comme un bloc alloué, mais pas dans la même
      // proportion : sans son motif, deux cartes de même position se
      // ressemblaient trait pour trait alors que l'une revient au lot de la
      // barre et l'autre se divise entre tous les lots de la fenêtre.
      b.reason ? ` <span class="muted">${esc(b.reason)}</span>` : ""}</p>
    <dl class="facts facts--tight">${
      figures.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>
  </article>`;
}

/**
 * La matrice, regroupée en blocs.
 *
 * SANS LES DIVULGATIONS, IL N'Y A QUE LE DÉNOMBREMENT — et c'est la propriété,
 * pas une panne. Une entrée signée ne porte qu'un engagement, le fait qu'elle
 * ait compté, et son motif : la catégorie elle-même est dans l'engagement,
 * parce que « il y a une ligne de minage » est déjà une information sur
 * l'exploitation. Le porteur, lui, détient les divulgations — c'est son propre
 * calcul qu'il regarde — et voit donc les blocs.
 */
/**
 * Les blocs, rendus.
 *
 * EXPORTÉ POUR QUE LE VÉRIFICATEUR VOIE LA MÊME CHOSE QUE LE PORTEUR. Deux
 * décompositions rendues par deux codes finiraient par différer, et c'est
 * précisément le genre d'écart qui ruine une démonstration : la mine montrerait
 * un tableau, l'acheteur un autre, sur le même document signé.
 */
export function renderBlocks(cells, labels = emptyLabels) {
  const blocks = groupCells(cells);
  const total = summarise(blocks);
  return `<p class="muted">${T.certBlocksBody
      .replace("{blocks}", String(total.blocks))
      .replace("{borne}", num(total.borne))}</p>` +
    `<div class="blocks">${blocks.map((b) => block(b, labels)).join("")}</div>`;
}

function matrix(doc, disclosures = [], labels = emptyLabels) {
  const cells = doc?.credentialSubject?.breakdown;
  if (!Array.isArray(cells) || cells.length === 0) return "";

  const byIndex = new Map((disclosures ?? []).map((d) => [d.index, d]));
  const used = cells.filter((c) => c.used !== false).length;
  const header = `<h4 class="subhead">${T.certMatrix}</h4>
    <p class="muted">${T.certCellCount
      .replace("{n}", String(cells.length))
      .replace("{used}", String(used))
      .replace("{out}", String(cells.length - used))}</p>`;

  if (byIndex.size === 0) return header + `<p class="muted">${T.certAmountsElsewhere}</p>`;

  // La disposition vient de l'entrée SIGNÉE, jamais de la divulgation : c'est
  // elle qui fait foi sur ce qui a compté, et la divulgation ne la porte pas.
  const merged = cells.map((c, index) => {
    const d = byIndex.get(index);
    return d && { ...d, index, used: c.used !== false, reason: c.reason ?? "" };
  }).filter(Boolean);

  return header + renderBlocks(merged, labels) +
    `<p class="muted">${T.certAmountsLocal}</p>`;
}

/** La méthode : ce sans quoi le chiffre est invérifiable cinq ans plus tard. */
function method(doc) {
  const m = doc?.credentialSubject?.method;
  if (!m || typeof m !== "object") return "";
  const known = [
    [T.certAllocation, m.allocation],
    [T.certLotRule, m.lotRule],
    // LES DEUX DIVISEURS SE LISENT, sans quoi la règle n'est qu'un nom. Le
    // porteur doit pouvoir constater que le partagé a été divisé par le nombre
    // de lots actifs sur la fenêtre — c'est la partie du calcul qui, sans cet
    // affichage, exigerait de nous croire sur parole.
    [T.certDivisors, m.divisors
      ? `${m.divisors.lotsInWindow} × ${m.divisors.barsInLot}`
      : undefined],
    [T.certTaxonomy, m.taxonomy],
    [T.certFactors, m.factorSet ?? m.factors],
    [T.certEventModel, m.eventModel],
  ].filter(([, v]) => v !== undefined && v !== null);
  if (known.length === 0) return "";
  return `<h4 class="subhead">${T.certMethod}</h4>
          <dl class="facts">${known.map(([k, v]) => row(k, esc(String(v)))).join("")}</dl>`;
}

/**
 * Une attestation, rendue pour son porteur.
 *
 * @param {object} record  ce que sert `/api/v1/credentials/{subject}` :
 *                         `{digest, type, receivedAt, document}`
 * @returns {string} du HTML, entièrement échappé
 */
export function renderCertificate(record, disclosures = [], labels = emptyLabels) {
  const doc = record?.document ?? record;
  const intensity = doc?.credentialSubject?.carbonIntensity;

  const facts = [
    row(T.certIssuer, esc(String(doc?.issuer ?? "—"))),
    row(T.certReceived, esc(String(record?.receivedAt ?? "—"))),
  ];
  if (intensity?.value !== undefined) {
    facts.push(row(T.certIntensity,
      `${esc(String(intensity.value))} ${esc(String(intensity.unit ?? ""))}`));
  }
  // Le lien vers l'attestation d'origine, par empreinte. Sans lui, n'importe qui
  // pourrait émettre un chiffre carbone pour le même sujet.
  //
  // AU PREMIER NIVEAU, ET NON DANS LE SUJET : c'est là que
  // `buildCarbonCredential` l'écrit, et le chercher au mauvais endroit revenait
  // à ne jamais l'afficher — sans erreur, ce qui est la pire façon de perdre une
  // ligne. Les deux emplacements sont lus, le document faisant foi.
  const from = doc?.derivedFrom ?? doc?.credentialSubject?.derivedFrom;
  if (from?.digestMultibase) {
    facts.push(row(T.certDerivedFrom, `<code>${esc(String(from.digestMultibase))}</code>`));
  }

  return `
    <article class="card">
      <h3>${esc(meaningfulType(doc))}</h3>
      <dl class="facts">${facts.join("")}</dl>
      ${method(doc)}
      ${matrix(doc, disclosures, labels)}
    </article>`;
}

/**
 * Toutes les attestations d'une barre, la plus parlante d'abord.
 *
 * @param {Array<object>} records
 * @param {Record<string, Array>} [disclosuresByDigest] les divulgations que ce
 *        navigateur détient, indexées par l'empreinte de l'attestation. Elles ne
 *        viennent jamais du serveur : elles ne quittent pas le porteur.
 */
export function renderCertificates(records, disclosuresByDigest = {}, labels = emptyLabels) {
  if (!Array.isArray(records) || records.length === 0) return "";
  // Celle qui porte une matrice passe devant : c'est celle que la mine n'a pas
  // faite, et donc celle qu'elle a une raison de regarder.
  const ordered = [...records].sort(
    (a, b) => Number(Boolean(b?.document?.credentialSubject?.breakdown))
            - Number(Boolean(a?.document?.credentialSubject?.breakdown)));
  return ordered.map((r) =>
    renderCertificate(r, disclosuresByDigest[r?.digest] ?? r?.disclosures ?? [], labels)).join("");
}
