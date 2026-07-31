# FIDES Community Awards — Aurora peut-il concourir, et à quel prix ?

*Note d'analyse, 29 juillet 2026. Document local, non versionné. Décision demandée : concourir ou non, et dans quelle catégorie.*

Sources : [fides.community](https://fides.community/) · [Ecosystem Explorer — use cases](https://fides.community/ecosystem-explorer/use-cases/) · [Community Awards 2026](https://fides.community/awards/fides-community-awards/) · [À propos](https://fides.community/about-fides/)

---

## 1. Ce qu'est FIDES

Plateforme ouverte opérée par **FIDES Labs BV**, société néerlandaise indépendante basée à Utrecht. Elle publie un annuaire — l'*Ecosystem Explorer* — de cas d'usage réels de **portefeuilles numériques et d'attestations vérifiables** (*verifiable credentials*), pour que les organisations « apprennent de schémas éprouvés, comparent les approches et réutilisent ce qui marche ».

Participation gratuite au niveau Community : on peut explorer et contribuer sans payer. Les offres Pro et Business ouvrent des référencements officiels et l'accès API. **Aucun frais n'est requis pour concourir.**

## 2. Les dates, qui commandent tout le reste

| Date | Événement | Jours restants |
|---|---|---|
| **20 août 2026** | **date limite** — « Any use case or business wallet that is published in the global FIDES Ecosystem Explorer by August 20th is eligible » | **22** |
| 21 août | annonce des finalistes | |
| 22 août | ouverture du vote communautaire | |
| **15 septembre 2026** | remise des prix, **événement à Utrecht** | 48 |

Deux collisions à voir tout de suite :

- **Jean-Marc part le 5 août.** La publication doit donc être soit faite avant son départ, soit déléguée explicitement — c'est une publication publique au nom de Natixar, pas une tâche interne.
- **L'événement du 15 septembre tombe dans la fenêtre de démonstration du PoC.** Ce n'est pas un conflit, c'est une opportunité : une démonstration à Utrecht devant l'écosystème européen des portefeuilles a une valeur commerciale propre, indépendamment du prix.

## 3. Quelle catégorie

| Catégorie | Critères annoncés | Aurora |
|---|---|---|
| Best Business Wallet 2026 | adoption réelle, fonctionnalités du portefeuille, expérience utilisateur, modèle économique | **hors sujet** — nous ne construisons pas de portefeuille |
| Impact Award 2026 | adoption, valeur économique, bénéfice sociétal, vie privée, passage à l'échelle, conformité réglementaire | **perdu d'avance**, voir §4 |
| **Innovation Award 2026** | **originalité de l'approche, application inédite de la technologie, innovation d'écosystème, potentiel de nouveaux cas d'usage, modèles économiques et de gouvernance innovants** | **la seule où nous pouvons gagner** |

## 4. L'état de la concurrence, sans complaisance

Les 24 cas d'usage publiés comprennent Samsung SDS, **Swiggy (120 M d'utilisateurs)**, Urban Company (8,4 M), Arattai (8 M), la digitalisation néerlandaise du certificat de bonne conduite (1,8 M de délivrances par an), le passeport de batteries des bus électriques BVG avec Spherity, le passeport produit numérique CIRPASS/Danube dans le textile.

Face à cela, Aurora est un PoC sans utilisateur.

- **Sur l'adoption**, nous ne pesons rien. L'Impact Award est hors d'atteinte, et postuler dans cette catégorie affaiblirait le dossier.
- **Le vote communautaire compte pour 50 %**, et il favorise mécaniquement les organisations à large base d'utilisateurs. C'est un handicap structurel que la mobilisation des réseaux Natixar, Calcool et AGM ne compensera qu'en partie.
- **Sur l'originalité, en revanche, personne dans ce catalogue ne fait ce que nous faisons.** Aucune traçabilité minerai-vers-raffinerie, aucune attestation d'origine adossée à une intensité carbone calculée, aucune matière première. Les cas les plus proches — Transpareo (vérification de revendications produit) et les passeports produits — restent en aval de la chaîne. Une attestation de provenance et d'empreinte carbone pour un lingot de doré guyanais est un objet neuf dans cette liste.

**Conclusion : Innovation Award, et rien d'autre.** Un dossier ciblé y est crédible ; un dossier dispersé sur trois catégories est perdu partout.

## 5. La bonne nouvelle : le recouvrement est réel

Ce n'est pas un projet parallèle qu'il faudrait inventer. **Le contenu éligible à FIDES est UC-06, que le contrat exige déjà.**

Feuillet 1 du paquet de données AGM :

