# Priorités — annexe 2 du contrat et paquet de données AGM

*Note d'architecture, 28 juillet 2026, révision 2. Document local, non versionné. Remplace toute priorisation antérieure.*

Sources : Annexe 2 du contrat EU-LAC Digital Accelerator (Docusign `AEBE5EB7-48F6-81CB-8161-E31230B78609`) et `poc-data/AGM_PoC_Physical_Data_Pack_Completed.xlsx` (réponse AGM du 20 juillet 2026).

---

## 1. Ce que le paquet de données change

Le paquet réduit le problème dans des proportions qu'il faut mesurer, parce qu'elles réorientent tout l'effort.

| | Ce qu'on préparait | Ce que le paquet impose |
|---|---|---|
| Intégration | connecteurs, ERP, API | **« no ERP connector and no system access are required »** — des fichiers Excel |
| Granularité | temps réel, capteurs | **mensuelle, année 2025** |
| Volume | séries temporelles | **≈ 1 100 lignes en tout** : 413 carburant, 597 équipements, 41 explosifs, 30 production d'énergie, 17 production, 8 autres |
| Facteurs d'émission | jeu de facteurs à construire | **six facteurs**, déjà proposés et chiffrés |
| Confidentialité | tiers de données sensibles | **« no prices, no supplier identities, no personal data »** |

Conséquence immédiate : **#43 (TimescaleDB / partitionnement) passe en P3.** Douze points mensuels par série ne justifient rien. De même, l'ouverture d'une issue « connecteurs d'ingestion » n'a plus lieu d'être — il s'agit de lire des feuilles Excel.

---

## 2. Ce que disent les chiffres

Total 2025 : **52 609 061 litres de gazole**, sur 12 mois et 34 catégories de consommateur — cohérent avec les 52,6 M L du rapport de développement durable.

| Catégorie | Litres 2025 | Part |
|---|---:|---:|
| Power Generation | 23 747 501 | **45,1 %** |
| Sinohydro | 10 809 189 | **20,5 %** |
| UG-Power Gen | 7 342 232 | **14,0 %** |
| Mobile Maintenance | 3 309 458 | 6,3 % |
| UG-Mining (GMYM) | 2 068 414 | 3,9 % |
| *30 autres catégories* | 5 332 267 | 10,2 % |

Trois lectures, et la troisième est le cœur du sujet.

**1. La production d'électricité est 59 % de l'empreinte.** Power Generation plus UG-Power Gen. UC-01 est écrasant, exactement comme la liste de cas d'usage l'annonçait. Ce bloc se chiffre aujourd'hui, avec un facteur et une multiplication.

**2. Ce bloc dominant est mesurable mais pas optimisable.** Le feuillet 5 attend toujours les kWh produits et les heures de marche (E-01, E-02). Sans kWh, pas de kgCO2e/kWh, donc pas de quantification des leviers L1 (extension du solaire) et L2 (optimisation de charge des groupes). **E-01 et E-02 sont les demandes ouvertes de plus forte valeur du dossier** : elles décident si le KPI 6 est démontrable sur le plus gros poste.

**3. La colonne « consumer category » n'est pas une catégorie d'activité — c'est le département AGM.** « Sinohydro », « Buckhall », « NORTH CHINA », « Shandong (JC-Project) », « LongKing », « Tapir », « BH Contractor – Ping An » sont des noms de contractants et de projets. Il n'existe **aucune ligne « Haulage »**, alors que UC-02 (roulage et chargement) est sélectionné en P0.

C'est le fait technique déterminant de tout le PoC :

> **Rattacher les 34 départements aux cas d'usage carbone est un travail de jugement, pas de transformation. Et il déplace au moins 27 % de l'empreinte** — Sinohydro 20,5 % plus Mobile Maintenance 6,3 %, deux lignes dont l'activité réelle n'est écrite nulle part.

La même difficulté se répète sur les 592 identifiants d'équipement, dont le tracker note que description, classe, année et puissance restent à valider par la Maintenance. Le plan appelle cela « AI-assisted classification of equipment and consumer categories », semaines 2-3. C'est le chemin critique, et c'est là que se joue la crédibilité du chiffre.

---

## 3. Où en sont réellement les KPI

| KPI | Cible | État réel | Risque |
|---|---|---|---|
| 1 — Data Accuracy | 85–90 % | **rien de démontré** — l'outil n'existe pas. Ce qui existe est un contrôle de vraisemblance interne au jeu de données | à construire |
| 2 — Data Integration Rate | ≥ 2 sources, ≥ 80 % des champs | **rien d'intégré** — les données sont structurées dans un tableur, pas chargées dans une plateforme | à construire |
| 3 — Traceability Coverage | ≥ 70 % du périmètre | routé sur UC-06, en attente des registres de coulée (G-01) et d'export (G-02) | **le plus exposé** |
| 4 — User Validation | ≥ 1 atelier, ≥ 3 parties prenantes | à organiser | organisationnel |
| 5 — Emissions Hotspots | ≥ 3 points chauds | rien de construit | **notre travail** |
| 6 — Decarbonisation map | potentiel d'abattement chiffré | rien de construit | **ajouté par le paquet, hors annexe 2** |

