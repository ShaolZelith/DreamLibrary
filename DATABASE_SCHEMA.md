# Schéma Supabase de Dream Library

## Source et portée

Les faits décrits comme confirmés ci-dessous proviennent des résultats d’inspection SQL du schéma `public` fournis pour ce document. Les snapshots bruts sont conservés dans [`schema_tables.txt`](./schema_tables.txt), [`schema_columns.txt`](./schema_columns.txt), [`schema_constraints.txt`](./schema_constraints.txt) et [`schema_indexes.txt`](./schema_indexes.txt).

Cette documentation décrit les objets retournés par l’inspection de `public`; elle ne permet pas de conclure sur les autres schémas. Les définitions de colonnes et de contraintes sont des résultats de catalogue, pas un script de migration `CREATE TABLE`.

La migration [`20261028163208_add_bidirectional_work_relations.sql`](./supabase/migrations/20261028163208_add_bidirectional_work_relations.sql) ajoute `work_relations.is_bidirectional` avec la valeur `false` par défaut, préservant ainsi le sens actuel des relations existantes. Les snapshots ci-dessus reflètent l’inspection antérieure à cette migration; ils ne sont pas une preuve de son application à une base.

## État des tables vérifiées

Les 11 tables ci-dessous sont confirmées comme `BASE TABLE` dans `public`.

| Table | État |
|---|---|
| `works` | Confirmée |
| `authors` | Confirmée |
| `work_authors` | Confirmée |
| `editions` | Confirmée |
| `copies` | Confirmée |
| `locations` | Confirmée |
| `reading_sessions` | Confirmée |
| `notes` | Confirmée |
| `tags` | Confirmée |
| `work_tags` | Confirmée |
| `work_relations` | Confirmée |

`reading_notes`, `important_passages` et une table dédiée aux citations ne figurent pas dans le résultat d’inspection fourni pour `public`. Cela ne permet pas de conclure à leur absence dans d’autres schémas.

## Colonnes

Les colonnes, types SQL, nullabilité et valeurs par défaut ci-dessous reproduisent le résultat fourni. `NOT NULL` signifie que `NULL` n’est pas accepté; `NULL` dans la colonne de défaut signifie qu’aucun défaut n’est déclaré. Les colonnes numériques affichent également la précision et l’échelle fournies lorsque celles-ci sont définies. Les fichiers [schema_columns.txt](./schema_columns.txt) conservent les lignes brutes complètes, y compris `udt_name` et les dimensions de caractères.

### `authors`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `name` | `text` | NOT NULL | aucun |

### `copies`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `edition_id` | `uuid` | NOT NULL | aucun |
| `ownership_status` | `text` | NOT NULL | `'owned'::text` |
| `location_id` | `uuid` | nullable | aucun |
| `condition` | `text` | nullable | aucun |
| `acquired_at` | `date` | nullable | aucun |
| `notes` | `text` | nullable | aucun |
| `created_at` | `timestamp with time zone` (`timestamptz`) | NOT NULL | `now()` |

### `editions`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `work_id` | `uuid` | NOT NULL | aucun |
| `isbn` | `text` | nullable | aucun |
| `publisher` | `text` | nullable | aucun |
| `publication_year` | `integer` (`int4`, précision 32, échelle 0) | nullable | aucun |
| `language` | `text` | nullable | aucun |
| `format` | `text` | nullable | aucun |
| `pages` | `integer` (`int4`, précision 32, échelle 0) | nullable | aucun |
| `created_at` | `timestamp with time zone` (`timestamptz`) | NOT NULL | `now()` |

### `locations`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `name` | `text` | NOT NULL | aucun |
| `parent_id` | `uuid` | nullable | aucun |

### `notes`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `work_id` | `uuid` | NOT NULL | aucun |
| `reading_session_id` | `uuid` | nullable | aucun |
| `note_type` | `text` | NOT NULL | `'reflection'::text` |
| `content` | `text` | NOT NULL | aucun |
| `page` | `text` | nullable | aucun |
| `chapter` | `text` | nullable | aucun |
| `created_at` | `timestamp with time zone` (`timestamptz`) | NOT NULL | `now()` |

