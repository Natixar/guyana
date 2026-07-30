# Ce que nous préparons, pourquoi, et ce que nous attendons de vous

**Pour Svetlana Cranga · Engagement réciproque — projet Aurora (Guyana) · 29 juillet 2026**

*Préparé par Claude, relu et validé par Jean-Marc. Ce document engage les deux côtés : il dit ce que nous livrons et à quelle date, et ce dont nous avons besoin de vous pour que ce soit possible.*

---

## 1. Deux échéances, et une seule d'entre elles est contraignante

| | Contrat AGM / EU-LAC | Concours FIDES |
|---|---|---|
| Nature | **signé, contraignant**, 7 000 EUR conditionnés aux KPI | opportunité, gain espéré |
| Livrable | prototype de tableau de bord carbone sur un périmètre pilote | fiche publiée + attestation vérifiable |
| Échéance | rapport final **novembre 2026** | publication **20 août 2026**, prix le 15 septembre |
| Si on échoue | manquement contractuel | rien, sauf le temps dépensé |

**La règle que nous appliquons, et que nous vous demandons d'accepter :**

> **Si le contrat et FIDES se disputent le même temps, le contrat gagne.**

Ce n'est pas de la prudence de principe. C'est que le concours ne coûte presque rien **tant qu'il reste dans le recouvrement** décrit au §2 — et qu'il devient très coûteux dès qu'il en sort. Nous nous engageons à vous dire immédiatement si la frontière est franchie, plutôt qu'à découvrir en septembre que le tableau de bord a pris du retard.

---

## 2. Pourquoi FIDES ne nous coûte presque rien

Parce que ce que le concours récompense, **le contrat l'exige déjà**.

Le paquet de données AGM, feuillet « Use case list », décrit son cas d'usage n° 6 en ces termes :

> **UC-06 — Gold origin and carbon credential.** *Attach origin and cradle-to-gate carbon intensity to doré produced during the pilot window. Potential : verifiable carbon-per-ounce statement for buyers.* **SELECTED – light.** *Satisfies the Annex 2 traceability KPI (≥70 %) using data already produced ; low effort.*

C'est mot pour mot ce que FIDES publie. Le KPI n° 3 du contrat — couvrir 70 % du périmètre pilote en traçabilité — passe par cette attestation. **Nous ne construisons donc rien de nouveau pour le concours : nous exprimons différemment ce qui est déjà au périmètre.**

Trois décisions prises la semaine dernière rendent ce passage bon marché, et il vaut la peine de savoir pourquoi :

- nous avions déjà décidé d'enregistrer un **identifiant d'émetteur stable** — AGM nous a fourni son `did:web:guygold.com` et son LEI ;
- nous avions déjà décidé que la revendication serait **écrite dans un format figé et daté**, pour rester vérifiable dans dix ans ;
- nous avions déjà décidé **ce qui serait affirmé** : le tCO2e par once.

Il ne reste donc que l'emballage, qui est l'affaire de un à deux jours. Nous avions écarté cet emballage en jugeant qu'il n'était pas requis pour le contrat — c'était juste, et FIDES lui donne maintenant une raison d'être et une date.

---

## 3. Ce que nous livrons, et quand

| # | Livrable | Sert | Livré le |
|---|---|---|---|
| 1 | **L'attestation vérifiable** — origine signée par la mine, intensité carbone signée par nous, aux normes W3C | KPI 3 du contrat **et** FIDES | ~12 août |
| 2 | **La page de vérification publique** — on y dépose une attestation, elle est contrôlée sans nous appeler | FIDES *(le lien de votre fiche)* | ~12 août |
| 3 | **Le texte anglais de la fiche**, prêt à coller, en version nommée et anonymisée | FIDES | **fait — artéfact 1** |
| 4 | **Le dictionnaire des concepts et les réponses aux questions du jury** | vous, pour défendre le dossier | **fait — artéfact 1** |
| 5 | Le calcul carbone traçable, la réconciliation, la carte de chaleur, le tableau de bord | contrat, KPI 1, 2, 5 | septembre–novembre |

Les points 1 et 2 sont **le delta FIDES en entier**. Trois à quatre jours d'ingénierie, dont l'essentiel était de toute façon au programme.

**Ce que nous ne construisons pas, et pourquoi** : pas de portefeuille numérique, pas d'ancrage blockchain, pas d'intégration EUDI ou EBSI. Aucun n'est nécessaire pour concourir, et chacun coûterait plus que le prix ne vaut. Si le jury demande, la réponse est dans le §5 de l'artéfact 1.

---

