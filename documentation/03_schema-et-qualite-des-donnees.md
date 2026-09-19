# 03 — Le schéma de la base, et la vue qualité des données

*État au 11 septembre 2026. Le code fait foi : `services/store/schema.sql` pour
le schéma, `services/store/app.py` et `site/assets/js/quality.js` pour la vue.*

---

## En une phrase

La base stocke des **débits sur des intervalles de temps**, chacun situé sur
trois axes — le temps, le poste d'émission, l'entité émettrice — et qualifié sur
deux axes indépendants : **d'où vient la valeur**, et **si la série à laquelle
elle appartient est complète**.

---

## L'ontologie que le schéma implémente

Le schéma n'est pas le point de départ : il implémente une ontologie métier —
des entités, des postes, des lots de matière, des événements, et des relations
de conservation entre eux. Toutes ne vivent pas en base, et c'est délibéré.

| Notion | Ce qu'elle désigne | Où elle vit |
|---|---|---|
| **Entité** | qui émet : l'organisation cliente, ses départements | table `entity` |
| **Poste** | ce qui est émis, et comment on le range | `site/static/engine/taxonomy.json` — publié, jamais en base |
| **Débit** | une émission uniforme sur un intervalle | table `cell` |
| **Lot, barre** | la matière qui porte l'émission | `site/static/engine/erp-fixture.json` |
| **Événement** | une coulée, qui clôt un lot | `erp-fixture.json` |
| **Attestation** | un énoncé signé sur une barre | table `credential` |
| **Conservation** | ce qui a été émis se retrouve, en totalité, dans ce qui a été produit | la règle d'allocation, dans `site/assets/js/engine.js` |

**La taxonomie n'est pas en base, et c'est ce qui la rend vérifiable.** Un
vérificateur doit pouvoir dériver lui-même la ligne GHG Protocol d'une cellule
sans nous appeler. La table est donc publiée, sous une version nommée —
`agm-h1-v2` aujourd'hui —, et les cellules ne portent que des **entiers** qui
s'y rapportent.

---

## Les trois tables

### `entity` — qui émet

Un arbre. La racine est l'**organisation de tête** — le client, personne morale
—, et ses enfants sont ses départements.

| Colonne | Rôle |
|---|---|
| `id` | entier ; c'est lui, et lui seul, que voient les attestations |
| `label` | le nom, en clair — voir plus bas |
| `parent` | l'entité mère ; `NULL` pour une organisation de tête |
| `industrial` | la matière traverse-t-elle ce département, ou le soutient-il ? |
| `legal_name`, `jurisdiction`, `registered_office` | l'identité légale — **renseignées sur la tête seule** |
| `did` | l'identifiant décentralisé de l'organisation, d'où le front tire l'émetteur qu'il signe |

**Le cloisonnement multi-client est la racine de l'arbre, pas une colonne.**
Compter par client se dit « remonter les parents jusqu'à la racine, puis
grouper ». Une colonne `tenant_id` sur chaque cellule dupliquerait ce que
`parent` sait déjà, et le jour où les deux divergeraient, c'est la colonne qu'on
croirait.

**La forme dit laquelle des entités est une personne morale** : les colonnes
d'identité légale ne sont remplies que sur la tête, puisque les départements
n'en ont pas.

**`industrial` décide de l'allocation.** Un département de soutien émet
réellement et n'appartient à aucun lot : ses émissions deviennent le **non
alloué**, que la règle d'allocation répartit entre les barres coulées le mois
même.

**Les noms sont en clair, provisoirement.** Ce sont eux qui révèlent
l'organigramme du client, et c'est cette table que le chiffrement des dimensions
couvrira — décision D1 de l'issue #6, non tranchée. Le client, lui, ne connaît
déjà que les entiers : rien du front ne changera ce jour-là.

### `cell` — la table de faits

Rien que des nombres et un intervalle.