> **UC-06 — Gold origin and carbon credential.** *Attach origin and cradle-to-gate carbon intensity to doré produced during the pilot window. Potential: verifiable carbon-per-ounce statement for buyers.* **SELECTED – light.** *Satisfies the Annex 2 traceability KPI (≥70%) using data already produced; low effort.*

Le KPI 3 de l'annexe 2 passe par là. FIDES ne demande donc pas de construire autre chose — il demande d'**exprimer autrement** ce qui est déjà au périmètre.

Et la décision prise il y a deux jours rend le pivot bon marché. J'avais recommandé de ne pas construire de VC W3C pour le PoC, mais de faire trois choses gratuites : enregistrer un identifiant d'émetteur stable, rendre la revendication canoniquement sérialisable avec son nonce, et décider explicitement de ce qui est affirmé. Les trois sont acquises ou triviales :

- **l'identifiant existe déjà** — AGM a fourni son LEI `5493009W3C3T4JAL0K51` et `did:web:guygold.com` ;
- **la sérialisation canonique** est de toute façon le prérequis conservé du dossier d'ancrage ;
- **ce qui est affirmé** est exactement le tCO2e/once de l'issue #52.

L'enveloppe VC, que j'estimais à un ou deux jours « plus tard », se fait maintenant. C'est un cas où le choix conservateur a préservé l'option au lieu de la fermer.

## 6. Le delta, borné

Trois choses, et pas une de plus :

| # | Travail | Effort | Nouveau ? |
|---|---|---|---|
| 1 | Émettre l'attestation UC-06 comme **Verifiable Credential W3C**, signée depuis `did:web:guygold.com`, plutôt que comme JSON signé | 1–2 j | enveloppe seulement |
| 2 | **Page de vérification publique** : on dépose l'attestation, elle est vérifiée contre la clé de l'émetteur, sans appeler notre API ni nous faire confiance | 1–2 j | oui |
| 3 | **Rédiger et publier la fiche** dans l'Ecosystem Explorer | rédaction | Svetlana |

Ce qui reste explicitement **hors périmètre** : construire un portefeuille, ancrer sur une chaîne, intégrer EUDI ou EBSI. Aucun n'est nécessaire pour concourir, et chacun coûterait plus que le prix ne vaut.

Bénéfice secondaire, réel : le catalogue FIDES contient déjà CIRPASS et des passeports produits numériques. Y publier positionne Natixar dans l'écosystème européen du passeport produit — c'est l'argument d'interopérabilité future que j'avançais pour les VC, qui reçoit ici une date et un lieu.

## 7. Les deux vrais risques

**1. G-01 devient bloquant pour deux choses au lieu d'une.** L'attestation porte sur des coulées réelles : date, identifiant de lingot, poids, titre. Ces données attendent l'accord du Gold Room, du juridique et de la sécurité d'AGM. Sans elles, il n'y a rien à attester — ni pour le KPI 3, ni pour FIDES. **C'est la relance la plus urgente du dossier**, et elle l'était déjà avant FIDES.

**2. Le coût d'opportunité, à borner par une règle explicite.** Les onze issues P0 servent toutes des KPI contractuels. Le contrat est signé et engage 7 000 EUR ; FIDES est un gain espéré. La règle appliquée à la blockchain vaut ici :

> Si le contrat et FIDES se disputent le même temps, **le contrat gagne**. Les trois éléments du §6 sont admis parce qu'ils sont petits et qu'ils recouvrent le KPI 3 — pas parce que le prix les justifie.

## 8. Recommandation

**Concourir, dans la catégorie Innovation, avec le delta borné du §6.** Le coût est de trois à quatre jours d'ingénierie sur du travail majoritairement déjà au périmètre, la date limite du 20 août est tenable, et l'événement du 15 septembre a une valeur commerciale propre même sans prix.

Trois conditions :

1. **Relancer G-01 aujourd'hui.** Sans registre de coulée, pas d'attestation, donc pas de dossier — et pas de KPI 3 non plus.
2. **Régler la publication avant le 5 août.** Soit Jean-Marc valide le texte de la fiche avant de partir, soit il délègue explicitement à Svetlana. Publier au nom de Natixar sur une plateforme publique n'est pas une action que je prendrai seul.
3. **Aucune issue P0 ne glisse.** Si le delta menace le tableau de bord (#50), l'analyse des points chauds (#49) ou la réconciliation (#48), on abandonne FIDES sans état d'âme.

## 9. Décision demandée

- [ ] Concourir, catégorie Innovation ? *(oui / non)*
- [ ] Qui publie la fiche, et selon quel texte validé ?
- [ ] Ouvre-t-on les deux issues du §6 (attestation VC, page de vérification), et en P1 ?
