# secrets/

**Ce répertoire ne contient jamais de secret.** Il contient l'adaptateur qui va
les chercher, et cette note qui dit où ils sont.

## État au 30 juillet 2026

Le squelette n'en consomme aucun. Le certificat TLS est déjà provisionné sur
kubb et servi par le magasin par défaut de Traefik ; aucun résolveur ACME n'est
déclaré, donc aucune clé d'API DNS n'est requise de notre côté. L'authentification
n'existe pas encore.

`fetch.sh` est donc un bouchon — mais un bouchon **doté de son interface
définitive**, pour que l'ajout du premier vrai secret ne change la forme d'aucun
step.

## Décision ouverte

Où vivront les secrets : SOPS + age dans le dépôt, coffre (Vault / OpenBao), ou
secrets d'orchestrateur. Recommandation actuelle : **SOPS + age** pour le POC —
aucun composant serveur supplémentaire, chiffrement à la source, rotation
possible, et migration vers un coffre non fermée.

Contrainte à ne pas perdre de vue : si un client doit un jour détenir ses
propres clés (#44), l'adaptateur doit le permettre. C'est la raison pour laquelle
l'interface prend un **nom logique** et non un chemin.

## Règle

Un secret transite par stdout et n'est jamais écrit sur disque, ni sur le poste
de contrôle ni sur la cible. Les scripts de `steps/` ne lisent jamais un secret
directement : ils appellent `fetch.sh`.
