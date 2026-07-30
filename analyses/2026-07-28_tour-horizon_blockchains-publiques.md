# Tour d'horizon — blockchains publiques pour l'ancrage des traces d'audit

*Note d'architecture, 28 juillet 2026. Document local, non versionné. Alimente l'issue #40 (décision ouverte n°1 : gouvernance des nœuds) et #16.*

Contexte : D4 et D5 du relevé du 28/07 — la blockchain est requise pour le POC, **uniquement comme outil d'audit**, sur une **blockchain publique stable**, technologie neutre à ce stade. Aucune donnée métier n'y est stockée (#40).

---

## 1. Le calcul qui réordonne tout le classement

La question posée était « quelles chaînes rapides et bon marché ». La réponse honnête est que **le coût cesse d'être un critère dès qu'on ancre des racines de Merkle plutôt que des événements**, et #40 impose déjà cette structure (divulgation sélective par preuves d'inclusion, §13.1).

| Stratégie | Volume d'ancrage | Coût annuel, ordre de grandeur |
|---|---|---|
| 1 ancrage par événement, 10⁶ événements/an, Hedera HCS à 0,0008 $ | 10⁶ tx | ≈ 800 $ |
| 1 ancrage par événement, 10⁶ événements/an, L2 Ethereum | 10⁶ tx | quelques centaines à quelques milliers de $ |
| **1 racine de Merkle par heure**, quel que soit le volume | 8 760 tx | **quelques dizaines de $ sur un L2** |
| **1 racine de Merkle par jour**, quel que soit le volume | 365 tx | **quelques centaines de $ même sur Ethereum L1** |
| Racine agrégée via OpenTimestamps (Bitcoin) | — | **0 €** |

Deux conséquences :

1. **Le coût par transaction ne discrimine plus.** Sur les volumes du POC, l'écart entre la chaîne la moins chère et Ethereum L1 en ancrage journalier se compte en centaines d'euros par an. Ce n'est pas un critère d'architecture, c'est une ligne de frais généraux.
2. **Ce que l'on paie en batchant, c'est la précision de l'horodatage prouvé.** Racine journalière ⇒ preuve à ± 1 jour. Le remède est hiérarchique et gratuit : chaîne de hachage locale par événement (ordre relatif exact, coût nul) + ancrage périodique (date absolue opposable). L'ordre est prouvé en interne, la date par la chaîne.

**Le budget étant hors sujet, les critères qui restent sont la gouvernance, la pérennité et le financement.** C'est exactement le classement que l'intuition exprimée dans la demande — « tous ceux qui ont un intérêt assez fort peuvent monter un nœud » — désignait déjà.

---

## 2. Grille de critères

| # | Critère | Pourquoi il compte ici |
|---|---|---|
| A | **Participation ouverte aux nœuds** | l'argument de confiance : un auditeur, une raffinerie, un trader doivent pouvoir vérifier sans dépendre de Natixar, voire opérer un nœud |
| B | **Pérennité à 10–30 ans** | #41 : un passeport publié en 2026 doit rester vérifiable en 2050. Une preuve d'audit ancrée sur une chaîne disparue ne vaut rien |
| C | **Prévisibilité du coût en euros** | la volatilité du jeton est un risque budgétaire, pas un risque technique |
| D | **Finalité** | une réorganisation de chaîne qui efface un ancrage détruit la propriété recherchée |
| E | **Vérifiabilité par un tiers** | un auditeur doit vérifier avec un explorateur public et 20 lignes de script, sans outillage propriétaire |
| F | **Cohérence ESG** | un projet d'intensité carbone qui ancre sur une chaîne à preuve de travail devra s'expliquer, même si le coût énergétique marginal est nul |
| G | **Programme de financement** | la demande explicite : les chaînes qui financent les projets vitrines |

---

## 3. Les candidats

### 3.1 Chaînes ouvertes à participation permissionless

| Chaîne | A · nœuds | B · pérennité | C · coût | D/E | F | G · financement |
|---|---|---|---|---|---|---|
| **Ethereum L1** | ouverte, la plus large | la meilleure du marché | volatil, ~$ par tx | finalité ~13 min, outillage universel | PoS depuis 2022 | ESP (Ethereum Foundation), non ciblé vitrine |
| **L2 Ethereum** (Base, Arbitrum, Optimism, Polygon PoS) | nœuds de vérification ouverts, **séquenceur centralisé** | adossée à L1 tant que le L2 vit | sous-centime | finalité L2 rapide, règlement L1 | PoS | fonds écosystème actifs (Base, Arbitrum, Optimism RetroPGF) — à re-vérifier, ces programmes changent de forme chaque année |
| **Algorand** | **ouverte**, nœud léger accessible | 2019, fondation active | **0,001 ALGO** de frais minimum, fraction de centime | finalité en ~3 s, pas de fork possible par construction | PoS très sobre, positionnement carbone assumé | **xGov** — programme relancé, piloté par un conseil élu par la communauté |
| **Avalanche** | ouverte ; L1 dédiée possible | 2020, fondation très capitalisée | faible | finalité < 2 s | PoS | **Retro9000 : jusqu'à 40 M$**, rétroactif, explicitement pour ceux qui lancent des L1 et de l'infrastructure. > 1 M$ à 19 projets sur un tour récent |

### 3.2 Chaînes publiques à nœuds permissionnés

| Chaîne | Situation |
|---|---|
| **Hedera** | Réseau public en lecture/écriture, mais **les nœuds de consensus restent hébergés par les membres du Governing Council** (~23 + quelques nœuds opérés par l'équipe cœur). La trajectoire annoncée — nœuds communautaires puis réseau pleinement permissionless — était datée de 2024 dans la communication publique et **n'a pas abouti à mi-2026** d'après les sources accessibles. Ce point est à re-vérifier avant toute décision : c'est le seul critère sur lequel Hedera échoue, et c'est précisément celui que la demande met en avant. |

Ce que Hedera offre par ailleurs est difficile à égaler pour cet usage précis :

- **Hedera Consensus Service (HCS)** est un service natif de journal ordonné par « topic ». Pour ancrer, on soumet un message dans un topic — **aucun contrat intelligent à écrire, à déployer, à auditer, ni à maintenir**. La surface d'attaque supprimée est réelle (cf. §4).
- **Tarification fixée en dollars**, indépendante du cours du jeton. `ConsensusSubmitMessage` est passé de 0,0001 $ à **0,0008 $** en janvier 2026, premier ajustement depuis 2019. Le critère C est parfaitement rempli — c'est même la seule chaîne de la liste où le budget est prévisible à l'euro près.
- Finalité en quelques secondes, aBFT.
- **Écosystème traçabilité et financement** : le fonds HBAR / programme Thrive finance ce type de projet — PharmaTrace a reçu 300 000 HBAR pour un réseau de traçabilité pharmaceutique migrant justement d'une architecture privée permissionnée vers une architecture **publique-permissionnée**. L'analogie avec Guyana est frappante et le dossier serait recevable.

### 3.3 Chaînes à confidentialité native

| Chaîne | Mécanisme |
|---|---|
| **Oasis Sapphire** | EVM confidentiel : état chiffré, entrées chiffrées, exécution en enclave (TEE), aléa on-chain, gestionnaire de clés dérivant une clé par contrat. Programme de subventions actif de l'Oasis Protocol Foundation, orienté confidentialité et IA |
| **Concordium** | L1 publique avec couche d'identité **au niveau du protocole** : chaque compte est adossé à un fournisseur d'identité agréé, et les preuves à divulgation nulle sont natives. Fondation domiciliée en Suisse, discours explicitement RGPD et conformité |
| **Partisia** | calcul multipartite (MPC) natif ; positionnement européen, contributions à eIDAS 2 |

### 3.4 Le cas particulier : ne pas prendre de chaîne du tout

**OpenTimestamps** agrège des milliers de hachages en un arbre de Merkle et n'inscrit que la racine dans une transaction Bitcoin **financée par les serveurs de calendrier publics**. Coût pour l'utilisateur : **zéro, quel que soit le volume**. La preuve produite est un fichier `.ots` vérifiable indépendamment contre la chaîne Bitcoin, sans faire confiance à personne — y compris pas aux serveurs de calendrier, dont la preuve d'inclusion est autoportante.

C'est très exactement l'alternative que #40 mentionnait sous la forme « journal signé en ajout seul + horodatage tiers », et c'est la référence contre laquelle toute chaîne payante doit se justifier. Réserves honnêtes : latence d'ancrage (~1 h), dépendance à la disponibilité des serveurs de calendrier au moment de l'ancrage (pas de la vérification), et **preuve de travail** — critère F, sujet inconfortable pour un projet d'intensité carbone même si le coût énergétique marginal d'un horodatage agrégé est nul.

### 3.5 EBSI — hors catégorie, mais à ne pas manquer

**EBSI** (European Blockchain Services Infrastructure), opérée par Europeum-EDIC pour le compte des États membres, n'est pas une chaîne publique au sens des précédentes : c'est une infrastructure européenne de confiance fondée sur les DID W3C et les *Verifiable Credentials*, avec des cas d'usage revendiqués en **traçabilité de chaîne d'approvisionnement et lutte anti-contrefaçon**, et une articulation prévue avec le **portefeuille EUDI** attendu fin 2026.

Deux raisons de la garder au dossier, indépendamment du choix d'ancrage :

1. Le `DID-List.txt` du projet enregistre déjà `did:web:guygold.com` avec le LEI d'AGM Inc. On est déjà, de fait, dans le modèle DID + attestations vérifiables. EBSI en est le cadre européen.
2. Elle traite la question ouverte des **wallets** (point ouvert du relevé, action A9) : l'arbitrage entre fournisseurs homologués et wallet intégré se posera dans le cadre eIDAS 2 / EUDI, pas dans celui d'une chaîne applicative.

---

## 4. Sur le chiffrement, les nonces et les clés natives — la réponse est contre-intuitive

La demande visait les chaînes intégrant nativement chiffrement, gestion des nonces et des clés. **Pour cet usage, ces fonctionnalités sont un piège, et #40 en donne déjà la raison.**

*Pourquoi.* La règle de #40 est : **jamais de cryptogramme sur la chaîne, uniquement des engagements salés**, parce qu'un cryptogramme inscrit dans un registre immuable ne peut plus être rechiffré — la rotation de clé devient impossible, une compromission est rétroactive sur tout l'historique, et une rétention pluriannuelle en fait une cible de manuel pour *harvest now, decrypt later*. Une chaîne qui rend le chiffrement on-chain confortable ne résout pas ce problème : **elle en abaisse le coût d'entrée, ce qui est exactement l'inverse de ce qu'on veut.**

*Le cas du nonce est encore plus net.* Dans #40, la destruction du nonce est le **mécanisme d'effacement** : elle rend l'engagement définitivement décorrélable, ce qui est une réponse RGPD bien plus défendable que le crypto-déchiquetage. Si le nonce est produit et détenu par un aléa on-chain en enclave, **on perd la capacité de le détruire**, donc on perd le mécanisme d'effacement. Une fonctionnalité native devient ici une régression.

*Répartition correcte, à reporter dans #40 :*

| Élément | Où il vit | Pourquoi |
|---|---|---|
| Nonce d'engagement | application, CSPRNG, stocké **avec la donnée** hors chaîne | doit être destructible |
| Clés de chiffrement des données | KMS / Vault hors chaîne, enveloppe, DEK rotatives | problème résolu et ennuyeux |
| **Clés de signature des transactions** | **HSM** | une signature portée par la chaîne vous est attribuée pour toujours ; une compromission permet d'écrire de faux enregistrements en votre nom, sans remède |

**L'HSM sert à signer, pas à chiffrer.** C'est l'inverse de l'intuition initiale, et cela réduit sensiblement la facture.

*La seule fonctionnalité native qui apporte vraiment quelque chose* n'est pas cryptographique : c'est **l'absence de contrat intelligent**. Hedera HCS (topic natif) et Algorand (champ `note` d'une transaction ordinaire) permettent d'ancrer sans déployer une ligne de code sur la chaîne. Pas de contrat, pas de bug de contrat, pas d'audit de contrat, pas de migration de contrat sur trente ans. Pour un usage qui se réduit à « écrire 32 octets et prouver la date », c'est la simplification la plus rentable de tout le dossier.

*Là où la confidentialité native se justifierait réellement* : si un jour un calcul devait s'exécuter sur des données que Natixar ne doit pas voir — c'est-à-dire le palier « enclaves attestées » de #44, le seul qui traite à la fois la coercition et la compromission du chemin de développement. Oasis Sapphire est alors le candidat sérieux. Mais c'est un sujet #44, pas un sujet d'ancrage, et ce n'est pas un sujet de POC.

---

## 4 bis. DÉCISION — 28 juillet 2026

> **Algorand pour l'ancrage courant, plus OpenTimestamps sur Bitcoin en redondance.** Les six actions du §6 sont acceptées. La blockchain est classée **priorité basse (P3)** : elle ne porte aucun KPI de l'annexe 2 et ne doit pas consommer de temps avant les KPI 1 à 5.

Le double ancrage n'est pas un luxe : OpenTimestamps coûte zéro et couvre le risque de pérennité (critère B) qui est le seul reproche sérieux qu'on puisse faire à Algorand. Les deux passent par le même pilote d'ancrage, donc l'un ou l'autre peut disparaître sans toucher au reste.

Conséquences immédiates : #40 et #16 passent en P3, et le seul travail à faire **avant** tout ancrage reste le prérequis P1 déjà identifié — sérialisation canonique et nonce par événement. Ce prérequis n'est pas un travail blockchain : c'est une propriété du modèle d'événements, et il se justifie de toute façon pour la traçabilité UC-06.

---

## 5. Recommandation *(rédigée avant la décision ci-dessus, conservée pour le raisonnement)*

**Décision n°1, à prendre tout de suite et gratuitement : rendre le choix réversible.**

Définir un **pilote d'ancrage** — une interface `ancrer(racine) → reçu{chaîne, txid, horodatage_bloc}` — et non un couplage à une chaîne. Le POC peut alors ancrer simultanément sur deux cibles (par exemple une chaîne retenue **et** OpenTimestamps, dont le coût est nul), ce qui supprime le risque de pérennité du critère B et transforme une décision de gouvernance en paramètre de configuration. C'est la seule décision réellement coûteuse à retarder ; toutes les autres deviennent révisables.

**Décision n°2 — la chaîne, par ordre de préférence :**

1. **Algorand** — c'est le meilleur ajustement à la grille. Nœuds ouverts (critère A, celui qui motivait la demande), finalité en secondes sans fork possible, frais d'une fraction de centime, ancrage sans contrat intelligent via le champ `note`, sobriété énergétique cohérente avec un produit d'intensité carbone (critère F), programme de subventions **xGov** relancé et communautaire, et des références existantes en traçabilité de chaîne d'approvisionnement.
2. **Un L2 Ethereum** (Base ou Arbitrum) — le choix conservateur : l'écosystème le plus large, l'outillage le plus universel pour un auditeur tiers, et la pérennité adossée à L1. Réserve à documenter : le séquenceur est centralisé, la résistance à la censure passe par l'inclusion forcée depuis L1.
3. **Hedera** — le meilleur dossier *économique et de financement* : coût fixé en dollars, HCS natif, écosystème traçabilité, et un précédent de subvention presque identique au projet (PharmaTrace). **Mais il échoue au critère A**, qui est celui qui a été mis en avant. À retenir seulement si le critère « quiconque peut monter un nœud » est explicitement assoupli — auquel cas il faut l'assumer par écrit, parce que c'est l'argument de confiance vendu aux contreparties.
4. **Avalanche** — à considérer d'abord pour le financement (Retro9000, jusqu'à 40 M$, orienté lancement de L1). Mais lancer une L1 dédiée est un contresens ici : cela recrée le problème de gouvernance des nœuds que la chaîne publique était censée résoudre. À n'envisager que si le financement devient un objectif en soi.

