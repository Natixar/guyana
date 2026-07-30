Svetlana,

Jean-Marc m'a dit votre inquiétude sur le délai, et je voulais vous écrire directement. J'ai passé la journée dans la spécification, puis dans l'annexe 2 du contrat, et je crois que la situation est nettement meilleure que ce qu'elle paraît.

**Le contrat demande beaucoup moins que ce que nous imaginions.**

J'ai relu l'annexe 2 ligne à ligne. Trois phrases méritent d'être relues à tête reposée, parce qu'elles définissent le périmètre réel :

- « **within a controlled pilot perimeter** […] rather than a full-site deployment » — un périmètre choisi, pas toute la mine ;
- « The PoC will combine available real operational data with **simulated or manually completed datasets** where live integration is not yet available » — les données peuvent être saisies à la main, c'est écrit noir sur blanc ;
- « offline batch calculations will be used for datasets that are not yet digitally connected » — aucune obligation de temps réel.

Le livrable est **un prototype de tableau de bord** sur un périmètre restreint. Ce n'est pas une plateforme complète en production.

Et un point qui va peut-être vous surprendre : **la blockchain n'apparaît dans aucun des cinq KPI.** Le KPI de traçabilité demande de couvrir 70 % du périmètre choisi en captant les événements de flux matière — c'est-à-dire d'enregistrer les étapes, pas de les inscrire sur une chaîne. C'est une décision que nous avons prise pour d'autres raisons, mais elle n'est pas ce qui nous est contractuellement demandé, et elle ne doit donc pas se mettre en travers de l'échéance.

**Ce qui fait peur n'est pas ce qui coûte cher.**

Ce que nous demanderons à la blockchain tient en une phrase : écrire trente-deux octets et prouver une date. Aucune donnée métier ne va dessus — ni les prix, ni les quantités, ni les contreparties. Le coût annuel se compte en centaines d'euros.

L'authentification, nous ne l'écrivons pas, nous l'achetons — en version hébergée, donc sans même un serveur à installer. Ce que Jean-Marc avait préparé en 2023 est encore utilisable.

Le vrai travail est le calcul carbone et la reprise des données de la mine, et il est déjà cartographié : la spécification a été auditée écran par écran, quarante-cinq points sont recensés avec leurs dépendances, et les décisions d'architecture qui bloquaient tout ont été prises ce matin.

**Sur les cinq KPI, deux seulement sont du logiciel.**

Précision des données et taux d'intégration : c'est notre affaire. Mais l'identification des points chauds d'émissions est une analyse, la couverture de traçabilité est d'abord une définition de périmètre, et la validation utilisateur est un atelier.

Ce dernier point mérite d'être dit clairement : **le KPI « User Validation » est votre domaine, et c'est un engagement contractuel au même titre que les autres.** Un atelier, au moins trois interlocuteurs AGM, un retour structuré sur l'utilisabilité et la pertinence. Le travail que vous faites sur Figma n'est pas de l'accompagnement — c'est un livrable du contrat.

**Ce dont j'ai besoin de vous, et pourquoi.**

Le document de cas d'usage qui a circulé répondait à la question « comment réutiliser au maximum la blockchain existante ». C'est une question d'ingénieur, et elle vient trop tôt. La phase 1 du contrat en pose une autre, beaucoup plus simple, et c'est vous qui avez la réponse :

> **Qui utilise l'outil, qu'est-ce qu'il cherche à obtenir, et par quels écrans passe-t-il pour y arriver ?**

C'est mot pour mot ce que l'annexe 2 appelle *« Pilot perimeter and use-case definition »*, et c'est la toute première tâche du plan d'exécution.

Vous n'avez aucun document technique à rédiger. **Enchaînez les écrans dans Figma, dans l'ordre où l'utilisateur les voit**, et dites-nous à chaque étape qui il est et ce qu'il essaie de faire. C'est exactement ce qu'on appelle une user story, et c'est le format dont nous avons besoin — vous avez déjà l'outil et vous le maîtrisez mieux que nous. Une maquette dans le bon ordre vaut trente pages de spécification.

À côté de ça, quatre choses de la réunion de ce matin, par ordre d'urgence :

1. **Les liens GitHub et les cas d'usage** — sans eux nous ne pouvons pas prioriser le développement (A2)
2. **Les accès GitHub**, et la vérification du compte `S-Kranga16` (A10)
3. **Les données de la mine** — quelles sources existent réellement, sous quelle forme, et à quelle fréquence. Le KPI n°2 demande d'en connecter au moins deux en couvrant 80 % des champs convenus : c'est ce chiffre qui décide du périmètre (A3)
4. **Le contrat** — reçu, je l'ai lu, merci (A1)

Le point 1 débloque tous les autres. S'il vous est plus facile de le raconter à l'oral plutôt que de l'écrire, faites-le : Jean-Marc me le transmettra et je le mettrai en forme.

**Une dernière chose, de la part de Jean-Marc :** mettez vos autres activités en pause. Nous allons avoir besoin de tout le monde, et une attention partagée sur cette période coûterait plus cher que le temps qu'elle ferait gagner.

Vous n'êtes pas en retard. Nous savons où nous allons, le contrat demande moins que ce que nous redoutions, et la partie qui vous revient — donner à voir le parcours utilisateur, et porter l'atelier de validation — est à la fois celle qui manque pour lancer le reste et l'un des cinq critères de succès.

À très vite,

**Claude**
*assistant technique de Jean-Marc — Projet Guyana*
