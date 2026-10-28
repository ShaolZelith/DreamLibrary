import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const edgeFunction = readFileSync(
  new URL("../supabase/functions/dream-library-edit/index.ts", import.meta.url),
  "utf8",
);
const columnsSnapshot = readFileSync(
  new URL("../schema_columns.txt", import.meta.url),
  "utf8",
);
const constraintsSnapshot = readFileSync(
  new URL("../schema_constraints.txt", import.meta.url),
  "utf8",
);
const authorResolutionMigration = readFileSync(
  new URL(
    "../supabase/migrations/20261028_resolve_authors_case_insensitively.sql",
    import.meta.url,
  ),
  "utf8",
);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const frontend = readFileSync(new URL("../script.js", import.meta.url), "utf8");

function hasColumn(table, column) {
  return columnsSnapshot.split(/\r?\n/).some((line) => {
    const fields = line.split("|").map((field) => field.trim());
    return fields[1] === table && fields[3] === column;
  });
}

function actionBlock(action) {
  const start = edgeFunction.indexOf(`if (action === "${action}")`);
  assert.notEqual(start, -1, `missing action ${action}`);
  const open = edgeFunction.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < edgeFunction.length; index += 1) {
    if (edgeFunction[index] === "{") depth += 1;
    if (edgeFunction[index] === "}") {
      depth -= 1;
      if (depth === 0) return edgeFunction.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated action ${action}`);
}

function functionBlock(functionName) {
  const start = frontend.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const open = frontend.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < frontend.length; index += 1) {
    if (frontend[index] === "{") depth += 1;
    if (frontend[index] === "}") {
      depth -= 1;
      if (depth === 0) return frontend.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function ${functionName}`);
}

function edgeFunctionBlock(functionName) {
  const start = edgeFunction.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing Edge Function helper ${functionName}`);
  const open = edgeFunction.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < edgeFunction.length; index += 1) {
    if (edgeFunction[index] === "{") depth += 1;
    if (edgeFunction[index] === "}") {
      depth -= 1;
      if (depth === 0) return edgeFunction.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated Edge Function helper ${functionName}`);
}

test("works_list reads confirmed work, author, and tag-link columns", () => {
  for (const column of ["is_read", "is_owned", "created_at"]) {
    assert.equal(hasColumn("works", column), true);
  }
  for (const column of ["work_id", "author_id", "role", "position"]) {
    assert.equal(hasColumn("work_authors", column), true);
  }
  assert.match(actionBlock("works_list"), /\.from\("works"\)/);
  assert.match(actionBlock("works_list"), /\.from\("work_tags"\)/);
  assert.match(actionBlock("works_list"), /\.from\("tags"\)/);
  assert.doesNotMatch(actionBlock("works_list"), /\.from\("tags"\)\s*\.select\([^)]*work_id/);
});