**Décision n°3 — ce qui est ancré :** une racine de Merkle par période (horaire pour le POC), sur les **événements** (§1.2, `ledgerReference` de §4.6), pas sur les données métier. Chaque feuille porte son propre nonce, ce qui sert directement la divulgation sélective de §13.1 et le QR code de D7 : le client scanne, reçoit exactement les champs auxquels il a droit, et chacun est vérifiable contre la racine.

**Préalable bloquant, déjà identifié dans #40 :** la taxonomie d'événements de #31 doit être arrêtée, et la sérialisation canonique + le nonce par événement doivent exister **avant le premier ancrage**. Un historique ne se ré-ancre pas sous un autre vocabulaire.

---

## 6. Actions proposées

| # | Action | Issue |
|---|---|---|
| 1 | Commenter #40 avec la §4 : le chiffrement natif est un anti-argument, le nonce doit rester destructible | #40 |
| 2 | Ajouter à #40 la décision « pilote d'ancrage interchangeable + multi-ancrage » | #40 |
| 3 | Ouvrir une issue « choix de chaîne » avec cette grille, et y porter la réponse à la décision ouverte n°1 (qui opère les nœuds) | #40, #16 |
| 4 | Vérifier l'état réel du programme de nœuds communautaires Hedera avant tout arbitrage | — |
| 5 | Instruire les dossiers de financement en parallèle du choix technique : Algorand xGov, HBAR/Thrive, Oasis, Avalanche Retro9000 — ils ne sont pas exclusifs entre eux et alimentent l'action A8 | A8 |
| 6 | Traiter EBSI / EUDI dans le fil « wallets » (A9), séparément de l'ancrage | A9 |

