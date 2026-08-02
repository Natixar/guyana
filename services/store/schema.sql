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

-- Les unités d'activité. SI, ou monétaires — un facteur en approche monétaire
-- s'exprime par euro dépensé, et c'est une unité comme une autre.
CREATE TABLE IF NOT EXISTS unit (
    id      integer PRIMARY KEY,
    symbol  text NOT NULL UNIQUE          -- « kg », « m3 », « kWh », « EUR »
);

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
    registered_office text
);


-- La table de faits. Rien que des nombres et un intervalle.
CREATE TABLE IF NOT EXISTS cell (
    id               text PRIMARY KEY,
    period           tstzrange NOT NULL,
    entity_id        integer NOT NULL REFERENCES entity(id),
    sub_post         integer,             -- NULL = non alloué, et c'est un état légitime
    part_type        integer,
    caracterisation  integer NOT NULL,
    value            double precision NOT NULL,
    unit_id          integer NOT NULL REFERENCES unit(id),
    -- LE FACTEUR EST UN NOMBRE, PAS UNE REPRÉSENTATION. Il est toujours en
    -- kgCO2e par unité d'activité, et cette unité est déjà dans `unit_id` :
    -- porter « kgCO2e/m3 » à côté serait une seconde source de vérité, donc
    -- une occasion de divergence. La conversion se fait à l'ingestion, une
    -- fois, à la frontière — au-delà, il n'y a qu'un nombre.
    factor           double precision NOT NULL,
    origin           text NOT NULL
                     CHECK (origin IN ('MEASURED','DERIVED','ESTIMATED','NOT_MEASURED')),

    -- DEUX AXES, ET LES CONFONDRE SERAIT UNE ERREUR DE MODÈLE. `origin` dit d'où
    -- vient LA VALEUR d'une cellule — mesurée, dérivée, estimée, pas mesurée
    -- (#46). `coverage` dit tout autre chose : si la cellule, si juste soit-elle,
    -- suffit à calculer l'émission dont elle fait partie.
    --
    --   INCOMPLETE — la règle de calcul demande plusieurs grandeurs et l'une
    --   manque. Un tonnage transporté sans la distance parcourue est une donnée
    --   exacte dont on ne peut rien tirer : la connaître ne dit pas qu'on sait.
    --
    --   MISSING — la série est périodique et une date manque. Décembre 2024 est
    --   absent du paquet et se reconstitue depuis décembre 2025 ; la cellule
    --   existe donc, elle porte une valeur défendable, et elle doit dire qu'elle
    --   comble un trou plutôt que de le taire.
    --
    -- Une cellule MEASURED peut être MISSING — le mois d'où on la recopie était
    -- bien mesuré — ce qui est précisément pourquoi un seul axe ne suffit pas.
    coverage         text NOT NULL DEFAULT 'COMPLETE'
                     CHECK (coverage IN ('COMPLETE','INCOMPLETE','MISSING')),

    -- Un intervalle vide ne porte aucun flux : ce serait une ligne qui existe
    -- sans rien dire, et qui fausserait un dénombrement de couverture.
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
ALTER TABLE cell   ADD COLUMN IF NOT EXISTS coverage text NOT NULL DEFAULT 'COMPLETE';
DO $$ BEGIN
    ALTER TABLE cell ADD CONSTRAINT cell_coverage_known
        CHECK (coverage IN ('COMPLETE','INCOMPLETE','MISSING'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Remonter d'une cellule à son client se fait à chaque dénombrement : sans cet
-- index, le parcours récursif relit l'arbre entier à chaque niveau.
CREATE INDEX IF NOT EXISTS entity_parent ON entity (parent);

COMMIT;