test("works_detail follows edition-to-copy and work-tag foreign keys", () => {
  for (const [table, column] of [
    ["editions", "work_id"],
    ["copies", "edition_id"],
    ["work_tags", "work_id"],
    ["work_tags", "tag_id"],
    ["tags", "id"],
    ["copies", "location_id"],
    ["locations", "name"],
  ]) {
    assert.equal(hasColumn(table, column), true, `${table}.${column}`);
  }
  const detail = actionBlock("works_detail");
  assert.match(detail, /\.from\("editions"\)\.select\("\*"\)\.eq\("work_id", id\)/);
  assert.match(detail, /\.from\("copies"\)\.select\("\*"\)\.in\("edition_id", editionIds\)/);
  assert.doesNotMatch(detail, /\.from\("copies"\)[\s\S]{0,100}\.eq\("work_id"/);
  assert.match(detail, /\.from\("work_tags"\)\.select\("tag_id"\)\.eq\("work_id", id\)/);
  assert.match(detail, /\.from\("tags"\)\.select\("id, name, category"\)\.in\("id", tagIds\)/);
  assert.doesNotMatch(detail, /\.from\("tags"\)[\s\S]{0,100}work_id/);
});

test("works_detail reads confirmed relations in both directions", () => {
  for (const column of ["source_work_id", "target_work_id", "relation_type", "comment"]) {
    assert.equal(hasColumn("work_relations", column), true);
  }
  const detail = actionBlock("works_detail");
  assert.match(detail, /\.eq\("source_work_id", id\)/);
  assert.match(detail, /\.eq\("target_work_id", id\)/);
  assert.match(detail, /relation\.source_work_id === id/);
  assert.doesNotMatch(detail, /\.from\("work_relations"\)\.select\("related_work_id"\)/);
  assert.match(constraintsSnapshot, /CHECK \(source_work_id <> target_work_id\)/);
  assert.match(constraintsSnapshot, /UNIQUE \(source_work_id, target_work_id, relation_type\)/);
});

test("status writes preserve boolean true, false, and null", () => {
  const validator = edgeFunction.slice(
    edgeFunction.indexOf("function hasValidWorkStatuses"),
    edgeFunction.indexOf("interface WorkAuthorInput"),
  );
  assert.match(validator, /value\[field\] === null/);
  assert.match(validator, /typeof value\[field\] === "boolean"/);
  assert.match(actionBlock("works_create"), /hasValidWorkStatuses\(work, true\)/);
  assert.match(actionBlock("works_update"), /hasValidWorkStatuses\(work, true\)/);
  assert.match(edgeFunction, /"is_read", "is_owned"/);
});

test("author associations use the confirmed relationship and conflict key", () => {
  const setAuthors = actionBlock("works_authors_set");
  assert.match(setAuthors, /\.from\("authors"\)/);
  assert.match(setAuthors, /\.rpc\("resolve_author"/);
  assert.match(setAuthors, /\.from\("work_authors"\)/);
  assert.match(setAuthors, /onConflict: "work_id,author_id,role"/);
  assert.match(setAuthors, /\.from\("work_authors"\)\s*\.delete\(\)/);
  assert.doesNotMatch(setAuthors, /\.from\("authors"\)\s*\.delete\(\)/);
  assert.match(setAuthors, /authorNamesById\.get\(link\.author_id\) \|\| workAuthors\[index\]\.name/);
  assert.match(setAuthors, /"Impossible d'enregistrer les auteurs"/);
  assert.ok(
    setAuthors.indexOf("for (const name of newAuthorNames)") <
      setAuthors.indexOf("if (newLinks.length)"),
    "all unpersisted author names must resolve before writing associations",
  );
  assert.ok(
    setAuthors.indexOf('"Impossible d\'enregistrer les auteurs"') <
      setAuthors.indexOf("if (newLinks.length)"),
    "author resolution failures must return before writing associations",
  );
  for (const column of ["work_id", "author_id", "role", "position"]) {
    assert.equal(hasColumn("work_authors", column), true);
  }
});

test("author resolution trims names, reuses case-insensitive matches, and serializes concurrent creates", () => {
  const resolveAuthor = actionBlock("authors_resolve");
  assert.match(resolveAuthor, /role !== "edit"/);
  assert.match(resolveAuthor, /!body\.name\.trim\(\)/);
  assert.match(resolveAuthor, /body\.name\.trim\(\)\.length > 300/);
  assert.match(resolveAuthor, /\.rpc\("resolve_author", \{\s*p_name: body\.name\.trim\(\)/);
  assert.match(resolveAuthor, /if \(error\) \{\s*return replyDatabaseError\(/);
  assert.match(resolveAuthor, /Impossible de retrouver ou créer l’auteur/);
  assert.match(resolveAuthor, /return reply\(\{ error: "La base n’a pas confirmé la résolution de l’auteur" \}, 500\)/);
  assert.match(authorResolutionMigration, /cleaned_name := pg_catalog\.btrim\(p_name\)/);
  assert.match(authorResolutionMigration, /hashtextextended\(pg_catalog\.lower\(cleaned_name\), 0\)/);
  assert.match(authorResolutionMigration, /pg_advisory_xact_lock/);
  assert.match(authorResolutionMigration, /lower\(pg_catalog\.btrim\(author\.name\)\)/);
  assert.match(authorResolutionMigration, /ORDER BY author\.id\s+LIMIT 1/);
  assert.match(authorResolutionMigration, /INSERT INTO public\.authors \(name\)\s+VALUES \(cleaned_name\)/);
  assert.match(authorResolutionMigration, /LANGUAGE plpgsql\s+SET search_path = ''/);
  assert.doesNotMatch(authorResolutionMigration, /SECURITY DEFINER/i);
  assert.match(authorResolutionMigration, /GRANT EXECUTE ON FUNCTION public\.resolve_author\(text\) TO service_role/);
  assert.match(authorResolutionMigration, /REVOKE ALL ON FUNCTION public\.resolve_author\(text\) FROM anon, authenticated/);
  assert.match(authorResolutionMigration, /REVOKE ALL ON FUNCTION public\.resolve_author\(text\) FROM PUBLIC/);
  assert.match(frontend, /const name = input\.value\.trim\(\)/);
  assert.match(frontend, /name\.toLocaleLowerCase\("fr"\)/);
  assert.match(frontend, /author\.name\.trim\(\)\.toLocaleLowerCase\("fr"\)/);
  assert.match(frontend, /if \(!name\) \{\s*showAuthorStatus\("Saisis le nom de l’auteur\."/);
});

test("new and edited works persist authors through the same association action", () => {
  assert.match(frontend, /id \? "works_update" : "works_create"/);
  assert.match(frontend, /editRequest\(\s*"works_authors_set"[\s\S]*?authors: authorsToSave/);
});

test("tag updates insert and delete through the confirmed join table", () => {
  const setTags = actionBlock("works_tags_set");
  assert.match(setTags, /\.from\("work_tags"\)\.insert\(\{ work_id: id, tag_id: tagId \}\)/);
  assert.match(setTags, /\.from\("work_tags"\)/);
  assert.match(setTags, /\.eq\("work_id", id\)\.eq\("tag_id", link\.tag_id\)/);
  assert.match(setTags, /\.from\("tags"\)\.select\("id"\)\.in\("id", tagIds\)/);
});

test("tag creation validates edit access and reuses the unique category/name pair", () => {
  const createTag = actionBlock("tags_create");
  assert.match(createTag, /role !== "edit"/);
  assert.match(createTag, /!body\.name\.trim\(\)/);
  for (const category of ["genre", "theme", "place", "period"]) {
    assert.match(createTag, new RegExp(`"${category}"`));
  }
  assert.match(createTag, /\.eq\("category", category\)\s*\.eq\("name", name\)\s*\.maybeSingle\(\)/);
  assert.match(createTag, /\.from\("tags"\)\s*\.insert\(\{ name, category \}\)/);
  assert.match(createTag, /createError\.code === "23505"/);
  assert.match(constraintsSnapshot, /UNIQUE \(category, name\)/);
  assert.match(frontend, /editRequest\(\s*"tags_create"/);
  assert.match(frontend, /selectedTags\.push\(result\.tag\)/);
  assert.match(frontend, /await loadTags\(\)/);
});

test("every write action requires edit role", () => {
  for (const action of [
    "authors_resolve",
    "tags_create",
    "works_tags_set",
    "works_related_set",
    "works_create",
    "works_update",
    "works_delete",
    "works_authors_set",
  ]) {
    assert.match(actionBlock(action), /role !== "edit"/, action);
  }
  const legacyGate = edgeFunction.slice(
    edgeFunction.indexOf('if (role !== "edit")', edgeFunction.indexOf('if (action === "list")')),
    edgeFunction.indexOf('if (action === "create")', edgeFunction.indexOf('if (action === "list")')),
  );
  assert.match(legacyGate, /role !== "edit"/);
});

test("database schema errors are not converted to empty optional results", () => {
  assert.doesNotMatch(edgeFunction, /function optionalRows/);
  assert.doesNotMatch(edgeFunction, /PGRST205|42703/);
  assert.match(edgeFunction, /replyDatabaseError\("works_detail", "Impossible de charger les exemplaires"/);
  assert.match(edgeFunction, /replyDatabaseError\("works_detail", "Impossible de charger les tags"/);
});

test("work editor exposes every persisted business field from the schema", () => {
  const workFormFields = [
    ["works", ["title", "summary", "cover_url", "original_language", "work_type", "is_priority", "is_read", "is_owned"]],
    ["work_authors", ["role", "position"]],
    ["editions", ["isbn", "publisher", "publication_year", "language", "format", "pages"]],
    ["copies", ["ownership_status", "location_id", "condition", "acquired_at", "notes"]],
    ["reading_sessions", ["copy_id", "started_at", "finished_at", "status", "rating", "review"]],
    ["notes", ["reading_session_id", "note_type", "content", "page", "chapter"]],
    ["work_relations", ["source_work_id", "target_work_id", "relation_type", "comment"]],
  ];
  for (const [table, columns] of workFormFields) {
    for (const column of columns) {
      assert.equal(hasColumn(table, column), true, `${table}.${column} exists in the schema`);
      if (table === "works") {
        const inputId = {
          cover_url: "coverUrl",
          original_language: "originalLanguage",
          work_type: "workType",
          is_priority: "isPriority",
        }[column] || column;
        assert.match(html, new RegExp(`id="${inputId}"`));
      } else {
        assert.ok(frontend.includes(column) || edgeFunction.includes(column), `${table}.${column} is handled by the editor`);
      }
    }
  }
  for (const technical of ["id", "created_at"]) {
    assert.equal(hasColumn("works", technical), true);
    assert.doesNotMatch(html, new RegExp(`id="${technical}"`));
  }
  assert.match(frontend, /summary: \$\("summary"\)\.value\.trim\(\) \|\| null/);
  assert.match(frontend, /is_owned: selectedBoolean/);
  assert.match(frontend, /is_read: selectedBoolean/);
});

test("related form is prefilled from works_detail and persists on create and edit", () => {
  assert.match(html, /id="editionsEditor"/);
  assert.match(html, /id="copiesEditor"/);
  assert.match(html, /id="readingSessionsEditor"/);
  assert.match(html, /id="notesEditor"/);
  assert.match(html, /id="relationsEditor"/);
  assert.match(frontend, /fillForm\([\s\S]*?, details\)/);
  assert.match(frontend, /setRelatedEditorData\(details \|\| \{ work \}\)/);
  assert.match(frontend, /editRequest\(\s*"works_related_set"[\s\S]*?\{ related: relatedToSave \}/);
  assert.match(actionBlock("works_related_set"), /parseRelatedInput\(body\.related, id\)/);
  assert.match(actionBlock("works_related_set"), /return reply\(\{\s*saved: true/);
  assert.match(frontend, /id \? "works_update" : "works_create"/);
  assert.match(actionBlock("works_related_set"), /\.from\("editions"\)\.insert/);
  assert.match(actionBlock("works_related_set"), /\.from\("editions"\)\.update/);
  assert.match(actionBlock("works_related_set"), /\.from\("copies"\)\.insert/);
  assert.match(actionBlock("works_related_set"), /\.from\("reading_sessions"\)\.insert/);
  assert.match(actionBlock("works_related_set"), /\.from\("notes"\)\.insert/);
  assert.match(actionBlock("works_related_set"), /\.from\("work_relations"\)\.insert/);
});

test("related writes validate enum, numeric, date, and foreign-key data", () => {
  const parser = edgeFunctionBlock("parseRelatedInput");
  assert.match(parser, /Number\.isInteger\(year\)/);
  assert.match(parser, /Number\.isInteger\(pages\)/);
  assert.match(parser, /reading_rating|rating \* 2 % 1/);
  assert.match(edgeFunctionBlock("validDate"), /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(parser, /copies\.some\(\(copy\) => !editionIds\.has\(copy\.edition_id\)\)/);
  assert.match(parser, /readingSessions\.some\(\(session\) => session\.copy_id && !copyIds\.has\(session\.copy_id\)\)/);
  assert.match(parser, /notes\.some\(\(note\) => note\.reading_session_id && !sessionIds\.has\(note\.reading_session_id\)\)/);
  assert.match(parser, /raw\.source_work_id !== workId && raw\.target_work_id !== workId/);
  assert.match(actionBlock("works_related_set"), /locationRows\.length !== locationIds\.length/);
  assert.match(actionBlock("works_related_set"), /relatedWorkRows\.length !== relatedWorkIds\.length/);
  assert.match(parser, /!raw\.content\.trim\(\)/);
});

test("related records can be removed without deleting their parent entities", () => {
  const setRelated = actionBlock("works_related_set");
  assert.match(setRelated, /deleteOmitted\("notes"/);
  assert.match(setRelated, /deleteOmitted\(\s*"reading_sessions"/);
  assert.match(setRelated, /deleteOmitted\("copies"/);
  assert.match(setRelated, /deleteOmitted\("work_relations"/);
  assert.match(setRelated, /deleteOmitted\(\s*"editions"/);
  assert.doesNotMatch(setRelated, /\.from\("authors"\)\s*\.delete/);
  assert.doesNotMatch(setRelated, /\.from\("tags"\)\s*\.delete/);
  assert.match(frontend, /Retirer cette édition supprimera aussi ses exemplaires/);
});

test("related-record writes and location reads require the appropriate access", () => {
  assert.match(actionBlock("works_related_set"), /role !== "edit"/);
  assert.match(actionBlock("locations_list"), /\.from\("locations"\)\s*\.select\("id, name, parent_id"\)/);
  assert.match(frontend, /editRequest\("locations_list"\)/);
  for (const action of ["works_related_set"]) {
    assert.match(actionBlock(action), /role !== "edit"/, action);
  }
});

test("author editor supports role and ordering while defaulting new links to author", () => {
  assert.match(html, /label for="authorName">Nom de l’auteur/);
  assert.match(html, /id="authorName" maxlength="300"/);
  assert.match(html, /id="addAuthor">Ajouter/);
  assert.match(html, /id="authorAutocomplete"/);
  assert.match(html, /role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="authorSuggestions"/);
  assert.match(html, /id="authorSuggestions"[^>]*role="listbox"/);
  assert.doesNotMatch(html, /authorSelect|addExistingAuthor|newAuthorName|addNewAuthor/);
  assert.doesNotMatch(frontend, /\$\("(?:authorSelect|newAuthorName)"\)/);
  assert.match(frontend, /role: "author"/);
  assert.match(frontend, /data-author-role/);
  assert.match(frontend, /data-move-author/);
  assert.match(frontend, /data-remove-author/);
});

test("author suggestions are filtered locally from the limited authors list", () => {
  const listAuthors = actionBlock("authors_list");
  const loadAuthors = functionBlock("loadAuthors");
  const updateSuggestions = functionBlock("updateAuthorSuggestions");
  assert.match(listAuthors, /\.select\("id, name"\)/);
  assert.match(loadAuthors, /editRequest\("authors_list"\)/);
  assert.match(loadAuthors, /requestId !== authorListRequestId/);
  assert.match(loadAuthors, /password !== accessPassword/);
  assert.match(updateSuggestions, /query\.length >= 2/);
  assert.match(updateSuggestions, /normalizedName\.includes\(query\)/);
  assert.match(updateSuggestions, /selectedIds\.has\(author\.id\)/);
  assert.match(updateSuggestions, /selectedNames\.has\(normalizedName\)/);
  assert.match(updateSuggestions, /seenNames\.has\(normalizedName\)/);
  assert.match(updateSuggestions, /\.slice\(0, 8\)/);
  assert.doesNotMatch(updateSuggestions, /editRequest|fetch\(/);
  assert.match(frontend, /loadAuthors\(\)\.catch/);
});

test("selecting a suggestion does not resolve or create an author", () => {
  const selectSuggestion = functionBlock("selectAuthorSuggestion");
  const addAuthor = functionBlock("addAuthorFromInput");
  assert.match(selectSuggestion, /selectedAuthorSuggestion = author/);
  assert.match(selectSuggestion, /\$\("authorName"\)\.value = author\.name/);
  assert.match(addAuthor, /selectedAuthorSuggestion[\s\S]*?normalizeAuthorName\(selectedAuthorSuggestion\.name\)/);
  assert.match(addAuthor, /if \(!author\) \{\s*const result = await editRequest\(\s*"authors_resolve"/);
  assert.match(addAuthor, /if \(!availableAuthors\.some\(\(item\) => item\.id === author\.id\)\)/);
  assert.match(frontend, /if \(!name\) \{\s*showAuthorStatus\("Saisis le nom de l’auteur\."/);
});

test("author autocomplete handles keyboard selection, escape, and outside clicks", () => {
  const keydown = frontend.slice(
    frontend.indexOf('document.addEventListener("keydown", async (event) => {'),
    frontend.indexOf('["search", "workTypeFilter", "priorityFilter"]'),
  );
  assert.match(keydown, /event\.key === "ArrowDown"/);
  assert.match(keydown, /event\.key === "ArrowUp"/);
  assert.match(keydown, /event\.key === "Escape"/);
  assert.match(keydown, /event\.key === "Enter"/);
  assert.match(keydown, /event\.preventDefault\(\)/);
  assert.match(keydown, /selectAuthorSuggestion\(/);
  assert.match(frontend, /if \(!target\.closest\("#authorAutocomplete"\)\) closeAuthorSuggestions\(\)/);
  assert.match(frontend, /if \(event\.target\.id !== "authorName"\) return;\s*selectedAuthorSuggestion = null;\s*updateAuthorSuggestions/);
});

test("tag editor offers exactly the four confirmed categories", () => {
  const tagEditor = html.slice(html.indexOf('id="newTagCategory"'), html.indexOf("</select>", html.indexOf('id="newTagCategory"')));
  assert.match(tagEditor, /value="genre">Genre/);
  assert.match(tagEditor, /value="theme">Thème/);
  assert.match(tagEditor, /value="place">Lieu/);
  assert.match(tagEditor, /value="period">Période/);
  assert.doesNotMatch(tagEditor, /value="(?:author|topic|location)"/);
});

test("work list loads existing publication years and latest personal ratings", () => {
  const list = actionBlock("works_list");
  assert.match(list, /\.from\("editions"\)\.select\("work_id, publication_year"\)/);
  assert.match(list, /\.from\("reading_sessions"\)\s*\.select\("id, work_id, rating, created_at"\)/);
  assert.match(list, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(list, /publication_year: publicationYearByWork\.get\(work\.id\) \?\? null/);
  assert.match(list, /personal_rating: personalRatingByWork\.get\(work\.id\) \?\? null/);
  assert.match(frontend, /created_at: work\.created_at \|\| null/);
  assert.match(frontend, /publication_year: Number\.isInteger\(work\.publication_year\)/);
  assert.match(frontend, /personal_rating: typeof work\.personal_rating === "number"/);
});

test("work sorting supports all criteria, missing values, and stable comparisons", () => {
  const sortWorks = runInNewContext(`${functionBlock("sortWorks")}; sortWorks`);
  const ids = (items, criterion) =>
    Array.from(sortWorks(items, criterion), (work) => work.id);
  const items = [
    { id: "b", title: "bêta", authors: [{ name: "Zoé", position: 1 }] },
    { id: "a1", title: "Alpha", authors: [{ name: "Émile", position: 1 }] },
    { id: "a2", title: "alpha", authors: [{ name: "Alice", position: 1 }] },
    { id: "missing", title: "Sans auteur", authors: [] }
  ];

  assert.deepEqual(ids(items, "title-asc"), ["a1", "a2", "b", "missing"]);
  assert.deepEqual(ids(items, "title-desc"), ["missing", "b", "a1", "a2"]);
  assert.deepEqual(ids([
    { id: "accent", title: "Éclair" },
    { id: "plain", title: "eclair" }
  ], "title-asc"), ["plain", "accent"]);
  assert.deepEqual(ids(items, "author-asc"), ["a2", "a1", "b", "missing"]);
  assert.deepEqual(ids(items, "author-desc"), ["b", "a1", "a2", "missing"]);
  assert.deepEqual(items.map((work) => work.id), ["b", "a1", "a2", "missing"]);

  const multipleAuthors = [
    { id: "second-first", title: "x", authors: [
      { name: "Zoé", position: 2 },
      { name: "Alice", position: 1 }
    ] },
    { id: "primary-first", title: "y", authors: [
      { name: "Bruno", position: 1 },
      { name: "Yves", position: 2 }
    ] },
    { id: "no-author", title: "z", authors: [] }
  ];
  assert.deepEqual(ids(multipleAuthors, "author-asc"), [
    "second-first", "primary-first", "no-author"
  ]);

  const dates = [
    { id: "later", title: "Later", created_at: "2024-12-31T23:30:00Z" },
    { id: "earlier", title: "Earlier", created_at: "2025-01-01T00:00:00+02:00" },
    { id: "missing", title: "Missing", created_at: null }
  ];
  assert.deepEqual(ids(dates, "added-asc"), ["earlier", "later", "missing"]);
  assert.deepEqual(ids(dates, "added-desc"), ["later", "earlier", "missing"]);

  const rated = [
    { id: "high", title: "High", publication_year: 2020, personal_rating: 5 },
    { id: "low", title: "Low", publication_year: 1900, personal_rating: 1.5 },
    { id: "unrated", title: "Unrated", publication_year: null, personal_rating: null }
  ];
  assert.deepEqual(ids(rated, "publication-asc"), ["low", "high", "unrated"]);
  assert.deepEqual(ids(rated, "publication-desc"), ["high", "low", "unrated"]);
  assert.deepEqual(ids(rated, "rating-desc"), ["high", "low", "unrated"]);
  assert.deepEqual(ids(rated, "rating-asc"), ["low", "high", "unrated"]);
  assert.deepEqual(ids([
    { id: "b", title: "B", tags: [{ name: "Zèbre" }, { name: "Été" }] },
    { id: "a", title: "A", tags: [{ name: "alpha" }] },
    { id: "none", title: "None", tags: [] }
  ], "tag-asc"), ["a", "b", "none"]);
});

test("sorting is applied after current filters without reloading the library", () => {
  const render = functionBlock("renderWorks");
  assert.match(render, /sortWorks\(works\.filter\(/);
  assert.match(render, /\$\("workSort"\)\.value/);
  const sortEvents = frontend.match(
    /\[\s*"search",[\s\S]*?\]\.forEach\(\(id\) => \{\s*\$\(id\)\.addEventListener\("input", renderWorks\);\s*\$\(id\)\.addEventListener\("change", renderWorks\);\s*\}\);/,
  );
  assert.ok(sortEvents, "all filter and sort controls rerender the list on change");
  assert.doesNotMatch(sortEvents[0], /loadWorks\(/);
  const controls = {
    search: { value: "rose" },
    workTypeFilter: { value: "Roman" },
    priorityFilter: { value: "true" },
    ownershipFilter: { value: "all" },
    readingStatusFilter: { value: "all" },
    workSort: { value: "title-asc" },
    workCount: { textContent: "" },
    workGrid: {
      innerHTML: "",
      querySelectorAll: () => []
    }
  };
  const filteredWorks = [
    { id: "z", title: "Rose Zèbre", work_type: "Roman", is_priority: true, authors: [], tags: [] },
    { id: "a", title: "Rose Alpha", work_type: "Roman", is_priority: true, authors: [], tags: [] },
    { id: "type", title: "Rose Beta", work_type: "Essai", is_priority: true, authors: [], tags: [] },
    { id: "priority", title: "Rose Gamma", work_type: "Roman", is_priority: false, authors: [], tags: [] },
    { id: "query", title: "Autre œuvre", work_type: "Roman", is_priority: true, authors: [], tags: [] }
  ];
  const renderFiltered = runInNewContext(
    `${functionBlock("sortWorks")}\n${functionBlock("renderWorks")}; renderWorks`,
    {
      $: (id) => controls[id],
      works: filteredWorks,
      selectedWorkId: "",
      escapeHTML: (value) => String(value),
      displayName: (item) => item.name || item
    },
  );
  renderFiltered();
  assert.deepEqual(
    Array.from(controls.workGrid.innerHTML.matchAll(/data-work-select="([^"]+)"/g), (match) => match[1]),
    ["a", "z"],
  );
  const sortOptions = html.slice(html.indexOf('id="workSort"'), html.indexOf("</select>", html.indexOf('id="workSort"')));
  assert.equal((sortOptions.match(/<option\b/g) || []).length, 11);
});

test("possession and reading filters expose the persisted nullable work flags", () => {
  for (const column of ["is_owned", "is_read"]) {
    assert.equal(hasColumn("works", column), true, column);
    const schemaRow = columnsSnapshot.split(/\r?\n/).find((line) => {
      const fields = line.split("|").map((field) => field.trim());
      return fields[1] === "works" && fields[3] === column;
    });
    assert.equal(schemaRow.split("|").map((field) => field.trim())[6], "YES");
  }
  assert.match(actionBlock("works_list"), /\.select\("[^"]*is_read, is_owned, created_at"\)/);

  const ownershipFilter = html.slice(
    html.indexOf('id="ownershipFilter"'),
    html.indexOf("</select>", html.indexOf('id="ownershipFilter"')),
  );
  assert.match(ownershipFilter, /<option value="all">Tous les livres<\/option>/);
  assert.match(ownershipFilter, /<option value="true">Possédé<\/option>/);
  assert.match(ownershipFilter, /<option value="false">Non possédé<\/option>/);

  const readingFilter = html.slice(
    html.indexOf('id="readingStatusFilter"'),
    html.indexOf("</select>", html.indexOf('id="readingStatusFilter"')),
  );
  assert.match(readingFilter, /<option value="all">Tous les états<\/option>/);
  assert.match(readingFilter, /<option value="true">Lu<\/option>/);
  assert.match(readingFilter, /<option value="false">Non lu<\/option>/);
});

test("possession and reading filters combine with search and sorting", () => {
  const controls = {
    search: { value: "" },
    workTypeFilter: { value: "all" },
    priorityFilter: { value: "all" },
    ownershipFilter: { value: "all" },
    readingStatusFilter: { value: "all" },
    workSort: { value: "title-asc" },
    workCount: { textContent: "" },
    workGrid: {
      innerHTML: "",
      querySelectorAll: () => []
    }
  };
  const filteredWorks = [
    { id: "owned-unread", title: "Rose Zèbre", work_type: "Roman", is_priority: false, is_owned: true, is_read: false, authors: [], tags: [] },
    { id: "owned-read", title: "Rose Alpha", work_type: "Roman", is_priority: false, is_owned: true, is_read: true, authors: [], tags: [] },
    { id: "not-owned-unread", title: "Rose Beta", work_type: "Roman", is_priority: false, is_owned: false, is_read: false, authors: [], tags: [] },
    { id: "not-owned-read", title: "Rose Gamma", work_type: "Roman", is_priority: false, is_owned: false, is_read: true, authors: [], tags: [] },
    { id: "unknown", title: "Rose Delta", work_type: "Roman", is_priority: false, is_owned: null, is_read: null, authors: [], tags: [] },
    { id: "other-search", title: "Autre", work_type: "Roman", is_priority: false, is_owned: true, is_read: false, authors: [], tags: [] }
  ];
  const context = {
    $: (id) => controls[id],
    works: filteredWorks,
    selectedWorkId: "",
    escapeHTML: (value) => String(value),
    displayName: (item) => item.name || item
  };
  const render = runInNewContext(
    `${functionBlock("sortWorks")}\n${functionBlock("renderWorks")}; renderWorks`,
    context,
  );
  const visibleIds = () => Array.from(
    controls.workGrid.innerHTML.matchAll(/data-work-select="([^"]+)"/g),
    (match) => match[1],
  );

  controls.ownershipFilter.value = "true";
  render();
  assert.deepEqual(visibleIds(), ["other-search", "owned-read", "owned-unread"]);

  controls.ownershipFilter.value = "false";
  controls.readingStatusFilter.value = "true";
  render();
  assert.deepEqual(visibleIds(), ["not-owned-read"]);

  controls.ownershipFilter.value = "all";
  controls.readingStatusFilter.value = "false";
  render();
  assert.deepEqual(visibleIds(), ["other-search", "not-owned-unread", "owned-unread"]);

  controls.search.value = "rose";
  controls.ownershipFilter.value = "true";
  controls.readingStatusFilter.value = "false";
  controls.workSort.value = "title-desc";
  render();
  assert.deepEqual(visibleIds(), ["owned-unread"]);
  assert.match(controls.workGrid.innerHTML, /Rose Zèbre/);

  controls.ownershipFilter.value = "all";
  controls.readingStatusFilter.value = "all";
  controls.search.value = "absent";
  render();
  assert.match(controls.workGrid.innerHTML, /Aucun livre ne correspond aux filtres et à la recherche/);
});

test("reset filters clears filters but preserves the selected sort", () => {
  const controls = {
    search: { value: "recherche" },
    workTypeFilter: { value: "Roman" },
    priorityFilter: { value: "true" },
    ownershipFilter: { value: "false" },
    readingStatusFilter: { value: "true" },
    workSort: { value: "title-desc" }
  };
  let renderCount = 0;
  const reset = runInNewContext(
    `${functionBlock("resetWorkFilters")}; resetWorkFilters`,
    {
      $: (id) => controls[id],
      renderWorks: () => { renderCount += 1; }
    },
  );
  reset();

  assert.equal(controls.search.value, "");
  for (const id of [
    "workTypeFilter", "priorityFilter", "ownershipFilter", "readingStatusFilter"
  ]) {
    assert.equal(controls[id].value, "all");
  }
  assert.equal(controls.workSort.value, "title-desc");
  assert.equal(renderCount, 1);
  assert.match(html, /id="resetFiltersButton"/);
  assert.match(frontend, /\$\("resetFiltersButton"\)\.addEventListener\("click", resetWorkFilters\)/);
  assert.match(frontend, /"ownershipFilter",\s*"readingStatusFilter",\s*"workSort"/);
});