**Sur le KPI 1 — ce que le −0,16 % mesure vraiment.** Il ne mesure pas le KPI. Il compare les litres physiques du feuillet 3, multipliés par le facteur 2,68, au total du registre GHG d'AGM — c'est-à-dire **le jeu de données d'AGM contre le propre calcul d'AGM**, effectué dans un tableur. Aucun outil n'a rien produit. Le KPI se mesure entre les valeurs calculées par AGM et celles calculées par la plateforme, et il ne sera démontrable qu'une fois celle-ci construite.

Ce contrôle garde une valeur : il établit que les litres et le facteur sont mutuellement cohérents, donc que le KPI n'est pas hors d'atteinte pour une raison de données. **Il dérisque, il ne démontre pas.**

Et il révèle un piège de conception qu'il vaut mieux voir maintenant :

> Si la plateforme applique **les mêmes litres et le même facteur** que le registre d'AGM, l'accord est arithmétiquement garanti et le KPI ne mesure rien.

Le KPI n'est informatif que là où les deux calculs diffèrent — par la **granularité** (transactions par équipement contre agrégats par département), par le **jeu de facteurs**, ou par le **périmètre**. C'est exactement le terrain de l'écart de −4,30 %. La comparaison doit donc être construite pour ne pas être tautologique, et c'est une décision à prendre **avant** d'écrire #48.

**L'écart interne à AGM reste le point dur.** La cible comporte une seconde condition : *« with no critical discrepancy affecting interpretation or decision-making »*. Or il en existe une, et elle est dans les documents d'AGM : **le registre GHG totalise 87 215,058 tCO2e sur janvier-août quand le rapport de développement durable en publie 91 135, soit −4,30 %.** Ce n'est pas notre écart, mais il tombe dans notre KPI. À porter à l'atelier de cadrage, pas à découvrir à la revue.

**Sur le KPI 3 — le seul dont les données ne sont pas en main.** G-01 et G-02 exigent l'accord du Gold Room, du juridique et de la sécurité. C'est une chaîne d'approbation hors de notre contrôle, sur le KPI que la traçabilité est censée servir. À relancer dès maintenant, en parallèle du reste.

**Sur le KPI 6 — attention.** Il n'est pas dans l'annexe 2, qui en liste cinq. Le paquet l'ajoute comme « added value ». C'est aussi le plus coûteux en analyse, et il dépend de données manquantes (E-02). **Il ne doit pas passer devant les KPI 1 à 5.**

---

## 4. Classement

**Règle :** P0 = produit un KPI ou le bloque · P1 = nécessaire au pilote sans être un KPI · P2 = hors chemin contractuel · P3 = hors périmètre.

### P0 — 4 issues

| # | Titre | Pourquoi |
|---|---|---|
| **#42** | Recherche hybride pour la réconciliation documentaire et l'affectation de codes | c'est la classification département → cas d'usage et équipement → classe. Chemin critique semaines 2-3, et 27 % de l'empreinte en dépendent |
| **#45** | Provenance des décisions (partie A) | classer « Sinohydro » est une décision conjointe machine/humain qui déplace 20 % du résultat. La machine doit enregistrer ses candidats et scores **avant** que l'humain tranche, et chacun justifie sa part. La partie B (déchets requalifiés) reste hors périmètre |
| **#6** | Carbon ledger explicable (`CarbonEntry`) | la preuve du KPI 1 est une réconciliation : il faut remonter de chaque résultat aux litres, au facteur et à sa version |
| **#29** | Règles d'allocation carbone (2 sur 5 manquantes) | répartir 52,6 M L entre UC-01/02/03/05 **est** une allocation, et la règle employée doit être enregistrée et visible (§14.2) |

### P1 — 11 issues

#2 · #3 (authentification et garde de permissions — trois parties prenantes AGM à l'atelier) · #5 (recalcul : les facteurs sont explicitement provisoires et AGM peut substituer les siens) · #7 (qualité des données, à recadrer : lacunes de jeux de données, pas de capteurs — le paquet promet une « data-quality view » au tableau de bord) · #25 · #26 · #27 (défauts d'ergonomie rencontrés en direct à l'atelier du KPI 4) · #30 (terme « autres » du CO2 mine) · #31 (taxonomie d'événements, périmètre réduit à UC-06) · #35 · #39 (à périmètre réduit, cf. §6)

### P2 — 10 issues

#12 · #16 · #20 · #23 · #34 · #36 · #37 · #38 · **#40 (ancrage blockchain)** · #44

### P3 — 20 issues

