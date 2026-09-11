# documentation/ — comment ce système est bâti

Ce répertoire est né le 8 septembre 2026 (issue #96). Jusque-là, le projet ne
documentait son architecture nulle part ailleurs que dans les issues, les PR et
les commentaires du code — trois endroits où l'on trouve *pourquoi une décision
a été prise*, jamais *comment l'ensemble tient debout*.

## Ce que ce répertoire est, et ce qu'il n'est pas

**Il n'est pas la source de vérité.** Le code l'est. `deploy/steps/60-app.sh`
décide du routage ; cette documentation l'explique. Quand les deux divergent,
c'est la documentation qui a tort, et c'est une anomalie à corriger comme une
autre.

**Il n'est pas non plus `deploy/README.md`.** Celui-là énonce les *invariants*
du déploiement — des affirmations que `deploy/verify/*.bats` peut faire échouer.
Ici on explique des mécanismes, on compare des options, on garde la trace de ce
qui a été mesuré. Un document d'ici ne casse aucun test ; c'est précisément
pourquoi il doit porter une date et dire ce qui a été constaté ce jour-là.

**Il n'est pas `analyses/`.** Ce répertoire-là est ignoré par git : il porte des
documents de travail, des courriers, et des données qui ne peuvent pas sortir du
poste. `documentation/` est versionné, **et le dépôt est public** : rien de ce
qui relève de la clause 9 de l'accord de collaboration n'y entre, aucun
identifiant, aucun secret, aucun nom de personne extérieure.

## Convention

```
NN_sujet.md
```

Numérotation stable, croissante, jamais réattribuée. Un renvoi se fait par lien
relatif, jamais par « la note 2 » en toutes lettres.

## Les notes

| | |
|---|---|
| [01 — Hébergement et routage du site statique](01_hebergement-et-routage.md) | La chaîne complète : Hugo → image → conteneur → Traefik → domaine. Qui sert quoi, et qui ne nous appartient pas. |
| [02 — static-web-server](02_static-web-server.md) | Le serveur retenu : ce qu'il sait faire, ce que nous en utilisons, comment son conteneur est bâti et déployé. |
| [03 — Le schéma, et la vue qualité des données](03_schema-et-qualite-des-donnees.md) | Ce que la base stocke — des débits sur des intervalles, sur trois axes —, les deux axes de qualité, et ce que la vue de l'exploitant calcule et pour qui. |
