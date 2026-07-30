Svetlana,

J'ai chargé et agrégé le paquet de données AGM. Les totaux tiennent : 52 609 061 litres de gazole sur 2025, cohérents avec les 52,6 M L du rapport de durabilité, et le contrôle de janvier du feuillet 9 boucle à −0,16 % contre le registre GHG d'AGM.

Une précision pour éviter un malentendu, parce que ce chiffre est facile à surinterpréter : **ce n'est pas le KPI n°1.** Il compare le jeu de données d'AGM au propre calcul d'AGM, dans un tableur. Le KPI, lui, se mesure entre les valeurs calculées par AGM et celles que produira l'outil — qui n'existe pas encore. Ce contrôle nous dit seulement que les litres et le facteur sont cohérents entre eux, donc que le KPI n'est pas hors d'atteinte pour une raison de données. C'est rassurant, ce n'est pas une preuve.

Et en essayant de répartir ces litres entre les cas d'usage carbone, je bute sur une difficulté de structure qui demande des réponses d'AGM plutôt que du développement.

**Le problème, en une phrase.** Les consommations sont relevées **par entité** — département, centre de coût, contractant. La production est relevée **par étape de procédé** — tonnes extraites, tonnes broyées, onces coulées. Rien ne relie les deux. Une entité peut intervenir à plusieurs étapes, et nous n'avons aucune description de ce que chaque entité fait réellement. Sans ce lien, nous pouvons calculer un total juste, mais pas dire quelle part revient au roulage, au broyage ou à la production d'électricité — c'est-à-dire pas produire le KPI n°5 (points chauds), qui est le livrable que le client regardera.

Concrètement, il n'existe aucune ligne « Haulage » dans les données, alors que le roulage est un cas d'usage retenu en P0.

---

### Question 1 — la plus importante, car elle peut rendre les autres inutiles

Le tracker indique à la ligne D-02 : *« Fuel Report 2025.xlsx supplied. **Equipment-level transactions retained in source file.** »*

**Avons-nous le fichier source lui-même, ou seulement le paquet rempli ?**

Le paquet agrège par département. Le fichier source contiendrait, si je comprends bien, chaque transaction de carburant avec son **identifiant d'équipement**. Or nous avons par ailleurs un registre de 592 équipements avec leur classe et leur zone d'affectation. Équipement + classe, c'est l'activité — et l'attribution se fait alors par calcul, sans demander à personne de trancher.

Même question pour les autres fichiers cités dans le tracker : `Diesel 2025(2).xlsx`, `Gasoline 2025(2).xlsx`, `Bulk Emulsion 2025(2).xlsx`, `Magnafrag & IBGEL 2025(2).xlsx`, `GHG Data(3).xlsx`, les rapports trimestriels et le rapport de durabilité. Si ces fichiers sont déjà chez nous, dites-le moi et je les traite ; s'ils sont chez AGM, il faut les demander.

### Question 2 — que fait chaque entité ?

Si la question 1 n'aboutit pas, il faut qu'AGM nous dise, en une ligne par entité, à quelle activité elle correspond : production d'électricité · roulage et chargement · forage et minage · broyage et traitement · mine souterraine · travaux de construction · support, camp, administration · logistique carburant.

Il y a 34 entités, mais cinq représentent 90 % du volume. Par ordre d'urgence :

| Entité | Part 2025 |
|---|---|
| Power Generation | 45,1 % |
| **Sinohydro** | **20,5 %** |
| UG-Power Gen | 14,0 % |
| Mobile Maintenance | 6,3 % |
| UG-Mining (GMYM) | 3,9 % |

Puis, si possible : Buckhall, BH Road Maint, BH Contractor – Ping An, Fuel transport DTL et SIR, Construction.

### Question 3 — Sinohydro : exploitation ou travaux ?

C'est la question qui a le plus d'effet sur le chiffre final. **Sinohydro consomme un cinquième du gazole du site.** Selon la réponse, ce carburant relève de deux catégories très différentes :

- s'il sert à **exploiter** la mine (déplacer du minerai ou du stérile), il entre dans l'intensité carbone par once ;
- s'il sert à **construire** des installations, il reste une émission du site en 2025, mais l'imputer aux onces produites cette année fausse l'indicateur — l'ouvrage servira les années suivantes.

L'écart entre les deux traitements est de l'ordre de **20 % sur le carbone par once**. Il faut donc savoir précisément ce que fait Sinohydro, et la même question vaut pour la ligne « Construction ». Ce n'est pas un détail comptable : c'est le genre d'écart qu'un auditeur relève.

### Question 4 — le registre d'équipements est-il exploitable ?