### `reading_sessions`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `work_id` | `uuid` | NOT NULL | aucun |
| `copy_id` | `uuid` | nullable | aucun |
| `started_at` | `date` | nullable | aucun |
| `finished_at` | `date` | nullable | aucun |
| `status` | `text` | NOT NULL | `'planned'::text` |
| `rating` | `numeric` (précision 2, échelle 1) | nullable | aucun |
| `review` | `text` | nullable | aucun |
| `created_at` | `timestamp with time zone` (`timestamptz`) | NOT NULL | `now()` |

### `tags`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `name` | `text` | NOT NULL | aucun |
| `category` | `text` | NOT NULL | aucun |

### `work_authors`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `work_id` | `uuid` | NOT NULL | aucun |
| `author_id` | `uuid` | NOT NULL | aucun |
| `role` | `text` | NOT NULL | `'author'::text` |
| `position` | `integer` (`int4`, précision 32, échelle 0) | NOT NULL | `1` |

### `work_relations`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `source_work_id` | `uuid` | NOT NULL | aucun |
| `target_work_id` | `uuid` | NOT NULL | aucun |
| `relation_type` | `text` | NOT NULL | aucun |
| `comment` | `text` | nullable | aucun |
| `created_at` | `timestamp with time zone` (`timestamptz`) | NOT NULL | `now()` |

### `work_tags`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `work_id` | `uuid` | NOT NULL | aucun |
| `tag_id` | `uuid` | NOT NULL | aucun |

### `works`

| Colonne | Type | Nullabilité | Défaut |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `title` | `text` | NOT NULL | aucun |
| `summary` | `text` | nullable | aucun |
| `cover_url` | `text` | nullable | aucun |
| `original_language` | `text` | nullable | aucun |
| `work_type` | `text` | nullable | aucun |
| `is_priority` | `boolean` (`bool`) | NOT NULL | `false` |
| `created_at` | `timestamp with time zone` (`timestamptz`) | NOT NULL | `now()` |
| `is_read` | `boolean` (`bool`) | **nullable** | aucun |
| `is_owned` | `boolean` (`bool`) | **nullable** | aucun |

Ainsi, `works.is_read` et `works.is_owned` sont des booléens qui acceptent `NULL`. `NULL` peut représenter un statut non renseigné; il n’est pas remplacé par une valeur par défaut dans le schéma retourné.

### Lecture fonctionnelle des colonnes

Les libellés ci-dessous décrivent leur usage apparent d’après les noms des colonnes; ce ne sont pas des contraintes supplémentaires :

- `works` contient les informations générales de l’œuvre et ses deux statuts booléens nullable.
- `editions` porte les métadonnées d’édition (`isbn`, `publisher`, `publication_year`, langue, format et pages).
- `copies` décrit un exemplaire rattaché à une édition, avec son statut de possession, son emplacement éventuel, son état, sa date d’acquisition et des notes.
- `reading_sessions` enregistre des dates de lecture, un statut, une note et un compte rendu; elle peut référencer un exemplaire.
- `notes` rattache un contenu à une œuvre, et éventuellement à une session, avec type, page ou chapitre.
- `work_authors` et `work_tags` sont des tables de liaison; `work_relations` représente un lien orienté entre deux œuvres.

### Formulaire de création et de modification

Le formulaire DreamLibrary permet de modifier les champs métier de `works`, les rôles et l’ordre des auteurs associés, ainsi que les associations de tags. Il inclut aussi l’ajout, la modification et le retrait des éditions, exemplaires, sessions de lecture, notes et relations décrits ci-dessus. Les clés étrangères vers un emplacement, un exemplaire, une session ou une autre œuvre sont choisies dans les enregistrements existants; les données maîtres des auteurs, tags et emplacements restent gérées séparément.

Les identifiants et `created_at` sont techniques : ils ne sont pas éditables et les valeurs de création proviennent de la base. Les champs métier facultatifs sont enregistrés à `NULL` lorsqu’ils sont laissés vides. Le retrait d’une édition retire aussi ses exemplaires (avec confirmation dans l’interface); les sessions et notes associées sont conservées et leurs références facultatives sont effacées.

Les modifications de l’œuvre, des auteurs, des tags et des entités liées sont enregistrées par plusieurs appels à l’Edge Function, pas par une transaction unique. En cas d’erreur intermédiaire, l’interface indique quelle partie a échoué et les données déjà enregistrées ne sont pas annulées automatiquement.

