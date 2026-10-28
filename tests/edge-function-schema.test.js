import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.doesNotMatch(detail, /related_work_id|\.eq\("work_id", id\)[\s\S]{0,100}work_relations/);
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

test("relations have no current write action to exercise", () => {
  assert.doesNotMatch(edgeFunction, /action === "work_relations_(create|set|delete)"/);
});

test("author editor hides role fields and defaults created associations to author", () => {
  assert.match(html, /label for="authorName">Nom de l’auteur/);
  assert.match(html, /id="authorName" maxlength="300"/);
  assert.match(html, /id="addAuthor">Ajouter/);
  assert.match(html, /id="authorAutocomplete"/);
  assert.match(html, /role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="authorSuggestions"/);
  assert.match(html, /id="authorSuggestions"[^>]*role="listbox"/);
  assert.doesNotMatch(html, /authorSelect|addExistingAuthor|newAuthorName|addNewAuthor/);
  assert.doesNotMatch(frontend, /\$\("(?:authorSelect|newAuthorName)"\)/);
  assert.match(frontend, /role: "author"/);
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