Le feuillet 4 comporte 592 identifiants, avec des colonnes Classe, Modèle, Année, Puissance et **Zone / centre de coût affecté**. Le tracker note que l'année, la puissance et le statut restent à valider par la Maintenance.

- 4a. La colonne **Classe** est-elle renseignée pour les 592 identifiants, ou seulement pour une partie ? Quelles valeurs utilise-t-elle ?
- 4b. La colonne **Zone / centre de coût** reprend-elle exactement les noms de départements du feuillet 3 ? Si oui, c'est le pont qui nous manque.
- 4c. Des équipements ont-ils changé de département en cours d'année ?

### Question 5 — le broyeur tourne à l'électricité, pas au gazole

Les lignes « Mill General Ops » et « Mill Maintenance » totalisent moins de 1 % du gazole. J'en déduis que le broyeur est alimenté par l'électricité produite sur site, et que son empreinte passe donc par la production d'électricité.

Si c'est exact, cela pose une difficulté qui ressemble à la première, mais sur un poste encore plus gros : **pour donner un carbone par tonne broyée, il faut savoir quelle part de l'électricité produite va au broyeur**, par rapport au camp, à l'exhaure et à la mine souterraine. Or le tracker enregistre ce comptage divisionnaire comme **NON MESURÉ** (ligne E-04).

Deux issues, et la seconde est peu coûteuse :

- 5a. Existe-t-il un comptage divisionnaire quelque part, même partiel ?
- 5b. **Sinon : certains groupes électrogènes sont-ils dédiés à une charge précise** — broyeur, camp, souterrain ? Le modèle du feuillet 5 prévoit une colonne « Load served (area) ». Si les groupes sont dédiés, la répartition se déduit du carburant par groupe, sans aucun compteur à installer. Ce serait la réponse la plus économique du dossier.

### Question 6 — les trois demandes déjà ouvertes

Pour mémoire, elles restent bloquantes et sont indépendantes des précédentes :

- **E-01 / E-02** — kWh produits et heures de marche par groupe électrogène. Sans elles, 59 % de l'empreinte est chiffrable mais pas optimisable, et les leviers de décarbonation sur le plus gros poste ne peuvent pas être quantifiés.
- **H-01** — l'écart de **−4,30 %** entre le registre GHG (87 215,058 tCO2e sur janvier-août) et le rapport de durabilité (91 135 tCO2e). C'est un écart interne à AGM, mais le KPI n°1 exige « aucune divergence critique affectant l'interprétation », donc il faut l'expliquer avant la revue.
- **G-01 / G-02** — registres de coulée et d'export, en attente d'accord du Gold Room, du juridique et de la sécurité. C'est le seul KPI dont les données ne sont pas en main, et la chaîne d'approbation est longue : à relancer maintenant même si le reste n'avance pas.

### Question 7 — des données factices au bon format, pour ne pas attendre

Jean-Marc soulève un point qui change le rythme du projet : **nous n'avons pas besoin des vraies données pour commencer à développer, seulement de leur forme.** Si l'accès aux fichiers réels prend des semaines d'approbations, un jeu factice au bon format nous laisse construire pendant ce temps, et il suffira ensuite de substituer les vrais.

Mieux : nous pouvons le fabriquer nous-mêmes. Les six modèles du paquet donnent déjà les colonnes exactes, et les données déjà remplies donnent les ordres de grandeur. Ce que nous ne pouvons pas inventer, c'est la **forme des réponses** aux questions 1 à 5 — et c'est peu de chose :

- la liste des valeurs employées dans la colonne **Classe** du registre d'équipements (une dizaine de termes suffit) ;
- un **exemple de dix lignes** du fichier source de carburant, avec ses vraies colonnes, valeurs anonymisées si nécessaire ;
- la liste des **identifiants de groupes électrogènes** et, s'il y a lieu, la charge qu'ils desservent.

Avec ça, nous générons le reste. Une précaution, que nous prenons de notre côté : toute donnée factice sera **marquée comme telle de bout en bout** dans l'outil, pour qu'elle ne puisse jamais se retrouver mêlée à un chiffre présenté au client.

---

Les questions 1, 5b et 7 sont celles qui rapportent le plus par rapport à l'effort demandé : la première peut supprimer la moitié des autres, la deuxième évite d'installer des compteurs, la troisième nous permet d'avancer sans attendre.

Si l'atelier de cadrage de la semaine 1 n'est pas encore calé, ces six points en constituent l'ordre du jour naturel — ils correspondent exactement à ce que le contrat appelle *« Pilot perimeter and use-case definition »* et *« Data and systems mapping »*.

Bien à vous,

**Claude**
*assistant technique de Jean-Marc — Projet Guyana*
