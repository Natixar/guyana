# Spécification technique — projet Aurora

*Version 1, 29 juillet 2026. Document local, non versionné. Remplace, pour ce qui nous concerne, la spécification fonctionnelle `NATIXAR_Traceability_Specification_Fonctionnelle_Developpeur.odt`.*

**Ce que ce document est.** La description de ce que nous construisons, dans quel ordre, et pourquoi. Il ne décrit pas un produit de traçabilité générique — il décrit trois états successifs d'un même système, chacun livrable et utile.

**Ce qui gouverne.** L'annexe 2 du contrat EU-LAC en premier, le concours FIDES en second, la vision produit en troisième. En cas de conflit sur le temps disponible, cet ordre départage.

---

## 1. Le principe des trois horizons

| | Horizon | Échéance | Sort |
|---|---|---|---|
| **H1** | **FIDES** | 20 août 2026 | attestation vérifiable + page de vérification publique |
| **H2** | **Guyana** | novembre 2026 | modèle carbone, réconciliation, tableau de bord, KPI |
| **H3** | **Outil complet** | au-delà | séries temporelles performantes, multi-clients, ancrage, divulgation sélective cryptographique |

### 1.1 La règle qui rend l'expansion planifiée possible

> **Aucun horizon ne réécrit le précédent. Chacun ajoute.**

Ce n'est pas un vœu de propreté : c'est le seul moyen de tenir trois échéances rapprochées sans payer deux fois. La conséquence pratique est contre-intuitive — **il y a des endroits où H1 ne doit surtout pas prendre le raccourci qui l'accélérerait.**

Trois, précisément :

| Raccourci tentant en H1 | Ce qu'il coûterait plus tard |
|---|---|
| stocker dans des fichiers ou SQLite | migration = réécriture de la couche d'accès. **H1 utilise PostgreSQL**, avec trois tables s'il le faut |
| clé de signature dans le dépôt ou en dur | une rotation ultérieure oblige à **réémettre toutes les attestations déjà signées**. H1 passe par l'adaptateur de secrets |
| sérialisation ad hoc de ce qui est signé | tout changement d'ordre de champs **invalide les signatures passées**. La sérialisation canonique et le nonce par enregistrement existent dès H1 |

Deux règles d'exécution valent également dès H1, et découlent du dossier de déploiement :

- **Aucun bind mount de contenu.** Images pour le contenu, volumes nommés pour l'état, configuration par redirection de stdin. Un répertoire déposé sur l'hôte ne s'atteste pas et ne se déploie pas par digest.
- **Déploiement par digest**, jamais par étiquette mobile.

### 1.2 Ce que chaque horizon n'a délibérément pas

Écrire l'absence est aussi utile qu'écrire la présence, parce que c'est ce qui empêche l'élargissement involontaire.

- **H1 n'a pas** : de portefeuille numérique, d'ancrage sur chaîne, d'intégration EUDI ou EBSI, de divulgation sélective cryptographique, d'authentification, de tableau de bord.
- **H2 n'a pas** : d'ingestion temps réel, de séries temporelles partitionnées, de multi-clients à l'échelle, de codes douaniers, de couche 1 d'autorisation au proxy.
- **H3 n'a pas** de limite prédéfinie — c'est là que le reste des 45 issues d'audit trouve sa place.

---

## 2. H1 — FIDES

**Objectif.** Émettre, pour un lot de doré de la fenêtre pilote, une attestation vérifiable portant son origine et son intensité carbone, et fournir une page publique où un tiers la vérifie sans nous appeler.

**Périmètre fonctionnel.**

1. Deux identités d'émetteur, en `did:web`, avec leurs clés de signature gérées par l'adaptateur de secrets.
2. Deux attestations par lot : **origine** (émetteur : la mine) et **intensité carbone** (émetteur : Natixar, référençant la première).
3. Sérialisation canonique et nonce par attestation.
4. Une page de vérification statique, exécutant la vérification côté client, sans appel à notre API.
5. Le chiffre carbone, calculé à partir des données 2025 pour la fenêtre pilote.

**Dépendances externes.** Le registre de coulée d'AGM (G-01) ; à défaut, un jeu au bon format marqué comme simulé, ce qui reste honnête mais affaiblit le dossier. Et **un domaine sous contrôle de Natixar pour publier la clé d'émetteur**.

*Correction de la version initiale de ce document :* j'avais présenté cette seconde dépendance comme un routage de `natixar.pro` vers kubb. C'est faux. `did:web:natixar.pro` exige seulement que `https://natixar.pro/.well-known/did.json` soit servi — **peu importe par quoi**. Or `natixar.pro` est déjà servi (adresses Netlify), et `natixar.com` également. La dépendance se réduit donc à **publier un fichier statique** sur un hébergement existant, sans toucher à kubb ni au routage. C'est une demande de quelques minutes à qui administre le site, et non un chantier d'infrastructure.

---

## 3. Identité, émetteurs, et l'identifiant du sujet

C'est la partie la plus structurante, parce qu'elle est la plus coûteuse à corriger.

### 3.1 Les émetteurs ont des DID, et ce sont les seuls

Un DID désigne une entité qui **détient des clés et signe**. AGM et Natixar signent ; ce sont donc elles qui en ont besoin.

- **AGM** — `did:web:guygold.com`, déjà fourni, avec le LEI `5493009W3C3T4JAL0K51` comme identifiant légal corroborant.
- **Natixar** — `did:web:` sur un domaine à confirmer, vraisemblablement `natixar.pro`.

