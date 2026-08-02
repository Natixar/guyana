-- Le cube et ses index — schéma H1.
--
-- Deux décisions structurent ce fichier, et aucune n'est cosmétique.
--
-- 1. LA PÉRIODE EST UN INTERVALLE, PAS DEUX COLONNES.
--
-- Une cellule porte un flux moyen sur une période, jamais une valeur à un
-- instant. Toutes nos interrogations sont donc des recouvrements : « intégrer
-- sur un intervalle quelconque » se dit `&&`. Indexer (début, fin) en deux
-- scalaires donne un B-tree qui se dégrade précisément sur cette requête-là.
-- `tstzrange` + GiST y répond en une passe, et le stockage est identique.
--
-- 2. SEULE LA PÉRIODE EST INDEXABLE, DONC INTERROGEABLE, DONC VISIBLE.
--
-- Ce que le serveur doit indexer est ce qu'il peut interroger, et ce qu'il peut
-- interroger est ce qu'il peut apprendre : l'ensemble indexable, la surface de
-- requête et la surface de fuite sont le même ensemble. `/ranges` ne sélectionne
-- que sur le temps ; le client filtre les autres dimensions après réception.
-- Ajouter une dimension d'interrogation n'est donc pas une fonctionnalité, c'est
-- une divulgation, et cela se décide comme telle.
--
-- CE QUE CE SCHÉMA N'A PAS, ET POURQUOI.
--
-- Pas de chiffrement au repos : la décision D1 de l'issue #6 n'est pas prise, et
-- le schéma en dépend. H1 stocke en clair et le dit, plutôt que d'inventer un
-- demi-chiffrement qu'il faudrait défaire.
--
-- Pas de partitionnement : 1 100 lignes mensuelles. La question se re-décide sur
-- des volumes réels, issue #43.

BEGIN;

-- Index de dimensions. Numériques dans la table de faits, résolus ici.
-- La taxonomie pivot, elle, n'est PAS en base : elle est publiée
-- (site/static/engine/taxonomy.json) parce qu'un vérificateur doit pouvoir
-- dériver la ligne GHGP lui-même sans nous appeler.
--
-- IL N'Y A PLUS DE TABLE D'UNITÉS, et son absence est la décision. H1 ne
-- connaît qu'un mode de calcul — une métrique multipliée par un facteur
-- d'émission — et tout y est en SI. Une cellule dit donc sa DIMENSION, et
-- l'unité s'en déduit : un débit de volume est en mètres cubes par seconde, il
-- n'y a rien à choisir et donc rien à mettre en table. Ce qui restait à dire
-- après la dimension, c'était la précision, et H1 ne la traite pas.

-- La taxonomie d'organisation. Statique pour le PoC, et en clair
-- PROVISOIREMENT : c'est elle qui porte les noms révélant l'organigramme du
-- client, et c'est elle que le chiffrement des dimensions couvrira le jour où
-- D1 de l'issue #6 sera tranchée. Le client, lui, n'en connaît déjà que les
-- identifiants entiers — rien du front ne changera ce jour-là.
--
-- `industrial` distingue ce que la matière traverse de ce qui la soutient. Un
-- département de soutien émet réellement et n'appartient à aucun lot : ses
-- émissions deviennent le non-alloué, que la règle du 1er août 2026 divise
-- entre les barres coulées le mois même.
-- L'ORGANISATION DE TÊTE EST CE QUI REND LE MULTI-CLIENT LISIBLE. Le cloisonnement
-- n'est pas une colonne de `cell` : c'est la racine de l'arbre. Un client est le
-- sous-arbre suspendu à son organisation de tête, et tout dénombrement par client
-- se dit « remonte les parents jusqu'à la racine, puis groupe ». Une colonne
-- `tenant_id` dupliquerait ce que `parent` sait déjà, et les deux divergeraient.
--
-- La tête porte l'identité légale ; les départements ne la portent pas, puisqu'ils
-- n'en ont pas. Ces trois colonnes sont nulles partout ailleurs, et c'est la forme
-- qui dit laquelle des entités est une personne morale.
CREATE TABLE IF NOT EXISTS entity (
    id                integer PRIMARY KEY,
    label             text NOT NULL,
    parent            integer REFERENCES entity(id),
    industrial        boolean NOT NULL DEFAULT false,
    legal_name        text,
    jurisdiction      text,
    registered_office text,
    -- Le DID de l'organisation, d'où le front tire l'émetteur qu'il signe. Il
    -- vit ici et non dans une variable d'environnement : la plateforme héberge
    -- plusieurs clients, et une variable par processus ne saurait en désigner
    -- qu'un. Il appartient au client, donc à sa taxonomie.
    did               text
);