| Colonne | Rôle |
|---|---|
| `id` | texte, **déterministe**, dérivé de la source — voir « Idempotence » |
| `period` | `tstzrange`, semi-ouvert `[début, fin)` |
| `entity_id` | l'entité émettrice — et, en H1, l'unité de production et l'étape du procédé |
| `sub_post`, `part_type`, `caracterisation` | la position dans la taxonomie, en entiers ; `sub_post` nul = non alloué |
| `flux` | le **débit**, en unité SI **par seconde** |
| `dimension` | ce que le débit mesure — `volume`, `mass`, `energy` |
| `display_unit`, `display_scale` | l'unité où la donnée brute se relit, et le facteur qui y mène depuis le SI |
| `factor` | le facteur d'émission, en **kgCO2e par unité SI** d'activité |
| `origin` | d'où vient la valeur — premier axe de qualité |
| `coverage` | la série a-t-elle ses dates — second axe de qualité |

Un index GiST porte sur `period`. Contraintes : un intervalle ne peut pas être
vide (`period_not_empty`) ; `origin` et `coverage` sont restreints à leurs
valeurs.

### `credential` — les attestations reçues

| Colonne | Rôle |
|---|---|
| `digest` | SHA-256 de la forme canonique — **la clé** |
| `subject` | `credentialSubject.id`, un URN opaque |
| `type` | le type W3C significatif, hors `VerifiableCredential` |
| `received_at`, `received_by` | quand, et par quel compte |
| `document` | l'attestation, **telle quelle**, en `jsonb` |

**La clé est l'empreinte du document, pas le sujet.** Une barre porte deux
attestations — l'origine, signée par la mine, et l'intensité carbone, signée par
Natixar — et toutes deux portent le même sujet, puisque c'est ce que
`derivedFrom` relie. Clé sur le sujet, la seconde arrivée était silencieusement
jetée. Clé sur l'empreinte : renvoyer deux fois le même fichier ne crée rien,
une réémission pour le même sujet est une ligne de plus, et le registre prend la
plus récente par (sujet, type).

**Stockées telles quelles**, parce qu'elles sont signées : les reformater les
invaliderait.

---

## Le modèle de flux

### Pourquoi un débit, et non une quantité

Une cellule porte un flux moyen sur une période, jamais une valeur à un instant.
Toutes les interrogations sont donc des **recouvrements** : intégrer sur un
intervalle quelconque se dit `&&`. Deux colonnes début/fin indexées séparément
donneraient un B-tree qui se dégrade précisément sur cette requête-là ;
`tstzrange` et GiST y répondent en une passe.

La métrique est stockée **divisée par la durée de sa période** — unité SI par
seconde — et la quantité se retrouve en multipliant par la durée voulue.
Intégrer sur une fenêtre qui recouvre à moitié une cellule mensuelle rend donc
la moitié.

### La seule hypothèse du modèle

**Le débit est supposé uniforme sur l'intervalle.** Entre deux relevés mensuels,
rien ne dit comment la consommation s'est répartie, et un débit constant est la
seule répartition qui n'invente pas de structure.

Cette hypothèse a une conséquence qui gouverne l'API : **le choix des bornes est
libre.** Sur une fenêtre plus courte, les émissions diminuent au prorata du
temps, mais la production aussi — trente barres dans le mois en font quinze en
quinze jours. Numérateur et dénominateur diminuent ensemble, et l'intensité par
barre ne bouge pas. Aucune borne de requête n'est donc contrainte, et rien n'est
aligné sur des mois.

Elle dégrade proprement : des données plus fines donnent des intervalles plus
courts, donc une meilleure approximation, **sans changer de modèle**.

### Le fuseau

Les bornes sont des minuits **locaux** — le Guyana est à UTC−4 toute l'année —,
stockés en UTC. Découper sur des minuits Zulu décalerait chaque frontière de
quatre heures, et rangerait une nuit de production dans le mois suivant.

---

## Les unités

**Tout est en SI, et c'est la dimension qui est stockée, pas l'unité.**
« Volume » se lit m³, « mass » kg ; divisé par la durée, m³/s ou kg/s. Nommer
l'unité par-dessus la dimension ajouterait un choix là où il n'y en a pas, donc
une occasion de divergence.

**Le facteur d'émission est un nombre**, toujours en kgCO2e par unité SI
d'activité. L'unité se déduit de `dimension` ; porter « kgCO2e/m³ » à côté
serait une seconde source de vérité. La conversion depuis l'unité de la source —
le litre des bons de sortie — a lieu **une fois, à l'ingestion**.