## Clés et contraintes confirmées

Les définitions ci-dessous reprennent les résultats SQL. Toutes les contraintes listées sont retournées avec `is_validated = true`, `is_deferrable = false` et `initially_deferred = false` dans [schema_constraints.txt](./schema_constraints.txt).

### Clés primaires

| Table | Contrainte | Définition |
|---|---|---|
| `authors` | `authors_pkey` | `PRIMARY KEY (id)` |
| `copies` | `copies_pkey` | `PRIMARY KEY (id)` |
| `editions` | `editions_pkey` | `PRIMARY KEY (id)` |
| `locations` | `locations_pkey` | `PRIMARY KEY (id)` |
| `notes` | `notes_pkey` | `PRIMARY KEY (id)` |
| `reading_sessions` | `reading_sessions_pkey` | `PRIMARY KEY (id)` |
| `tags` | `tags_pkey` | `PRIMARY KEY (id)` |
| `work_authors` | `work_authors_pkey` | `PRIMARY KEY (work_id, author_id, role)` |
| `work_relations` | `work_relations_pkey` | `PRIMARY KEY (id)` |
| `work_tags` | `work_tags_pkey` | `PRIMARY KEY (work_id, tag_id)` |
| `works` | `works_pkey` | `PRIMARY KEY (id)` |

### Clés étrangères

| Table / contrainte | Définition SQL retournée |
|---|---|
| `copies.copies_edition_id_fkey` | `FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE CASCADE` |
| `copies.copies_location_id_fkey` | `FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL` |
| `editions.editions_work_id_fkey` | `FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE` |
| `locations.locations_parent_id_fkey` | `FOREIGN KEY (parent_id) REFERENCES locations(id) ON DELETE SET NULL` |
| `notes.notes_reading_session_id_fkey` | `FOREIGN KEY (reading_session_id) REFERENCES reading_sessions(id) ON DELETE SET NULL` |
| `notes.notes_work_id_fkey` | `FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE` |
| `reading_sessions.reading_sessions_copy_id_fkey` | `FOREIGN KEY (copy_id) REFERENCES copies(id) ON DELETE SET NULL` |
| `reading_sessions.reading_sessions_work_id_fkey` | `FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE` |
| `work_authors.work_authors_author_id_fkey` | `FOREIGN KEY (author_id) REFERENCES authors(id)` — aucune clause `ON DELETE` n’apparaît dans le résultat. |
| `work_authors.work_authors_work_id_fkey` | `FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE` |
| `work_relations.work_relations_source_work_id_fkey` | `FOREIGN KEY (source_work_id) REFERENCES works(id) ON DELETE CASCADE` |
| `work_relations.work_relations_target_work_id_fkey` | `FOREIGN KEY (target_work_id) REFERENCES works(id) ON DELETE CASCADE` |
| `work_tags.work_tags_tag_id_fkey` | `FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE` |
| `work_tags.work_tags_work_id_fkey` | `FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE` |

Les actions `CASCADE` suppriment les lignes dépendantes concernées; `SET NULL` conserve la ligne enfant en mettant sa référence à `NULL`. Pour `work_authors_author_id_fkey`, aucune clause `ON DELETE` explicite n’a été retournée; aucune action particulière n’est affirmée ici.

### Contraintes `UNIQUE`

| Table / contrainte | Définition |
|---|---|
| `authors.authors_name_key` | `UNIQUE (name)` |
| `tags.tags_category_name_key` | `UNIQUE (category, name)` |
| `work_relations.work_relations_source_work_id_target_work_id_relation_type_key` | `UNIQUE (source_work_id, target_work_id, relation_type)` |

### Contraintes `CHECK`