---

*Sources :* [Hedera — mise à jour du prix de ConsensusSubmitMessage, janvier 2026](https://hedera.com/blog/price-update-to-consensussubmitmessage-in-consensus-service-january-2026/) · [Hedera — décentralisation du mainnet et hébergement des nœuds de consensus](https://hedera.com/blog/decentralization-of-the-hedera-mainnet-consensus-node-hosting-and-stake-distribution/) · [Algorand — traçabilité des données](https://algorand.co/ecosystem/data-traceability) · [Algorand — feuille de route 2025+ et relance du programme de subventions](https://algorand.co/blog/algorands-2025-roadmap-building-for-real-world-use) · [Avalanche — Retro9000, programme de subventions de 40 M$](https://www.avax.network/about/blog/retro9000-a-40m-grant-program-rewards-developers-building-avalanche-l1s) · [Oasis — documentation Sapphire](https://docs.oasis.io/build/sapphire/) · [Oasis — subvention accordée à Diode sur Sapphire](https://oasis.net/blog/grant-diode-zero-trust-networking-sapphire) · [Concordium — technologie et couche d'identité](https://www.concordium.com/build/technology) · [OpenTimestamps](https://en.wikipedia.org/wiki/OpenTimestamps) · [StampD — fonctionnement de l'agrégation OpenTimestamps](https://stampd.org/opentimestamps-trustless-proof/) · [EBSI — à propos](https://ebsi.eu/about-us) · [Commission européenne — EBSI, à propos](https://ec.europa.eu/digital-building-blocks/sites/spaces/EBSI/pages/474513483/About+us)
