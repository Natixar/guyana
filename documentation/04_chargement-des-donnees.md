# 04 — Le chargement des données

*État au 11 septembre 2026. Le code fait foi : `services/store/load_2025.py`,
`services/store/make_fixture.py`.*

---

## En une phrase

Un classeur Excel fourni par le client devient, par **deux scripts** et **une
affectation tenue à la main**, un fichier de données pour le site et un cube en
base. Il n'y a pas d'ingestion à proprement parler : il y a un chargement
ponctuel, et il le déclare lui-même.

`load_2025.py` l'écrit dans son en-tête : *« un chargement ponctuel, autorisé
explicitement pour FIDES, et non le début d'une chaîne d'ingestion »*. La
cartographie source → modèle, et son taux de couverture calculé, sont l'objet de
l'issue #47.

---

## La chaîne

```
   POSTE DE CONTRÔLE                                                  kubb
   ─────────────────                                                  ────

   poc-data/                          (hors dépôt — clause 9)
   ├─ AGM_PoC_Physical_Data_Pack_Completed.xlsx
   │     │
   │     ├──▶ build_assignment.py ──▶ agm-h1-subpost-assignment.json
   │     │                                     │
   │     ├──▶ make_fixture.py ────────────────┼──▶ site/static/engine/erp-fixture.json
   │     │     (onglets 3, 6, 7)               │          (versionné)
   │     │                                     │               │
   │     └──▶ load_2025.py ◀───────────────────┴───────────────┘
   │           (onglets 3, 7)
   │                │
   │                │  --sql : SQL sur stdout, par ssh           ┌────────────┐
   │                └───────────────────────────────────────────▶│ PostgreSQL │
   │                   ou connexion directe (STORE_DSN)           │ entity     │
   │                                                              │ cell       │
                                                                  └────────────┘
```

**Trois scripts, et un ordre.** L'affectation d'abord, puisque les deux autres
la lisent ; le fixture ensuite, puisque le chargeur y lit la numérotation des
départements ; le chargeur en dernier.

---

## Ce qui ne quitte pas le poste de contrôle

**Le classeur du client est confidentiel au titre de la clause 9 de l'accord de
collaboration.** Il vit dans `poc-data/`, que `.gitignore` exclut ; aucun script
ne recopie son contenu dans un fichier suivi.

L'affectation `agm-h1-subpost-assignment.json` et le script qui la produit
vivent au même endroit, pour la même raison : ils nomment les départements du
client.

Quand le chargeur écrit vers la base de kubb, **le classeur reste sur le poste
de contrôle** : seul le SQL qu'on en tire traverse, par stdin, et rien ne s'écrit
sur le système de fichiers de la cible. C'est la doctrine de `deploy/`, appliquée
ici.

---

## Le classeur

Douze onglets, remplis par le client sur les gabarits de la demande de données.
Chaque gabarit porte en tête son identifiant — `D-01`, `E-01/E-03`, `G-01` —, sa
priorité, une ligne d'exemple, et une colonne de commentaire où le client dit
**comment la valeur a été obtenue**.

| Onglet | Contenu | Lu par |
|---|---|---|
| 0 — Read me | notice | — |
| 1 — Use case list | cas d'usage UC-01 à UC-04 | — |
| 2 — Data request tracker | suivi des demandes de données | — |
| 3 — Fuel by consumer | gazole sorti, par mois et par catégorie de consommateur | `make_fixture.py`, `load_2025.py` |
| 4 — Equipment register | registre des engins et installations | consulté pour établir l'affectation |
| 5 — Power generation | groupes électrogènes et solaire | — |
| 6 — Production | or produit, par mois | `make_fixture.py` |
| 7 — Explosives | explosifs consommés, par mois et par produit | `make_fixture.py`, `load_2025.py` |
| 8 — Other sources | autres sources | — |
| 9 — Emission factors | facteurs d'émission, et leur statut | recopiés dans `load_2025.py` |
| 10 — KPI tracker | suivi des indicateurs de l'Annexe 2 | — |
| 11 — Plan | calendrier | — |