| Table / contrainte | Définition retournée |
|---|---|
| `copies.copies_ownership_status_valid` | `CHECK (ownership_status = ANY (ARRAY['owned'::text, 'borrowed'::text, 'loaned'::text, 'wanted'::text, 'digital'::text]))` |
| `editions.editions_pages_positive` | `CHECK (pages IS NULL OR pages > 0)` |
| `editions.editions_year_valid` | `CHECK (publication_year IS NULL OR publication_year >= 1 AND publication_year <= 9999)` |
| `notes.note_type_valid` | `CHECK (note_type = ANY (ARRAY['quote'::text, 'reflection'::text, 'summary'::text, 'highlight'::text]))` |
| `reading_sessions.reading_rating_half_star` | `CHECK (rating IS NULL OR (rating * 2::numeric) = trunc(rating * 2::numeric))` |
| `reading_sessions.reading_rating_valid` | `CHECK (rating IS NULL OR rating >= 0.5 AND rating <= 5::numeric)` |
| `reading_sessions.reading_status_valid` | `CHECK (status = ANY (ARRAY['planned'::text, 'in_progress'::text, 'completed'::text, 'abandoned'::text]))` |
| `tags.tag_category_valid` | `CHECK (category = ANY (ARRAY['genre'::text, 'theme'::text, 'place'::text, 'period'::text]))` |
| `work_relations.relation_not_self` | `CHECK (source_work_id <> target_work_id)` |
| `work_relations.relation_type_valid` | `CHECK (relation_type = ANY (ARRAY['same_subject'::text, 'complements'::text, 'contradicts'::text, 'criticizes'::text, 'alternative_view'::text]))` |

## Index

La liste suivante reprend tous les index retournés. Leur présence décrit la structure, mais ne constitue pas une mesure de performance.

| Table | Index | Définition retournée |
|---|---|---|
| `authors` | `authors_name_key` | `CREATE UNIQUE INDEX authors_name_key ON public.authors USING btree (name)` |
| `authors` | `authors_pkey` | `CREATE UNIQUE INDEX authors_pkey ON public.authors USING btree (id)` |
| `copies` | `copies_edition_id_idx` | `CREATE INDEX copies_edition_id_idx ON public.copies USING btree (edition_id)` |
| `copies` | `copies_pkey` | `CREATE UNIQUE INDEX copies_pkey ON public.copies USING btree (id)` |
| `editions` | `editions_isbn_unique` | `CREATE UNIQUE INDEX editions_isbn_unique ON public.editions USING btree (isbn) WHERE ((isbn IS NOT NULL) AND (isbn <> ''::text))` |
| `editions` | `editions_pkey` | `CREATE UNIQUE INDEX editions_pkey ON public.editions USING btree (id)` |
| `editions` | `editions_work_id_idx` | `CREATE INDEX editions_work_id_idx ON public.editions USING btree (work_id)` |
| `locations` | `locations_pkey` | `CREATE UNIQUE INDEX locations_pkey ON public.locations USING btree (id)` |
| `notes` | `notes_pkey` | `CREATE UNIQUE INDEX notes_pkey ON public.notes USING btree (id)` |
| `notes` | `notes_work_id_idx` | `CREATE INDEX notes_work_id_idx ON public.notes USING btree (work_id)` |
| `reading_sessions` | `reading_sessions_pkey` | `CREATE UNIQUE INDEX reading_sessions_pkey ON public.reading_sessions USING btree (id)` |
| `reading_sessions` | `reading_sessions_work_id_idx` | `CREATE INDEX reading_sessions_work_id_idx ON public.reading_sessions USING btree (work_id)` |
| `tags` | `tags_category_name_key` | `CREATE UNIQUE INDEX tags_category_name_key ON public.tags USING btree (category, name)` |
| `tags` | `tags_pkey` | `CREATE UNIQUE INDEX tags_pkey ON public.tags USING btree (id)` |
| `work_authors` | `work_authors_pkey` | `CREATE UNIQUE INDEX work_authors_pkey ON public.work_authors USING btree (work_id, author_id, role)` |
| `work_relations` | `work_relations_pkey` | `CREATE UNIQUE INDEX work_relations_pkey ON public.work_relations USING btree (id)` |
| `work_relations` | `work_relations_source_work_id_target_work_id_relation_type_key` | `CREATE UNIQUE INDEX work_relations_source_work_id_target_work_id_relation_type_key ON public.work_relations USING btree (source_work_id, target_work_id, relation_type)` |
| `work_relations` | `work_relations_target_idx` | `CREATE INDEX work_relations_target_idx ON public.work_relations USING btree (target_work_id)` |
| `work_tags` | `work_tags_pkey` | `CREATE UNIQUE INDEX work_tags_pkey ON public.work_tags USING btree (work_id, tag_id)` |
| `work_tags` | `work_tags_tag_id_idx` | `CREATE INDEX work_tags_tag_id_idx ON public.work_tags USING btree (tag_id)` |
| `works` | `works_pkey` | `CREATE UNIQUE INDEX works_pkey ON public.works USING btree (id)` |