**`display_scale` évite d'écrire un système d'unités.** `affichage = SI ×
display_scale` : un mètre cube vaut mille litres, donc 1000. Savoir qu'une
donnée « est en litres » ne sert à rien sans une table des symboles, de leurs
préfixes et de leurs multiples ; le facteur dit tout ce dont l'affichage a
besoin, en un double. Il n'entre dans aucun calcul.

Le calcul rend des kgCO2e (`RESULT_UNIT`, dans `engine.js`).

---

## Deux axes de qualité, et pourquoi deux

**`origin` dit d'où vient LA VALEUR d'une cellule.** **`coverage` dit si la
SÉRIE à laquelle elle appartient a une date que personne n'a fournie.** Une
cellule peut être mesurée et combler un trou de calendrier à la fois : un seul
axe ne pourrait pas le dire.

### `origin`

| Valeur | Sens |
|---|---|
| `MEASURED` | la grandeur a été lue sur un instrument, pour cet intervalle |
| `DERIVED` | elle se déduit d'une grandeur mesurée, par une opération explicite |
| `ESTIMATED` | elle résulte d'un jugement, d'une moyenne ou d'une grandeur empruntée |
| `NOT_MEASURED` | aucune donnée n'existe, et la cellule le déclare |

**Un débit reconstitué en divisant un total mensuel par la durée du mois est
`DERIVED`, jamais `MEASURED`.** La grandeur mesurée est le total ; le débit sur
chaque seconde du mois en est une déduction, sous l'hypothèse d'uniformité. Ce
classement découle du modèle de flux plutôt qu'il ne s'y ajoute : un capteur qui
intègre physiquement sur sa boucle de mesure rapporte un agrégat mesuré, dont la
répartition à l'intérieur de la période est modélisée.

**Un agrégat déclare l'ensemble de ses origines, pas la plus faible.**
Provenance et exactitude sont deux questions : *puis-je remonter à la source de
cette valeur* d'un côté, *de combien est-elle fausse* de l'autre. Pour la
première, un agrégat porte l'ensemble des origines qu'il contient —
`{MEASURED, ESTIMATED}` — ce qui conserve l'information utile au lecteur : *quelle
part* est estimée, et non seulement *qu'une part* l'est. La seconde se propage
numériquement — somme quadratique pour des sources dont l'indépendance est
établie, linéaire pour des sources corrélées.

**Un détail estimé sous un agrégat mesuré** — un compteur couvrant plusieurs
machines, réparti par temps de marche ou par classe d'engin — fait de l'origine
une **relation** et non plus une étiquette : cet ensemble de valeurs dérivées se
somme à ce total mesuré. C'est le contrôle de cohérence interne qui rend la
répartition défendable.

### `coverage`

| Valeur | Sens |
|---|---|
| `COMPLETE` | la date est couverte par la source |
| `MISSING` | la série est périodique, une date manque, et la cellule la comble |

**La cellule existe, et elle le dit.** Ne rien charger pour un mois absent
laisserait un trou qu'aucun dénombrement ne verrait : une couverture calculée
sur les cellules présentes vaudrait 100 % en ignorant le mois manquant.
Reconstituer sans marquer serait pire — le trou deviendrait invisible tout en
pesant sur les chiffres publiés. Le seul choix honnête porte la valeur et l'aveu
ensemble.

**Il n'y a pas de valeur `INCOMPLETE` en H1.** Juger qu'une émission attend une
grandeur absente suppose de connaître l'**intention de calcul**, qui n'est pas
stockée : elle est implicite — une métrique, un facteur. Une règle codée en dur
ici serait une intention de calcul déguisée, vraie pour le gazole d'un client et
fausse pour le suivant.

---

## Idempotence

Les identifiants de cellule sont **déterministes, dérivés de la source** : un
préfixe de nature, le mois, le département ou le produit, et la part —
`d/2025-03/<département>/comb`, `x/2025-03/<produit>`. Recharger remplace au lieu
d'empiler (`ON CONFLICT (id) DO UPDATE`, toutes colonnes comprises). Un
chargement joué deux fois par mégarde doublerait sinon l'inventaire, et cela ne
se verrait pas.

---

## Qui applique le schéma