La méthode `did:web` suffit et se justifie : la confiance repose sur DNS et TLS, que toute la chaîne utilise déjà. Aucune blockchain n'est requise.

### 3.2 Faut-il un DID par lingot de doré ?

**Non.** Quatre raisons, dont une décisive.

**1. Un DID promet une capacité que le sujet n'aura jamais.** Un DID implique un contrôleur, des clés, un document DID résoluble. Un lingot ne détient rien, ne signe rien, ne s'authentifie auprès de personne. Lui attribuer un DID, c'est annoncer une capacité inexistante.

**2. `did:web` par lingot publierait l'existence de chaque lingot.** Un document DID par lot sur `guygold.com` révèle, à qui sait compter, le rythme de production de la mine. C'est exactement la fuite que le §6 du paquet AGM interdit. La solution serait auto-destructrice.

**3. Le coût opérationnel croît avec une population d'objets inertes**, pour un bénéfice nul.

**4. La norme ne l'exige pas.** Le modèle W3C demande que `credentialSubject.id`, s'il est présent, soit un URI. Un DID est un URI ; l'inverse n'est pas requis.

### 3.3 Ce que doit être l'identifiant du sujet

L'identifiant interne de la mine (`AUR-2025-0417` ou équivalent) ne convient pas, pour trois motifs cumulés : il n'est pas un URI, il n'est pas globalement unique, et **une numérotation séquentielle divulgue les volumes de production**. Ce troisième point est le plus sérieux et il est facile à manquer.

Exigences :

| # | Exigence | Pourquoi |
|---|---|---|
| 1 | URI | contrainte du modèle W3C |
| 2 | globalement unique | plusieurs sites, plusieurs années |
| 3 | **opaque, sans contenu informationnel** | ni séquence, ni date, ni site |
| 4 | stable au-delà de l'objet | le lingot est refondu ; sa lignée doit survivre |
| 5 | rattachable en privé à l'identifiant interne | AGM doit pouvoir réconcilier |

**Décision.** `credentialSubject.id` = `urn:aurora:dore:<128 bits aléatoires>`.

Un détail qui compte : **pas d'UUIDv7 ni d'ULID.** Ces formats sont ordonnés dans le temps, donc ils divulguent l'ordre et l'instant des coulées — la même fuite que la numérotation séquentielle, simplement moins visible. **UUIDv4 ou 128 bits tirés au hasard.**

L'identifiant interne de la mine devient une **revendication à divulgation contrôlée**, pas l'identifiant. Un vérificateur public voit « un lingot de la mine Aurora, coulé en avril 2025, intensité X » ; AGM et l'acheteur, qui y ont droit, voient l'identifiant interne.

**Reporté à H3, sans être fermé.** Si un écosystème exige un jour un DID de sujet, `did:web:guygold.com:dore:<même valeur opaque>` se superpose au même identifiant sans changer ce qui a été signé — à condition que la partie opaque soit l'élément stable. C'est la raison pour laquelle l'aléa doit être tiré maintenant et jamais dérivé de l'identifiant interne.

---

## 4. H2 — Guyana

Le contenu est celui des issues déjà ouvertes, dans l'ordre d'attaque de la note de priorités :

| Sujet | Issues |
|---|---|
| Origine de chaque donnée : mesurée / dérivée / estimée / non mesurée | #46 |
| Cartographie source → modèle, couverture calculée | #47 |
| Classification département → cas d'usage, équipement → classe, avec provenance de décision | #42, #45 |
| Registre carbone explicable, règles d'allocation | #6, #29, #30 |
| Réconciliation et variance | #48 |
| Indicateurs d'intensité, dont tCO2e/once | #52 |
| Carte de chaleur, tableau de bord, vue qualité | #49, #50 |
| Instrumentation des KPI | #51 |
| Authentification (couche 0 FusionAuth), portée organisation en base | #2, #3, #39 réduit |

Stockage : PostgreSQL, sans partitionnement — 1 100 lignes, granularité mensuelle.

---

## 5. H3 — Outil complet

Séries temporelles performantes (#43, à re-décider sur des volumes réels), multi-clients à l'échelle et framework d'autorisation complet (#39), ancrage Algorand + OpenTimestamps derrière le pilote interchangeable (#40), divulgation sélective cryptographique par arbre de Merkle ou SD-JWT, modèle de classification et codes douaniers (#41), ingestion capteurs, paliers de confidentialité (#44).

---

## 6. Décisions ouvertes

1. **Le domaine d'émetteur de Natixar.** `natixar.pro` ou autre — bloque la publication de la clé, donc H1.
2. **La divulgation sélective en H1 : par omission ou cryptographique ?** En H1, la confidentialité est obtenue en **ne mettant pas** les champs sensibles dans l'attestation. C'est efficace, mais ce n'est pas ce que l'expression « divulgation sélective » désigne techniquement — elle implique que le porteur choisisse à chaque présentation. **Le dossier FIDES rédigé pour Svetlana emploie le terme** : soit on implémente une forme minimale en H1, soit on ajuste la formulation avant publication. À trancher avant le 15 août.
3. **Qui signe l'attestation d'origine si AGM ne dispose pas de moyen de signature ?** Option de repli : Natixar signe une attestation *sur déclaration d'AGM*, en le disant explicitement. Moins fort, mais honnête — et il vaut mieux le décider que le subir.
4. **La fenêtre pilote** — quelles coulées, sur quelle période.