`editions_isbn_unique` est un index unique partiel : il ne s’applique qu’aux ISBN non `NULL` et non vides (`isbn <> ''`). Les ISBN `NULL` ou vides ne sont donc pas soumis à cet index.

## Relations fonctionnelles

Les relations suivantes sont établies par les clés étrangères confirmées, et leur sens fonctionnel est décrit à partir des colonnes :

- **Œuvres et auteurs** : `work_authors.work_id` référence `works.id`, et `work_authors.author_id` référence `authors.id`. La table de liaison permet plusieurs associations; sa clé primaire inclut aussi `role`. La suppression d’une œuvre cascade sur ses associations. La FK vers `authors` ne spécifie pas de clause `ON DELETE` dans le résultat.
- **Œuvres et éditions** : `editions.work_id` référence `works.id`; la suppression de l’œuvre cascade sur ses éditions. Une édition peut porter plusieurs exemplaires via `copies.edition_id`, dont la suppression cascade sur ces exemplaires.
- **Exemplaires et emplacements** : `copies.location_id` référence `locations.id`; supprimer l’emplacement met cette référence à `NULL`. `locations.parent_id` référence `locations.id` pour la hiérarchie; supprimer le parent met le `parent_id` des enfants concernés à `NULL`.
- **Sessions de lecture** : `reading_sessions.work_id` référence l’œuvre et cascade lors de sa suppression. `reading_sessions.copy_id` est une référence nullable à un exemplaire; supprimer l’exemplaire met `copy_id` à `NULL`.
- **Notes** : `notes.work_id` référence l’œuvre et cascade lors de sa suppression. `notes.reading_session_id` est nullable et mis à `NULL` lors de la suppression de la session référencée.
- **Tags** : `work_tags` relie les œuvres aux tags. Les deux FKs cascade lors de la suppression de l’œuvre ou du tag.
- **Relations entre œuvres** : `work_relations.source_work_id` et `target_work_id` référencent chacun `works.id`; la suppression de l’une ou l’autre œuvre cascade sur la relation. La contrainte interdit l’auto-relation et l’unicité empêche un doublon pour le même couple orienté et le même type. La migration ajoute `is_bidirectional` pour identifier une relation réciproque dans une seule ligne; les lignes préexistantes conservent une valeur `false`.

Les cardinalités exactes (par exemple un maximum d’éditions par œuvre) ne sont pas imposées par les FKs seules, sauf unicités explicitement listées dans les contraintes.

## Citations, notes et passages

La table `notes` porte `note_type` (texte, `NOT NULL`, défaut `'reflection'::text`) et la contrainte `note_type_valid` autorise exactement `quote`, `reflection`, `summary` et `highlight`. Une citation peut donc être représentée dans `notes` avec `note_type = 'quote'`. Le résultat d’inspection ne liste pas de table dédiée aux citations. `reading_notes` et `important_passages` ne figurent pas non plus parmi les tables retournées; aucune conclusion n’est tirée sur les autres schémas.

## Comparaison avec l’Edge Function

La comparaison ci-dessous sépare le schéma confirmé des requêtes constatées dans `supabase/functions/dream-library-edit/index.ts` :