**Le magasin, à son démarrage** — `lifespan` dans `services/store/app.py`, avant
la première requête. `schema.sql` voyage dans l'image, à côté des requêtes qui en
dépendent : une image déployée trouve toujours la base que ses requêtes
attendent.

C'est possible sans privilège supplémentaire parce que `schema.sql` est
**idempotent par construction** — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF
NOT EXISTS` —, et que les migrations y figurent **après** les `CREATE` : un
`ALTER` sur une table que le même fichier n'a pas encore créée ferait avorter
toute la transaction. Le schéma d'une base migrée finit ainsi identique à celui
d'une base neuve.

---

## La vue qualité des données

*Page `/quality/`, réservée ; données servies par `GET /api/v1/counts`.*

### Intention

Permettre à Natixar, qui exploite la plateforme, de **surveiller la qualité des
données de ses clients sans lire leurs affaires**. L'énoncé de confidentialité
de la plateforme se tient ou tombe ici : c'est le seul écran où l'exploitant
voit plusieurs clients à la fois.

### Exigences

| | Exigence | D'où elle vient |
|---|---|---|
| E1 | **Des dénombrements, jamais un lingot.** Aucun identifiant de barre, aucun nom de département. | la confidentialité client |
| E2 | **Une répartition par client**, et pas seulement un total. | une moyenne ne bouge pas quand un client sur vingt se dégrade, et l'on n'intervient pas auprès d'une moyenne |
| E3 | **Les deux axes séparés.** Les origines se partagent 100 % d'une ligne ; la couverture est un autre axe. | additionner les cinq colonnes n'aurait aucun sens |
| E4 | **Zéro n'est pas absence.** « 0,0 % » et « — » se distinguent. | un client sans aucune donnée ne doit pas passer pour irréprochable |
| E5 | **Les noms de clients réservés à l'exploitant.** | apprendre à un client qui d'autre est sur la plateforme n'est pas une fonctionnalité |
| E6 | **Une erreur de routage ne ressemble pas à une plateforme vide.** | le site rend 200 pour tout chemin inconnu |

### Spécification

**Accès — E5.** Deux droits distincts, portés par le compte. `counts` ouvre la
vue ; `tenants` y ajoute la répartition nominative par client. L'exploitant a
les deux, un client n'a ni l'un ni l'autre — la vue porte sur la *plateforme*,
donc sur les autres clients aussi. **Le refus vient du service**, pas de
l'écran : un compte sans droit reçoit `403` même en tapant l'adresse, et la page
se contente de le dire lisiblement.

**Ce que calcule `/api/v1/counts` — E1, E2.**

- `totals` — le nombre de cellules, d'entités et d'attestations ;
- `byOrigin` — le nombre de cellules par valeur d'`origin`, sur toute la
  plateforme ;
- `byOrganisation`, **seulement avec le droit `tenants`** — pour chaque
  organisation de tête : le nombre de cellules, leur répartition sur les quatre
  origines, et le nombre de cellules `MISSING`.

Le client d'une cellule est **la racine de son entité**, obtenue par une requête
récursive qui remonte l'arbre — conformément à la règle de `entity` : aucun
`tenant_id` n'est stocké.

**Ce qu'affiche la page — E3, E4, E6.**

- trois vignettes : cellules, entités, attestations ;
- un tableau des origines, en nombre et en part ;
- le tableau par client, dont l'en-tête **sépare** les quatre colonnes d'origine
  de la colonne de couverture ;
- une part vaut « — » quand le dénominateur est nul, et « 0,0 % » quand il ne
  l'est pas ;
- `NOT_MEASURED` et `MISSING` passent en couleur d'alerte **à partir de 10 %**
  de la ligne ; les trois autres origines ne sont jamais colorées ;
- avant de lire la réponse, la page vérifie qu'elle est du JSON : une page
  d'accueil rendue par erreur ne s'affiche pas comme une plateforme sans
  données.

**L'unité de compte est la cellule.** Chaque part est un rapport de nombres de
cellules ; une cellule y pèse un, quelle que soit l'émission qu'elle porte.

### Ce que la vue ne montre pas, délibérément

Aucune colonne `INCOMPLETE` — pour la raison donnée au paragraphe `coverage` :
sans intention de calcul stockée, ce serait une règle codée en dur présentée
comme un indice mesuré.