#1 · #4 · #8 · #9 · #10 · #11 · #13 · #14 · #15 · #17 · #18 · #19 · #21 · #22 · #24 · #28 · #32 · #33 · #41 · **#43**

### Mouvements depuis la révision 1

| # | Avant | Après | Motif |
|---|---|---|---|
| #42 | P1 | **P0** | la classification est le chemin critique, pas un raffinement |
| #45 | P1 | **P0** | la décision de classement engage un cinquième de l'empreinte |
| #7 | P0 | P1 | il n'y a pas de capteurs ; l'exigence est une vue des lacunes documentées |
| #25 | P0 | P1 | le KPI 3 passe par des registres de coulée importés, pas par une saisie manuelle d'événements |
| #31 | P0 | P1 | périmètre événementiel réduit à UC-06 |
| #43 | P1 | **P3** | douze points mensuels |

---

## 5. Les issues manquantes — ouvertes le 28/07

| # | Issue | KPI | Rang |
|---|---|---|---|
| **#46** | Origine de chaque donnée : mesurée / dérivée / estimée / non mesurée | **1** | P0 |
| **#47** | Cartographie source → modèle, couverture des champs **calculée** et non affirmée | 1, 2 | P0 |
| **#48** | Moteur de réconciliation et de variance : bilan matière, et écart contre le registre GHG d'AGM | **1** | P0 |
| **#49** | Carte de chaleur par cas d'usage : axe absolu et axe intensité | **5** | P0 |
| **#50** | Tableau de bord pilote, incluant la vue qualité des données promise dans le « Read me » | tous | P0 |
| **#51** | Instrumentation des KPI 1, 2 et 3 par la plateforme plutôt que par un tableur | 1, 2, 3 | P0 |
| **#52** | Indicateurs d'intensité en objets de premier rang, dont **tCO2e/oz** | 5, 6 | P1 |

*G1 (connecteurs) n'a pas été ouverte : il n'y a pas de connecteur à écrire.*

**#46 reste la plus urgente.** Le tracker distingue déjà Yes / Partial / No / NOT MEASURED, et le « Read me » promet que toute lacune documentée est « routed immediately to an estimation method and recorded in the data-quality view ». Cela impose une origine par donnée dans le schéma — et les décisions de schéma sont les seules vraiment coûteuses à rattraper.

**#48 n'est pas un contrôle de tableur.** L'écart de −4,30 % entre deux documents d'AGM montre que la réconciliation est une fonction du produit, avec ses écarts, ses seuils et son historique.

---

## 6. Réduction de périmètre recommandée

Le soutien financier associé est de **7 000 EUR** (annexe 3), conditionné à la preuve des KPI. Cela doit calibrer l'effort.

- **#39** — couche 0 achetée (FusionAuth **auto-hébergé** d'abord, les `docker-compose` étant prêts, sous condition de portabilité de la configuration vers le Cloud), couche 2 réduite à la portée organisation, couche 1 et service authz après le PoC.
- **#40 et la blockchain** — P2. D4 reste valable, mais aucun KPI ne la demande et le KPI 3 est explicitement routé sur « gold origin + carbon credential » à partir de données déjà produites, qualifié de « low effort ».
- **KPI 6** — après les KPI 1 à 5.

---

## 7. Ordre d'attaque

1. **#46** — trancher l'origine des données. Bloque le schéma.
2. **#47 + #42 + #45** — charger les fichiers, classer les 34 départements et les 592 équipements, enregistrer qui a décidé quoi. C'est le chemin critique.
3. **#6 + #29 + #30** — le calcul carbone traçable. KPI 1.
4. **#48** — réconciliation et bilan matière. KPI 1, et l'écart de −4,30 % à instruire.
5. **#49 + #50 + #52** — carte de chaleur, indicateurs d'intensité, tableau de bord. KPI 5.
6. **#51** — instrumentation, en continu, pas à la fin.
7. Le reste du P1, dont l’ergonomie de l’atelier.

*(Le §5 renvoie désormais aux issues #46 à #52, ouvertes le 28/07.)*

**Trois relances à lancer aujourd'hui, indépendantes du développement :**

| Réf | Objet | Pourquoi maintenant |
|---|---|---|
| **E-01 / E-02** | kWh produits et heures de marche par groupe | 59 % de l'empreinte est chiffrable mais pas optimisable sans eux |
| **G-01 / G-02** | registres de coulée et d'export | seul KPI dont les données ne sont pas en main, et la chaîne d'approbation est longue |
| **H-01** | écart de −4,30 % entre registre GHG et rapport publié | tombe dans le KPI 1, et c'est à AGM de l'expliquer |

---

## 8. À revoir après les user stories

Ce classement découle du contrat et des données. Les user stories attendues closent la tâche « Pilot perimeter and use-case definition » et peuvent déplacer le P1 ergonomique. Le P0 et les six manques découlent des KPI et ne devraient pas bouger.
