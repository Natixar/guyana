/**
 * Le menu, déduit des droits que le service déclare.
 *
 * CE MENU NE PROTÈGE RIEN, et il ne prétend pas le faire. Une page en
 * JavaScript se lit, un lien se devine, et `curl` ne consulte pas les menus.
 * Le refus vit dans le magasin — `ROLES` dans `services/store/app.py` — et ces
 * cas sont couverts par des tests qui interrogent le service, pas l'écran.
 *
 * Ce que le menu fait, c'est ne pas proposer ce qui serait refusé. C'est une
 * question d'égards, pas de sécurité : un vérificateur indépendant qui clique
 * sur « Production » et reçoit un 403 apprend qu'il existe une page qu'on lui
 * cache, ce qui est exactement ce qu'on voulait éviter en la lui cachant.
 *
 * La liste des droits vient de `/api/v1/me`, une seule source. Recopier ici la
 * table des rôles ferait deux vérités qui divergeraient au premier changement.
 */
import T from "./labels.js";

/**
 * Les destinations, et le droit que chacune suppose.
 *
 * `null` signifie « sans condition » : la page de vérification n'appelle aucune
 * de nos API — clé publique depuis le domaine de l'émetteur, signature,
 * recalcul — donc rien ne justifierait de la restreindre.
 */
const DESTINATIONS = [
  { href: "/", label: () => T.navHome, grant: "credentials" },
  { href: "/register/", label: () => T.navProduction, grant: "credentials" },
  { href: "/quality/", label: () => T.navQuality, grant: "counts" },
  { href: "/selftest/", label: () => T.navSelftest, grant: "credentials" },
  { href: "/verify/", label: () => T.navVerify, grant: null },
];

/**
 * La page se déclare-t-elle publique ?
 *
 * ─── POURQUOI CETTE QUESTION SE POSE ICI ────────────────────────────────
 *
 * `/api/v1/me` est authentifiée, donc elle répond 401 sans identifiants, donc
 * le navigateur ouvre sa fenêtre de mot de passe POUR LA REQUÊTE — sur une page
 * qui, elle, répond 200. Un vérificateur se voyait demander un mot de passe sur
 * la page qui démontre qu'il n'en faut pas.
 *
 * LA PREMIÈRE RÉPARATION S'EST TROMPÉE DE CÔTÉ : elle a ouvert la route. Mais
 * l'identité de `/api/v1/me` NE VIENT PAS DU CORPS DE LA REQUÊTE, elle vient de
 * l'en-tête `X-Webauth-User` que pose le middleware d'authentification. Retirer
 * le middleware n'a pas rendu la route permissive : il l'a rendue AVEUGLE. Elle
 * répondait « authenticated: false » à tout le monde, y compris à Randy connecté
 * — d'où la pastille « Not signed in » sur `/register/`, et, plus grave, la
 * disparition de l'organisation émettrice : `me.js` en tire le DID signataire,
 * donc plus aucune barre ne pouvait être certifiée.
 *
 * LA BONNE RÉPARATION EST DE NE PAS APPELER. Une page publique n'a pas d'identité
 * à afficher ; elle n'a donc aucune raison d'interroger une route qui en rend
 * une. Le marqueur vient du gabarit — `public: true` dans le front matter — et
 * non d'une liste de chemins recopiée ici, qui divergerait au premier ajout.
 */
const isPublicPage = () => document.body?.hasAttribute("data-public-page") ?? false;

export async function renderNav() {
  const slot = document.querySelector("[data-nav]");
  if (!slot) return;

  const publicPage = isPublicPage();

  let me = null;
  if (!publicPage) {
    try {
      const r = await fetch("/api/v1/me", {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) me = await r.json();
    } catch { /* hors ligne : on retombe sur le minimum */ }
  }

  const grants = new Set(me?.grants ?? []);
  const here = location.pathname.replace(/\/+$/, "") || "/";

  const links = DESTINATIONS
    .filter((d) => d.grant === null || grants.has(d.grant))
    .map((d) => {
      const path = d.href.replace(/\/+$/, "") || "/";
      const current = path === here ? ' aria-current="page"' : "";
      return `<a href="${d.href}"${current}>${d.label()}</a>`;
    });

  slot.innerHTML = links.join("");

  renderIdentity(me, document, publicPage);
}

/**
 * QUI EST CONNECTÉ — dans le bandeau, sur toutes les pages, en permanence.
 *
 * LE DÉFAUT. L'information existait : `/api/v1/me` la donne, le menu l'appelle
 * déjà, et le gabarit portait un emplacement. Mais elle s'affichait en un mot
 * gris, à 70 % d'opacité, au bout d'un bandeau en dégradé — invisible en
 * pratique. En revenant sur une page on ne pouvait pas dire si l'on était
 * anonyme, sous le compte de la mine, ou sous celui de la plateforme.
 *
 * Les conséquences n'étaient pas cosmétiques : les trois états ne permettent
 * pas les mêmes actions, et un refus légitime — « ce compte n'appartient à
 * aucune organisation émettrice » — se lit comme une panne quand rien à
 * l'écran ne rappelle sous quel compte on se trouve.
 *
 * L'ORGANISATION EST AFFICHÉE, ET PAS SEULEMENT LA PERSONNE. C'est elle qui
 * gouverne : signer l'origine d'un lingot suppose d'appartenir à la mine. Un
 * nom d'utilisateur seul ne dit pas si l'on peut agir ; le couple le dit.
 *
 * QUATRE ÉTATS, ET LE QUATRIÈME N'EST PAS UNE NUANCE DU TROISIÈME. « Aucun
 * compte utilisé » est une propriété de la PAGE ; « pas connecté » est une
 * propriété du VISITEUR. Sur `/verify/` la première est vraie même pour Randy,
 * dont le navigateur détient des identifiants valides : la page ne s'en sert
 * pas, et c'est précisément ce qu'elle démontre. Les confondre ferait afficher
 * « Not signed in » à quelqu'un qui l'est — le défaut que ce bandeau existe pour
 * empêcher, reproduit à l'endroit où il se remarque le moins.
 */
export function renderIdentity(me, root = document, publicPage = false) {
  const who = root.querySelector("[data-nav-user]");
  if (!who) return null;

  const person = me?.person?.name ?? me?.person?.id ?? null;
  const org = me?.organisation?.name ?? null;

  const [state, text] =
    publicPage         ? ["public", T.navNoAccountUsed]
    : !me?.authenticated ? ["anonymous", T.navNotSignedIn]
    : org              ? ["issuer", `${T.signedInAs} ${person} · ${org}`]
    // Authentifié mais sans organisation émettrice : l'exploitant de la
    // plateforme, un vérificateur muni d'un compte. Ce n'est pas une anomalie,
    // et le dire ici évite de le découvrir en cliquant sur un bouton inerte.
    :                    ["no-org", `${T.signedInAs} ${person} · ${T.navNoOrganisation}`];

  who.textContent = text;
  who.dataset.state = state;
  who.hidden = false;
  return state;
}

document.addEventListener("DOMContentLoaded", renderNav);