## 4. Ce dont nous avons besoin de vous

Par ordre d'urgence. Les deux premiers sont bloquants — sans eux, il n'y a pas de dossier FIDES du tout, et il n'y a pas non plus de KPI n° 3.

### ⛔ 1. L'accord écrit d'AGM sur la publication — avant le 15 août

Le paquet de données porte la mention *« Confidential Information under Clause 9 of the Collaboration Agreement »*. **Nommer AGM, la mine Aurora ou Zijin dans une publication publique est une divulgation.** Il faut un accord écrit.

L'artéfact 1 contient deux versions de la fiche : nommée et anonymisée. Si l'accord n'est pas obtenu le 15 août, on publie l'anonymisée. **Ne pas attendre le 19 pour trancher.**

### ⛔ 2. Le registre de coulée — G-01, relance immédiate

L'attestation porte sur des lingots réels : date de coulée, identifiant, poids, titre. Ces données attendent l'accord du Gold Room, du juridique et de la sécurité d'AGM. Elles figurent dans le tracker sous la référence **G-01**, en attente.

**Sans registre de coulée, il n'y a rien à attester.** Ni pour le concours, ni pour le KPI n° 3 du contrat. C'était déjà la relance la plus urgente du dossier ; elle l'est doublement maintenant. La chaîne d'approbation est longue : elle doit partir cette semaine, même si tout le reste attend.

### 3. Les user stories, sous forme de maquettes Figma

Enchaînez les écrans dans l'ordre où l'utilisateur les voit, en disant à chaque étape qui il est et ce qu'il cherche à obtenir. C'est la première tâche de la phase 1 du contrat — *« Pilot perimeter and use-case definition »* — et c'est ce qui nous manque pour prioriser le développement.

### 4. Les sept questions sur les données

Envoyées séparément. La question 1 — avons-nous les fichiers sources eux-mêmes, ou seulement le paquet rempli ? — peut supprimer la moitié des autres.

### 5. La mobilisation pour le vote, à partir du 22 août

Le vote communautaire pèse **50 % du résultat final**. Le catalogue contient des organisations comptant des dizaines de millions d'utilisateurs. C'est le poste où votre travail vaut plus que toute notre technique, et c'est aussi celui où nous ne pouvons rien pour vous.

---

## 5. Ce qui peut mal tourner, dit franchement

| Risque | Probabilité | Ce qu'on fait |
|---|---|---|
| **G-01 n'arrive pas à temps** | réelle — chaîne d'approbation longue | l'attestation peut être démontrée sur un jeu de données au bon format, marqué comme tel. Le dossier reste honnête ; il perd en force |
| **AGM refuse d'être nommé** | possible | version anonymisée, déjà rédigée |
| **Jean-Marc est injoignable à partir du 5 août** | certaine | le texte de la fiche doit être validé avant son départ. Nous ne publierons rien en son absence sans validation préalable |
| **Le vote communautaire nous défavorise** | forte | c'est structurel : nous n'avons pas de base d'utilisateurs. Nous concourons sur l'originalité, pas sur l'échelle. L'Impact Award n'est pas visé |
| **Le delta FIDES déborde sur le contrat** | à surveiller | nous vous prévenons immédiatement et nous abandonnons FIDES, pas le contrat |

Un mot sur le dernier point, parce qu'il est le seul que nous contrôlons entièrement : nous préférons vous dire « nous arrêtons FIDES » à la mi-août plutôt que vous annoncer en octobre que le tableau de bord a glissé. Si nous vous le disons, ce ne sera pas un désaveu du concours — ce sera l'application de la règle que nous avons posée ensemble au §1.

---

## 6. Ce sur quoi nous nous engageons

- Livrer les points 1 et 2 du §3 **pour le 12 août**, soit huit jours avant votre date limite.
- Vous fournir un texte que vous pouvez défendre **sans nous**, ce qui est l'objet de l'artéfact 1.
- Vous dire **immédiatement**, et pas après coup, si FIDES commence à coûter au contrat.
- Ne rien publier, ne rien envoyer à AGM ou à un tiers en votre nom ou en celui de Jean-Marc sans validation explicite.

## 7. Ce sur quoi nous vous demandons de vous engager

- Obtenir l'accord d'AGM, ou trancher pour la version anonymisée, **avant le 15 août**.
- Relancer G-01 **cette semaine**, indépendamment du reste.
- Publier la fiche **avant le 20 août** — rien ne se rattrape après.
- Porter le vote communautaire à partir du 22 août.
- Nous dire tôt si quelque chose ne tient pas, plutôt que de tenir bon toute seule.