-- La table de faits. Rien que des nombres et un intervalle.
CREATE TABLE IF NOT EXISTS cell (
    id               text PRIMARY KEY,
    period           tstzrange NOT NULL,
    entity_id        integer NOT NULL REFERENCES entity(id),
    sub_post         integer,             -- NULL = non alloué, et c'est un état légitime
    part_type        integer,
    caracterisation  integer NOT NULL,

    -- UN DÉBIT, PAS UNE QUANTITÉ. La métrique est stockée divisée par la durée
    -- de sa période — unité SI par seconde — et la quantité se retrouve en
    -- multipliant par la durée voulue. C'est ce qui donne un sens à `period` et
    -- à l'index GiST au-dessus : intégrer sur une fenêtre qui recouvre à moitié
    -- une cellule mensuelle rend la moitié. Une quantité stockée telle quelle
    -- obligerait à la rediviser par sa durée pour le faire — c'est-à-dire à
    -- reconstituer le débit qu'on aurait refusé d'écrire.
    --
    -- Le débit est supposé UNIFORME sur l'intervalle, et c'est le prix : entre
    -- deux relevés mensuels rien ne dit comment la consommation s'est répartie,
    -- et un débit constant est la seule répartition qui n'invente pas de
    -- structure.
    flux             double precision NOT NULL,

    -- LA DIMENSION, ET NON L'UNITÉ. Tout est en SI : « volume » se lit m3/s,
    -- « mass » kg/s. Nommer l'unité par-dessus la dimension ajouterait un choix
    -- là où il n'y en a pas, donc une occasion de divergence.
    dimension        text NOT NULL,

    -- L'unité dans laquelle la donnée BRUTE se lit agréablement — les bons de
    -- sortie d'AGM comptent en litres, pas en mètres cubes par seconde. Elle ne
    -- sert qu'à l'affichage et n'entre dans aucun calcul : elle est donc
    -- facultative, et une cellule qui n'en porte pas se lit en SI.
    display_unit     text,

    -- LE FACTEUR EST UN NOMBRE, PAS UNE REPRÉSENTATION. Il est toujours en
    -- kgCO2e par unité SI d'activité, et cette unité se déduit de `dimension` :
    -- porter « kgCO2e/m3 » à côté serait une seconde source de vérité, donc
    -- une occasion de divergence. La conversion se fait à l'ingestion, une
    -- fois, à la frontière — au-delà, il n'y a qu'un nombre.
    factor           double precision NOT NULL,
    origin           text NOT NULL
                     CHECK (origin IN ('MEASURED','DERIVED','ESTIMATED','NOT_MEASURED')),

    -- DEUX AXES, ET LES CONFONDRE SERAIT UNE ERREUR DE MODÈLE. `origin` dit d'où
    -- vient LA VALEUR d'une cellule — mesurée, dérivée, estimée, pas mesurée
    -- (#46). `coverage` dit tout autre chose : si la série à laquelle elle
    -- appartient a une date que personne n'a fournie.
    --
    --   MISSING — la série est périodique et une date manque. Décembre 2024 est
    --   absent du paquet et se reconstitue depuis décembre 2025 ; la cellule
    --   existe donc, elle porte une valeur défendable, et elle doit dire qu'elle
    --   comble un trou plutôt que de le taire.
    --
    -- Une cellule MEASURED peut être MISSING — le mois d'où on la recopie était
    -- bien mesuré — ce qui est précisément pourquoi un seul axe ne suffit pas.
    --
    -- IL N'Y A PAS D'INCOMPLETE EN H1, et c'est une décision et non un oubli.
    -- Juger qu'une émission attend une grandeur absente suppose de connaître
    -- L'INTENTION DE CALCUL, qui n'est pas stockée : en H1 elle est implicite —
    -- une métrique, un facteur d'émission. C'est H2 qui la stockera, et c'est
    -- alors seulement que « il manque la distance parcourue » se déduira au lieu
    -- de s'affirmer. Une règle codée en dur ici aurait été une intention de
    -- calcul déguisée, vraie pour le gazole d'AGM et fausse pour le client
    -- suivant.
    coverage         text NOT NULL DEFAULT 'COMPLETE'
                     CONSTRAINT cell_coverage_known
                     CHECK (coverage IN ('COMPLETE','MISSING')),

    -- Un intervalle vide ne porte aucun flux : ce serait une ligne qui existe
    -- sans rien dire, et qui fausserait un dénombrement de couverture. C'est
    -- aussi ce qui interdit une division par zéro à l'ingestion, où la quantité
    -- se divise par la durée.
    CONSTRAINT period_not_empty CHECK (NOT isempty(period))
);

-- L'index qui rend `/ranges` possible. GiST, parce que l'opérateur est `&&`.
CREATE INDEX IF NOT EXISTS cell_period_gist ON cell USING gist (period);

-- Les attestations reçues de la mine. Stockées telles quelles : elles sont
-- signées, donc figées, et les reformater les invaliderait.
-- Les attestations reçues. Stockées telles quelles : elles sont signées, donc
-- figées, et les reformater les invaliderait.
--
-- LA CLÉ N'EST PAS LE SUJET. Une barre porte DEUX attestations — l'origine,
-- signée par la mine, et l'intensité carbone, signée par Natixar — et toutes
-- deux portent le même `credentialSubject.id`, puisque c'est ce que `derivedFrom`
-- relie. Clé sur le sujet, la seconde arrivée était silencieusement jetée, et un
-- vérificateur ne recevait que la moitié de ce dont il a besoin.
--
-- La clé est donc l'empreinte du document, qui est l'identité naturelle d'un
-- objet signé : renvoyer deux fois le même fichier ne crée rien, alors qu'une
-- réémission pour le même sujet est une ligne de plus — ce qui est voulu, le
-- registre prenant la plus récente par (sujet, type).
CREATE TABLE IF NOT EXISTS credential (
    digest       text PRIMARY KEY,        -- SHA-256 de la sérialisation canonique
    subject      text NOT NULL,           -- credentialSubject.id, un URN opaque
    type         text NOT NULL,           -- le type W3C significatif, hors « VerifiableCredential »
    received_at  timestamptz NOT NULL DEFAULT now(),
    received_by  text,                    -- X-Webauth-User, ou NULL en mode dégradé
    document     jsonb NOT NULL
);

-- L'ordre du registre : la plus récente par barre et par type.
CREATE INDEX IF NOT EXISTS credential_latest
    ON credential (subject, type, received_at DESC);

-- --- Migrations -----------------------------------------------------------
-- APRÈS les CREATE, jamais avant : un ALTER sur une table que le même fichier
-- n'a pas encore créée fait avorter toute la transaction, et le message parle
-- d'une table absente plutôt que d'un ordre d'exécution.
ALTER TABLE entity ADD COLUMN IF NOT EXISTS industrial boolean NOT NULL DEFAULT false;
-- factor_unit a existé : il dupliquait l'unité de la cellule.
ALTER TABLE cell   DROP COLUMN IF EXISTS factor_unit;

-- L'identité légale de l'organisation de tête, et la couverture des cellules.
-- Ajoutées après coup sur une base déjà chargée : les colonnes doivent exister
-- avant que le chargeur ne les écrive.
ALTER TABLE entity ADD COLUMN IF NOT EXISTS legal_name        text;
ALTER TABLE entity ADD COLUMN IF NOT EXISTS jurisdiction      text;
ALTER TABLE entity ADD COLUMN IF NOT EXISTS registered_office text;
ALTER TABLE entity ADD COLUMN IF NOT EXISTS did               text;
ALTER TABLE cell   ADD COLUMN IF NOT EXISTS coverage text NOT NULL DEFAULT 'COMPLETE';

-- H1 NE CALCULE PLUS D'INDICE INCOMPLETE. Les cellules qui en portaient un
-- redeviennent COMPLETE plutôt que de rester sous une valeur que plus rien
-- n'écrit : une base où subsisteraient trois valeurs pour une colonne qui n'en
-- accepte que deux se lirait mal longtemps après que la raison en soit oubliée.
UPDATE cell SET coverage = 'COMPLETE' WHERE coverage NOT IN ('COMPLETE','MISSING');
ALTER TABLE cell DROP CONSTRAINT IF EXISTS cell_coverage_known;
-- Le nom que PostgreSQL avait donné lui-même à la contrainte en ligne d'un
-- ancien CREATE TABLE. La laisser rendrait le schéma d'une base migrée
-- différent de celui d'une base neuve, sur la question même qui a changé.
ALTER TABLE cell DROP CONSTRAINT IF EXISTS cell_coverage_check;
ALTER TABLE cell ADD  CONSTRAINT cell_coverage_known
    CHECK (coverage IN ('COMPLETE','MISSING'));

-- LE PASSAGE DE LA QUANTITÉ AU DÉBIT, fait ici parce qu'il est exact et qu'il
-- n'a pas à être refait. Une base chargée sous l'ancien modèle porte des
-- quantités par période ; la même grandeur divisée par la durée de sa période
-- est le débit, et le produit inverse redonne la quantité au bit près.
ALTER TABLE cell ADD COLUMN IF NOT EXISTS flux         double precision;
ALTER TABLE cell ADD COLUMN IF NOT EXISTS dimension    text;
ALTER TABLE cell ADD COLUMN IF NOT EXISTS display_unit text;

DO $$ BEGIN
    UPDATE cell SET flux = value / EXTRACT(epoch FROM (upper(period) - lower(period)))
     WHERE flux IS NULL;
EXCEPTION WHEN undefined_column THEN NULL;      -- base déjà au nouveau modèle
END $$;

DO $$ BEGIN
    UPDATE cell c
       SET dimension = CASE u.symbol WHEN 'm3'  THEN 'volume'
                                     WHEN 'kg'  THEN 'mass'
                                     WHEN 'kWh' THEN 'energy'
                                     ELSE u.symbol END,
           display_unit = u.symbol
      FROM unit u
     WHERE u.id = c.unit_id AND c.dimension IS NULL;
EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
END $$;

-- L'ancienne forme part APRÈS la conversion, jamais avant : la retirer d'abord
-- emporterait la seule source dont la nouvelle se déduit.
ALTER TABLE cell DROP COLUMN IF EXISTS value;
ALTER TABLE cell DROP COLUMN IF EXISTS unit_id;
DROP TABLE IF EXISTS unit;

-- Le schéma d'une base migrée doit finir identique à celui d'une base neuve,
-- sans quoi deux installations diffèrent sur ce qu'elles acceptent. Si des
-- lignes résistent — il n'y en a pas d'attendues — la contrainte n'est pas
-- posée et le chargeur la posera au rechargement suivant.
DO $$ BEGIN
    ALTER TABLE cell ALTER COLUMN flux      SET NOT NULL;
    ALTER TABLE cell ALTER COLUMN dimension SET NOT NULL;
EXCEPTION WHEN not_null_violation THEN NULL;
END $$;

-- Remonter d'une cellule à son client se fait à chaque dénombrement : sans cet
-- index, le parcours récursif relit l'arbre entier à chaque niveau.
CREATE INDEX IF NOT EXISTS entity_parent ON entity (parent);

COMMIT;