- `works_list`, `works_create` et `works_update` utilisent les champs de `works` — dont `is_read` et `is_owned` — qui sont confirmés dans le résultat fourni. L’action de mise à jour des auteurs utilise la table de liaison `work_authors`.
- `works_detail` lit les éditions via `editions.work_id`, puis les exemplaires via `copies.edition_id`; il résout les emplacements via `copies.location_id` et `locations.id`. Les auteurs sont chargés via `work_authors`/`authors`, les tags via `work_tags`/`tags`, et les sessions et notes via leurs colonnes `work_id`. Ces chemins correspondent aux colonnes et FK confirmées.
- `works_list` et `works_detail` utilisent maintenant uniquement `work_tags.work_id`/`tag_id` puis `tags.id`; aucune lecture de `tags.work_id` ne subsiste. De même, les copies ne sont plus cherchées par `copies.work_id`.
- Les relations sont lues dans `work_relations` par `source_work_id` et `target_work_id`; le titre de l’autre œuvre est résolu à partir de ces deux colonnes. `is_bidirectional` permet de recharger et d’afficher une direction réciproque sans créer une seconde ligne. Les anciens chemins `work_relations.work_id` et `related_work_id` ont été retirés.
- Les tentatives de lecture `reading_notes`, `citations` et `important_passages` ont été retirées de l’action `works_detail`, puisqu’elles ne sont pas nécessaires à la lecture de `notes` dans le schéma confirmé. Cette observation vaut uniquement pour les résultats `public` communiqués.
- Les erreurs de requêtes associées ne sont plus converties en listes vides par un helper optionnel; elles sont renvoyées avec le contexte de l’action. Aucune action CRUD de création/suppression de `work_relations` n’existe dans cette Edge Function.
- Les actions `works_create`, `works_update`, `works_tags_set` et `works_authors_set` modifient les œuvres et leurs associations. Aucune action d’écriture des éditions, copies, emplacements, sessions, notes ou relations n’a été relevée dans cette Edge Function.
- Les anciennes actions `list/create/update/delete` interrogent encore `books`. La liste de contrôle fournie ne décrit pas la table `books`; sa compatibilité avec la base ne peut donc pas être établie à partir de ces snapshots seuls.

La comparaison reflète la version corrigée de l’Edge Function. Elle ne prouve pas que la version corrigée est déjà déployée.

## Points restant à vérifier

- Le périmètre inspecté ici est `public`; le statut des tables homonymes dans tout autre schéma reste inconnu.
- Les comportements applicatifs en production dépendent du déploiement effectif de l’Edge Function et des permissions/RLS; les résultats de structure seuls ne les vérifient pas.
- Aucun test de performance n’est déduit de la présence des index.

## Annexe — requêtes d’audit en lecture seule

Les requêtes suivantes lisent uniquement `information_schema` et les catalogues système PostgreSQL. Elles ne modifient ni tables ni données. Les fichiers de résultats bruts sont conservés à la racine du projet.

### Tables présentes dans `public`

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = ANY (ARRAY[
    'works', 'authors', 'work_authors',
    'editions', 'copies', 'locations', 'reading_sessions',
    'notes', 'reading_notes', 'citations', 'important_passages', 'tags',
    'work_tags', 'work_relations'
  ])
ORDER BY table_name;
```

### Colonnes, types, valeurs par défaut et nullabilité

```sql
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default, character_maximum_length,
       numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = ANY (ARRAY[
    'works', 'authors', 'work_authors',
    'editions', 'copies', 'locations', 'reading_sessions',
    'notes', 'reading_notes', 'citations', 'important_passages', 'tags',
    'work_tags', 'work_relations'
  ])
ORDER BY table_name, ordinal_position;
```

### Clés et contraintes

```sql
SELECT t.relname AS table_name,
       c.conname AS constraint_name,
       CASE c.contype
         WHEN 'p' THEN 'PRIMARY KEY'
         WHEN 'f' THEN 'FOREIGN KEY'
         WHEN 'u' THEN 'UNIQUE'
         WHEN 'c' THEN 'CHECK'
         WHEN 'x' THEN 'EXCLUSION'
         ELSE c.contype::text
       END AS constraint_type,
       pg_get_constraintdef(c.oid, true) AS definition,
       c.convalidated AS is_validated,
       c.condeferrable AS is_deferrable,
       c.condeferred AS initially_deferred
FROM pg_constraint AS c
JOIN pg_class AS t ON t.oid = c.conrelid
JOIN pg_namespace AS n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = ANY (ARRAY[
    'works', 'authors', 'work_authors',
    'editions', 'copies', 'locations', 'reading_sessions',
    'notes', 'reading_notes', 'citations', 'important_passages', 'tags',
    'work_tags', 'work_relations'
  ])
ORDER BY t.relname, constraint_type, c.conname;
```

### Index

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = ANY (ARRAY[
    'works', 'authors', 'work_authors',
    'editions', 'copies', 'locations', 'reading_sessions',
    'notes', 'reading_notes', 'citations', 'important_passages', 'tags',
    'work_tags', 'work_relations'
  ])
ORDER BY tablename, indexname;
```