Les colonnes lues sont, dans l'onglet 3 : le mois, la catégorie de consommateur,
la quantité ; dans l'onglet 7 : le mois, le produit, la quantité ; dans
l'onglet 6 : le mois et les onces produites.

---

## L'affectation — `build_assignment.py`

**Ce que le classeur ne dit pas, et qu'il faut pourtant savoir.** L'onglet 3
range le gazole par *catégorie de consommateur* — un nom de département ou de
sous-traitant. La taxonomie, elle, attend un **sous-poste** : combustion fixe
(`CombustiblesFossiles`, un groupe électrogène) ou fret interne (`FretInterne`,
un engin qui roule). Le passage de l'un à l'autre est une **décision**, et ce
script la porte.

Il associe à chaque catégorie :

- un sous-poste et une caractérisation ;
- un **degré de confiance** — `confirmed`, ou `needs AGM confirmation` ;
- une **justification** : le nom du département, et ce que le registre
  d'équipements de l'onglet 4 dit de sa flotte.

Il déclare en outre les sources que le classeur mentionne sans les mesurer,
et les décisions ouvertes. Son statut est écrit dans le fichier produit :
*« PROPOSED — assigned by Natixar from department names and the equipment
register, pending AGM verification »*.

La correspondance elle-même est un dictionnaire Python, écrit à la main : c'est
un jugement, pas un calcul.

---

## Le fixture — `make_fixture.py`

Il fabrique les données « ERP » dont le site a besoin pour montrer une barre :
la taxonomie d'organisation, le procédé, les lots et les barres. Il est
**versionné** dans `site/static/engine/erp-fixture.json`, et le site le lit.

**Ce qui vient du classeur** : les onces produites par mois, les départements,
le gazole et les explosifs.

**Ce qui est simulé** — et le fichier le déclare, `simulated: true`, avec la liste
des champs concernés : le registre de coulée du client (gabarit `G-01`) est
encore partiel, donc la date de coulée, l'identifiant de barre, le poids et le
titre sont fabriqués.

**La numérotation des départements vient d'ici.** Les identifiants entiers
suivent l'ordre du fichier d'affectation, lui-même par part décroissante. Le
chargeur les **lit** dans le fixture au lieu de les attribuer à son tour : deux
numérotations coïncideraient jusqu'au jour où un département serait ajouté, et
la divergence serait silencieuse.

**Les mois manquants sont déclarés ici.** La fenêtre de production commence en
février, parce que janvier puiserait dans un décembre 2024 que le classeur ne
contient pas. Le fixture écrit la liste des mois synthétiques dans
`model.syntheticMonths` ; le chargeur la lit plutôt que de la recalculer.

---

## Le chargeur — `load_2025.py`

### Ce qu'il écrit

**La table `entity`** : l'organisation de tête du client — identifiant 100, son
identité légale et son DID —, puis ses départements, rattachés à elle, avec les
identifiants du fixture. La tête est insérée **avant** les départements : la
clé étrangère `parent` ferait sinon avorter tout le chargement.

**La table `cell`** :

- **deux cellules par ligne de gazole** — la combustion, et la part amont de
  chaque litre, le terme qu'un modèle naïf perd entièrement ;
- **une cellule par ligne d'explosifs**, rattachée au département de minage : le
  classeur les donne par produit et par mois, jamais par département, et les
  répartir inventerait une ventilation que personne n'a.

La correspondance catégorie → sous-poste est **lue** dans l'affectation ; une
catégorie qui n'y figure pas, ou qui n'a pas de département dans le fixture, est
écartée avec un message sur la sortie d'erreur.

### Ce qu'il transforme, et où

**Toutes les transformations ont lieu ici, à la frontière**, parce que c'est le
dernier point où la donnée existe encore telle que le client l'a écrite.
Au-delà, il n'y a qu'un débit sur un intervalle.

| Transformation | Règle |
|---|---|
| **période** | le mois `AAAA-MM` devient un intervalle `[début, fin)` de minuit **local** — UTC−4, sans heure d'été — à minuit local, stocké en UTC |
| **débit** | quantité ÷ durée de la période en secondes |
| **unité d'activité** | le litre devient le mètre cube ; le kilogramme reste le kilogramme |
| **facteur** | le facteur par litre devient un facteur par mètre cube, multiplié par mille |
| **affichage** | l'unité de la source — le litre — et son facteur depuis le SI sont conservés, pour relire la donnée brute |

**Le sens de la conversion est vérifié par un test**, `test_units.py`, et non
relu : un litre est un millième de mètre cube, donc la valeur se divise par mille
et le facteur se multiplie par mille. C'est le produit qui est physique, pas les
deux nombres pris séparément.

**Les facteurs** sont ceux de l'onglet 9, recopiés dans `SOURCE_FACTORS` :
combustion du gazole, amont du gazole, explosifs. Une unité de facteur que
`TO_SI` ne sait pas ramener au SI est **refusée** : convertir au jugé produirait
un nombre plausible et faux, que la signature figerait.

### Les mois reconstitués

Pour chaque mois déclaré manquant par le fixture, le chargeur recopie les lignes
du **même mois de l'année suivante** — décembre 2024 depuis décembre 2025, la
seule saisonnalité que douze mois de données permettent d'invoquer — et les
marque `coverage = MISSING`. La cellule existe, et elle dit d'où elle vient.

### L'origine

Le chargeur écrit `origin = MEASURED` sur chaque cellule, par un littéral. La
colonne de méthode des onglets 3 et 7 n'est pas lue.

### Idempotence

Les identifiants de cellule sont **dérivés de la source** — `d/` et le mois, le
département et la part pour le gazole, `x/` et le mois et le produit pour les
explosifs. Relancer remplace au lieu d'empiler : chaque insertion porte
`ON CONFLICT (id) DO UPDATE`, **sur toutes les colonnes** — un rechargement qui
change de dimension doit changer la dimension, et en omettre une laisserait une
valeur neuve sous une étiquette ancienne.

### Le schéma

**En connexion directe**, le chargeur appelle `db.apply_schema` avant d'écrire.
**En mode `--sql`, il ne le fait pas** : le SQL émis ne contient que la
transaction d'insertion. Il suppose donc un schéma déjà en place — ce que
garantit le magasin, qui l'applique à chacun de ses démarrages ; voir
[03](03_schema-et-qualite-des-donnees.md). Le schéma étant idempotent,
l'appliquer deux fois ne change rien.

---

## L'exécuter

```bash
python3 services/store/load_2025.py --dry-run               # compte et résume, n'écrit rien
STORE_DSN=… python3 services/store/load_2025.py             # écrit, par connexion directe

# vers la base de kubb : le SQL part par stdin, rien ne s'écrit sur la cible
python3 services/store/load_2025.py --sql \
  | ssh claude-ia@kubb docker exec -i guyana-db psql -U aurora -d aurora
```

Le conteneur, l'utilisateur et la base sont ceux du descripteur
`deploy/inventory/hosts.d/kubb.env` — `DB_CONTAINER`, `DB_USER`, `DB_NAME`. La
commande n'est écrite dans aucun script : c'est l'usage que l'option `--sql`
annonce dans son aide et dans son commentaire, rendu explicite ici.

`--dry-run` est un mode explicite plutôt qu'un défaut : l'aide le dit, *« le
défaut serait dangereux dans l'autre sens »*.

**Le mode `--sql` est celui de kubb.** La base n'y publie aucun port ; le
chargeur ne s'y connecte donc pas, il émet le SQL sur stdout, et le SQL voyage
par ssh. Une seule transaction, `BEGIN` … `COMMIT` : un chargement à moitié
appliqué laisserait un cube dont personne ne saurait dire s'il est complet.

**Le résumé part sur la sortie d'erreur**, jamais sur stdout, pour ne pas se
mêler au SQL quand celui-ci part dans un tuyau. Il reparle en quantités — mètres
cubes de gazole, tonnes de CO2e — parce qu'un débit en m³/s ne se relit pas.

**Dépendances Python** : `openpyxl` pour le classeur, `psycopg` pour la base. Le
classeur doit être présent dans `poc-data/` ; son absence arrête le script avec un
message qui rappelle pourquoi il n'est pas dans le dépôt.
