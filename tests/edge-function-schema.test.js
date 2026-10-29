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
const bidirectionalRelationsMigration = readFileSync(
  new URL(
    "../supabase/migrations/20261028163208_add_bidirectional_work_relations.sql",
    import.meta.url,
  ),
  "utf8",
);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const frontend = readFileSync(new URL("../script.js", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const defaultCoverImage = readFileSync(
  new URL("../assets/default-book-cover.png", import.meta.url),
);

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
  const signatureEnd = frontend.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `missing body for function ${functionName}`);
  const open = signatureEnd + 2;
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

test("bidirectional relations persist, reload, and display without a duplicate row", () => {
  assert.match(
    bidirectionalRelationsMigration,
    /ADD COLUMN IF NOT EXISTS is_bidirectional boolean NOT NULL DEFAULT false/i,
  );
  assert.match(frontend, /value: "both", label: "Dans les deux sens"/);
  assert.match(frontend, /is_bidirectional: relation\.direction === "both"/);
  assert.match(frontend, /relations: \[\s*"source_work_id", "target_work_id", "relation_type", "is_bidirectional", "comment"\s*\]/);

  const details = actionBlock("works_detail");
  assert.match(details, /direction: relation\.is_bidirectional\s*\?\s*"both"/);
  const parser = edgeFunctionBlock("parseRelatedInput");
  assert.match(parser, /typeof raw\.is_bidirectional !== "boolean"/);
  assert.match(parser, /is_bidirectional: raw\.is_bidirectional/);
  assert.match(actionBlock("works_related_set"), /is_bidirectional: relation\.is_bidirectional/);

  const markup = runInNewContext(
    `${functionBlock("relatedItemMarkup")}; relatedItemMarkup`,
    {
      escapeHTML: (value = "") => String(value),
      isRichTextField: () => false,
      $: () => ({ value: "current-work" }),
      richTextMarkup: () => "<div data-rich-editor></div>",
      works: [{ id: "related-work", title: "Œuvre liée" }],
      relatedEditor: { reading_sessions: [], editions: [], copies: [] },
      availableLocations: [],
      editorField: (label, field, value, type, options = []) => {
        const choices = options.map((option) =>
          `<option value="${option.value}" ${option.value === value ? "selected" : ""}>${option.label}</option>`
        ).join("");
        return `${label}<select data-related-field="${field}">${choices}</select>`;
      }
    },
  );
  const selectedDirection = markup("relations", {
    id: "relation-id",
    related_work_id: "related-work",
    direction: "both",
    relation_type: "same_subject",
    comment: ""
  }, 0);
  assert.match(selectedDirection, /value="both" selected>Dans les deux sens/);
  assert.match(selectedDirection, /related-editor-item--rich-text-ending/);
  const editionMarkup = markup("editions", { id: "edition-id" }, 0);
  assert.doesNotMatch(editionMarkup, /related-editor-item--rich-text-ending/);
  const richTextSpacingRule = stylesheet.match(
    /\.related-editor-item--rich-text-ending\s*\{([^}]*)\}/,
  )?.[1];
  assert.match(richTextSpacingRule || "", /padding-bottom:\s*20px/);
  const richTextDeleteSpacingRule = stylesheet.match(
    /\.related-editor-item--rich-text-ending\s*>\s*\.delete-button\s*\{([^}]*)\}/,
  )?.[1];
  assert.match(richTextDeleteSpacingRule || "", /margin-top:\s*12px/);

  const reloadedEditor = runInNewContext(
    `${functionBlock("setRelatedEditorData")}; setRelatedEditorData(details); relatedEditor`,
    {
      details: {
        work: { id: "current-work" },
        relations: [{
          id: "relation-id",
          source_work_id: "current-work",
          target_work_id: "related-work",
          is_bidirectional: true
        }]
      },
      relatedEditor: {},
      availableLocations: [],
      renderRelatedEditors: () => {}
    },
  );
  assert.equal(reloadedEditor.relations[0].direction, "both");
  assert.equal(reloadedEditor.relations[0].related_work_id, "related-work");

  const detailsMarkup = runInNewContext(
    `${functionBlock("detailFields")}; detailFields(record)`,
    {
      record: { direction: "both", is_bidirectional: true },
      escapeHTML: (value = "") => String(value),
      isRichTextField: () => false,
      DETAIL_VALUE_LABELS: {
        direction: { both: "Dans les deux sens" }
      },
      formatDetailValue: (field, value) => ({ both: "Dans les deux sens" }[value] || String(value))
    },
  );
  assert.match(detailsMarkup, /<dt>Direction<\/dt><dd>Dans les deux sens<\/dd>/);
  assert.doesNotMatch(detailsMarkup, /is_bidirectional/);
});

test("detail values translate known enums and preserve free text and unknown values", () => {
  const labels = runInNewContext(
    `${frontend.slice(
      frontend.indexOf("const DETAIL_VALUE_LABELS"),
      frontend.indexOf("\nconst $"),
    )}; DETAIL_VALUE_LABELS`,
  );
  const formatValue = runInNewContext(
    `${functionBlock("formatDetailValue")}; formatDetailValue`,
    { DETAIL_VALUE_LABELS: labels },
  );
  const expected = {
    status: {
      planned: "Prévue",
      in_progress: "En cours",
      completed: "Terminée",
      abandoned: "Abandonnée"
    },
    ownership_status: {
      owned: "Possédé",
      borrowed: "Emprunté",
      loaned: "Prêté",
      wanted: "Souhaité",
      digital: "Numérique"
    },
    note_type: {
      quote: "Citation",
      reflection: "Réflexion",
      summary: "Résumé",
      highlight: "Passage important"
    },
    relation_type: {
      same_subject: "Même sujet",
      complements: "Complète",
      contradicts: "Contredit",
      criticizes: "Critique",
      alternative_view: "Point de vue alternatif"
    },
    direction: {
      outgoing: "Cette œuvre est la source",
      incoming: "Cette œuvre est la cible",
      both: "Dans les deux sens"
    },
    category: {
      genre: "Genre",
      theme: "Thème",
      place: "Lieu",
      period: "Période"
    }
  };
  for (const [field, values] of Object.entries(expected)) {
    for (const [stored, displayed] of Object.entries(values)) {
      assert.equal(formatValue(field, stored), displayed, `${field}.${stored}`);
    }
  }
  assert.equal(formatValue("status", "awaiting_review"), "Awaiting review");
  assert.equal(formatValue("format", "Paperback"), "Paperback");
  assert.equal(formatValue("condition", "Très bon état"), "Très bon état");
  assert.equal(formatValue("title", "A Book_Title"), "A Book_Title");

  const renderDetails = functionBlock("detailFields");
  const formattedDetails = runInNewContext(
    `${renderDetails}; detailFields(record)`,
    {
      record: {
        status: "in_progress",
        ownership_status: "borrowed",
        note_type: "reflection",
        relation_type: "alternative_view",
        direction: "incoming",
        title: "A Book_Title",
        comment: "Texte libre original"
      },
      DETAIL_VALUE_LABELS: labels,
      formatDetailValue: (field, value) => formatValue(field, value),
      isRichTextField: () => false,
      escapeHTML: (value = "") => String(value)
    },
  );
  for (const value of [
    "En cours", "Emprunté", "Réflexion", "Point de vue alternatif",
    "Cette œuvre est la cible", "A Book_Title", "Texte libre original"
  ]) {
    assert.ok(formattedDetails.includes(value), value);
  }
  assert.match(frontend, /work\.work_type === workType/);
  assert.match(frontend, /ownership === "all" \|\| work\.is_owned === \(ownership === "true"\)/);
});

test("detail cover remains in its layout position while the page scrolls", () => {
  const coverRule = stylesheet.match(/\.detail-cover-wrap\s*\{([^}]*)\}/)?.[1];
  assert.ok(coverRule, "detail cover wrapper has a CSS rule");
  assert.match(coverRule, /position:\s*static/);
  assert.doesNotMatch(coverRule, /position:\s*(?:sticky|fixed|absolute)/);
});

test("rich text tools cover prose fields while structured fields stay simple", () => {
  for (const [label, field] of [
    ["Notes", "notes"],
    ["Critique", "review"],
    ["Contenu", "content"],
    ["Commentaire", "comment"]
  ]) {
    assert.match(frontend, new RegExp(`richTextMarkup\\("${label}[^"]*", "${field}"`));
  }
  assert.match(html, /id="summaryEditorMount"/);
  assert.match(frontend, /richTextMarkup\(\s*"Résumé",\s*"summary"/);
  assert.match(frontend, /contenteditable="true"/);
  assert.match(frontend, /serializeRichText\(input\.innerHTML\)/);
  assert.match(frontend, /summary: serializeRichText\(\$\("summary"\)\.innerHTML\)/);
  assert.match(frontend, /function sanitizeRichText\(value\)/);
  assert.match(frontend, /RICH_TEXT_PREFIX/);
  assert.match(frontend, /function renderRichText\(value\)/);
  assert.match(frontend, /Ctrl|metaKey|event\.ctrlKey/);
  assert.match(frontend, /return sanitizeRichText\(value\.slice\(RICH_TEXT_PREFIX\.length\)\)/);
  assert.match(frontend, /return escapeHTML\(value\)\.replace\(\/\\r\\n\?\\|\\n\/g, "<br>"\)/);
  assert.match(frontend, /RICH_TEXT_TAGS = new Set/);
  assert.match(frontend, /RICH_TEXT_REMOVED_TAGS = new Set/);
  assert.doesNotMatch(frontend, /editorField\([^)]*"textarea"/);

  const richMarkup = runInNewContext(
    `${functionBlock("richTextMarkup")}; richTextMarkup("Critique", "review", "")`,
    {
      escapeHTML: (value = "") => String(value),
      storedRichTextHTML: () => ""
    },
  );
  for (const command of [
    "bold", "italic", "underline", "strikeThrough",
    "lineBreak", "insertUnorderedList",
    "insertOrderedList", "undo", "redo"
  ]) {
    assert.match(richMarkup, new RegExp(`data-rich-command="${command}"`));
  }
  assert.doesNotMatch(richMarkup, /insertParagraph|Nouveau paragraphe|¶/);
  assert.match(richMarkup, /data-rich-editor data-related-field="review"/);
  const toolbarRule = stylesheet.match(/\.rich-text-toolbar\s*\{([^}]*)\}/)?.[1];
  assert.ok(toolbarRule, "rich text toolbar has a CSS rule");
  assert.match(toolbarRule, /flex-wrap:\s*nowrap/);
  assert.match(toolbarRule, /overflow:\s*hidden/);
  assert.doesNotMatch(toolbarRule, /overflow-x:\s*auto/);
  assert.match(toolbarRule, /max-width:\s*100%/);
  const toolRule = stylesheet.match(/\.rich-text-tool\s*\{([^}]*)\}/)?.[1];
  assert.ok(toolRule, "rich text tool buttons have a CSS rule");
  assert.match(toolRule, /flex:\s*1 1 0/);
  assert.match(toolRule, /min-width:\s*0/);
  assert.match(toolRule, /min-height:\s*38px/);

  for (const simpleField of ["title", "authorName", "isbn", "publisher", "pages", "started_at"]) {
    assert.doesNotMatch(frontend, new RegExp(`richTextMarkup\\([^\\n]*"${simpleField}"`));
  }
  assert.ok(frontend.includes(
    'editorField("Année de publication", "publication_year", item.publication_year, "number"',
  ));
  assert.ok(frontend.includes(
    'editorField("Date de début", "started_at", item.started_at, "date"',
  ));
});

test("the provided image is the default cover while explicit cover URLs are preserved", () => {
  assert.deepEqual(
    [...defaultCoverImage.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  const markup = runInNewContext(
    `${functionBlock("coverImageMarkup")}; ({ missing: coverImageMarkup({ title: "Sans couverture", cover_url: "" }, "book-cover"), provided: coverImageMarkup({ title: "Couverture choisie", cover_url: "https://example.test/cover.jpg" }, "detail-cover") })`,
    {
      DEFAULT_COVER_IMAGE: "./assets/default-book-cover.png",
      escapeHTML: (value = "") => String(value)
    },
  );
  assert.match(markup.missing, /src="\.\/assets\/default-book-cover\.png"/);
  assert.match(markup.missing, /class="book-cover is-default-cover"/);
  assert.match(markup.provided, /src="https:\/\/example\.test\/cover\.jpg"/);
  assert.doesNotMatch(markup.provided, /is-default-cover/);
  assert.match(stylesheet, /\.book-cover\.is-default-cover\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(stylesheet, /\.book-cover\.is-default-cover\s*\{[^}]*background:\s*#eae1d6/s);
  assert.match(stylesheet, /\.book-cover\s*\{[^}]*object-fit:\s*cover/s);
  assert.match(frontend, /attachCoverFallbacks\(panel\)/);
  assert.match(frontend, /attachCoverFallbacks\(grid\)/);
  assert.match(frontend, /img\.src = DEFAULT_COVER_IMAGE/);
  assert.match(frontend, /img\.classList\.add\("is-default-cover"\)/);
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

test("settings list tags with exact associated-work counts and searchable names or categories", () => {
  const listTags = actionBlock("tags_list");
  assert.match(listTags, /\.from\("tags"\)\s*\.select\("\*"\)/);
  assert.match(listTags, /\.from\("work_tags"\)\s*\.select\("work_id", \{ count: "exact", head: true \}\)\s*\.eq\("tag_id", tag\.id\)/);
  assert.match(listTags, /work_count: tagCounts\[index\]\.count \?\? 0/);

  const counts = runInNewContext(
    `${functionBlock("getTagWorkCounts")}; getTagWorkCounts`,
  )([
    { tags: [{ id: "shared" }, { id: "unique-a" }] },
    { tags: [{ id: "shared" }, { id: "shared" }] },
    { tags: [{ id: "unique-b" }] },
  ]);
  assert.equal(counts.get("shared"), 2);
  assert.equal(counts.get("unique-a"), 1);
  assert.equal(counts.get("unique-b"), 1);

  const labels = runInNewContext(
    `${frontend.slice(
      frontend.indexOf("const DETAIL_VALUE_LABELS"),
      frontend.indexOf("\nconst $"),
    )}; DETAIL_VALUE_LABELS`,
  );
  const filterTags = runInNewContext(
    `${functionBlock("filterSettingsTags")}; filterSettingsTags`,
    { DETAIL_VALUE_LABELS: labels },
  );
  const tags = [
    { name: "Fantasy", category: "genre" },
    { name: "Voyage", category: "theme" },
  ];
  assert.equal(filterTags(tags, "fant").length, 1);
  assert.equal(filterTags(tags, "thème").length, 1);
  assert.equal(filterTags(tags, "absent").length, 0);
  assert.match(html, /id="settingsButton"[^>]*>Paramètres/);
  assert.match(html, /id="settingsPage"/);
  assert.equal((html.match(/class="settings-category"/g) || []).length, 1);
});

test("tag renaming preserves associations and rejects duplicate names in a category", () => {
  const updateTag = actionBlock("tags_update");
  assert.match(updateTag, /role !== "edit"/);
  assert.match(updateTag, /typeof body\.name !== "string"/);
  assert.match(updateTag, /\.from\("tags"\)\s*\.update\(\{ name: body\.name\.trim\(\) \}\)\s*\.eq\("id", id\)/);
  assert.match(updateTag, /updateError\.code === "23505"/);
  assert.doesNotMatch(updateTag, /\.from\("work_tags"\)/);
});

test("tag deletion request matches the Edge Function action, UUID, and count validation", () => {
  const tagId = "3b8c2f04-a8cf-4de5-86fb-0e305680086a";
  const buildBody = runInNewContext(
    `${functionBlock("buildEditRequestBody")}; buildEditRequestBody`,
  );
  const request = buildBody(
    "tags_delete",
    "edit-password",
    null,
    tagId,
    { expectedWorkCount: 2 },
  );
  assert.equal(JSON.stringify(request), JSON.stringify({
    password: "edit-password",
    action: "tags_delete",
    id: tagId,
    expectedWorkCount: 2,
  }));
  assert.equal(request.action, "tags_delete");
  assert.equal(typeof request.id, "string");
  assert.equal(typeof request.expectedWorkCount, "number");

  const deleteTag = actionBlock("tags_delete");
  assert.match(deleteTag, /role !== "edit"/);
  assert.match(deleteTag, /typeof body\.expectedWorkCount !== "number"/);
  assert.match(deleteTag, /typeof id !== "string"\s*\|\|\s*!isUuid\(id\)/);
  assert.match(deleteTag, /\.from\("work_tags"\)\s*\.select\("work_id", \{ count: "exact", head: true \}\)\s*\.eq\("tag_id", id\)/);
  assert.match(deleteTag, /workCount !== body\.expectedWorkCount/);
  assert.match(deleteTag, /\.from\("tags"\)\s*\.delete\(\)\s*\.eq\("id", id\)/);
  assert.doesNotMatch(deleteTag, /\.from\("works"\)/);
  assert.match(constraintsSnapshot, /work_tags_tag_id_fkey.*REFERENCES tags\(id\) ON DELETE CASCADE/);
  assert.match(frontend, /Supprimer définitivement le tag/);
  assert.match(frontend, /expectedWorkCount: workCount/);
});

test("tag deletion removes links for multiple works while preserving works and their other tags", async () => {
  const tagId = "3b8c2f04-a8cf-4de5-86fb-0e305680086a";
  const otherTagId = "4c9d3f15-b9d0-5ef6-97fc-1f416791097b";
  const state = {
    tags: [{ id: tagId }, { id: otherTagId }],
    works: [{ id: "work-1" }, { id: "work-2" }],
    links: [
      { work_id: "work-1", tag_id: tagId },
      { work_id: "work-1", tag_id: otherTagId },
      { work_id: "work-2", tag_id: tagId },
      { work_id: "work-2", tag_id: otherTagId },
    ],
  };
  const calls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = "select";
      this.filters = [];
    }

    select(columns, options) {
      calls.push(["select", this.table, columns, options]);
      return this;
    }

    eq(column, value) {
      calls.push(["eq", this.table, column, value]);
      this.filters.push([column, value]);
      return this;
    }

    delete() {
      this.operation = "delete";
      calls.push(["delete", this.table]);
      return this;
    }

    async maybeSingle() {
      const id = this.filters.find(([column]) => column === "id")?.[1];
      const tagIndex = state.tags.findIndex((tag) => tag.id === id);
      if (tagIndex < 0) return { data: null, error: null };
      state.tags.splice(tagIndex, 1);
      state.links = state.links.filter((link) => link.tag_id !== id);
      return { data: { id }, error: null };
    }

    then(resolve, reject) {
      if (this.table !== "work_tags" || this.operation !== "select") {
        return Promise.reject(new Error("Unexpected query")).then(resolve, reject);
      }
      const tagIdFilter = this.filters.find(([column]) => column === "tag_id")?.[1];
      return Promise.resolve({
        count: state.links.filter((link) => link.tag_id === tagIdFilter).length,
        error: null,
      }).then(resolve, reject);
    }
  }

  const context = {
    action: "tags_delete",
    body: { expectedWorkCount: 2 },
    id: tagId,
    role: "edit",
    isUuid: (value) => /^[0-9a-f-]{36}$/.test(value),
    supabase: {
      from(table) {
        calls.push(["from", table]);
        return new Query(table);
      },
    },
    reply: (body, status = 200) => ({ body, status }),
    replyDatabaseError: (_action, message, error) => ({ body: { error: message, details: error }, status: 400 }),
  };
  const result = await runInNewContext(
    `(async function() { ${actionBlock("tags_delete")} })()`,
    context,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), {
    deleted: tagId,
    work_count: 2,
  });
  assert.deepEqual(state.works, [{ id: "work-1" }, { id: "work-2" }]);
  assert.deepEqual(state.tags, [{ id: otherTagId }]);
  assert.deepEqual(state.links, [
    { work_id: "work-1", tag_id: otherTagId },
    { work_id: "work-2", tag_id: otherTagId },
  ]);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "work_tags" && call[2] === "tag_id" && call[3] === tagId));
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "tags" && call[2] === "id" && call[3] === tagId));
});

test("Edge Function errors retain server messages, codes, hints, and non-JSON bodies", () => {
  const formatMessage = runInNewContext(
    `${functionBlock("editRequestErrorMessage")}; editRequestErrorMessage`,
  );
  assert.match(formatMessage("tags_delete", 400, {
    error: "Action inconnue",
  }, '{"error":"Action inconnue"}'), /fonction Edge déployée ne reconnaît pas l’action tags_delete.*HTTP 400/);
  assert.match(formatMessage("tags_delete", 400, {
    message: "permission denied",
    code: "42501",
    hint: "verify function credentials",
  }, ""), /permission denied \(HTTP 400\).*code 42501.*verify function credentials/);
  assert.match(frontend, /bodyPreview = responseText\.trim\(\)\.slice\(0, 1000\)/);
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
    "tags_update",
    "tags_delete",
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
          summary: "summaryEditorMount",
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
  assert.match(frontend, /summary: serializeRichText\(\$\("summary"\)\.innerHTML\)/);
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

test("author editor supports multiple names with simple removal and hidden default role", () => {
  assert.match(html, /label for="authorName">Nom de l’auteur/);
  assert.match(html, /id="authorName" maxlength="300"/);
  assert.match(html, /id="addAuthor">Ajouter/);
  assert.match(html, /id="authorAutocomplete"/);
  assert.match(html, /role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="authorSuggestions"/);
  assert.match(html, /id="authorSuggestions"[^>]*role="listbox"/);
  assert.doesNotMatch(html, /authorSelect|addExistingAuthor|newAuthorName|addNewAuthor/);
  assert.doesNotMatch(frontend, /\$\("(?:authorSelect|newAuthorName)"\)/);
  assert.match(frontend, /role: "author"/);
  const renderSelected = functionBlock("renderSelectedAuthors");
  assert.doesNotMatch(renderSelected, /data-author-role|data-move-author|Rôle|Auteur par défaut/);
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

test("the author editor displays names only and preserves stored roles internally", () => {
  const renderSelected = functionBlock("renderSelectedAuthors");
  const renderSuggestions = functionBlock("updateAuthorSuggestions");
  assert.match(renderSuggestions, /option\.textContent = author\.name/);
  assert.doesNotMatch(renderSelected, /author\.role|Rôle|Auteur par défaut|data-move-author/);
  assert.match(frontend, /role: author\.role \|\| "author"/);
  assert.match(frontend, /role: author\.role,/);
  assert.match(frontend, /author\.role === selected\.role/);

  const container = {
    rendered: "",
    set innerHTML(value) { this.rendered = value; },
    get innerHTML() { return this.rendered; },
    querySelectorAll: () => []
  };
  const markup = runInNewContext(
    `${renderSelected}; renderSelectedAuthors(); container.innerHTML`,
    {
      selectedAuthors: [
        { name: "Auteur existant", role: "author" },
        { name: "Illustrateur", role: "illustrator" }
      ],
      escapeHTML: (value = "") => String(value),
      $: () => container,
      container
    },
  );
  assert.match(markup, /<strong>Auteur existant<\/strong>/);
  assert.match(markup, /<strong>Illustrateur<\/strong>/);
  assert.match(markup, /data-remove-author="0">Retirer/);
  assert.doesNotMatch(markup, /Rôle|Auteur par défaut|↑|↓/);
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

test("resizing preserves an open work form without changing detail-panel positioning", () => {
  const positionDetails = functionBlock("positionWorkDetailsInGrid");
  const panelActions = [];
  const panel = {
    classList: {
      add: (...classes) => panelActions.push(["add", ...classes]),
      remove: (...classes) => panelActions.push(["remove", ...classes]),
    },
  };
  const form = {};
  const grid = {
    querySelectorAll: () => [],
    after: (element) => panelActions.push(["after", element]),
  };
  const position = runInNewContext(
    `${positionDetails}; positionWorkDetailsInGrid`,
    {
      $: (id) => id === "workForm" ? form : id === "workDetails" ? panel : grid,
      selectedWorkId: "",
    },
  );

  position();
  assert.deepEqual(panelActions, []);

  const positionWithoutForm = runInNewContext(
    `${positionDetails}; positionWorkDetailsInGrid`,
    {
      $: (id) => id === "workForm" ? null : id === "workDetails" ? panel : grid,
      selectedWorkId: "",
    },
  );
  positionWithoutForm();
  assert.deepEqual(panelActions, [["add", "hidden"], ["after", panel]]);
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

test("internal sort-selection explanations are not exposed in the public interface", () => {
  for (const phrase of [
    "Plusieurs auteurs",
    "ordre enregistré",
    "Plusieurs éditions",
    "année la plus ancienne",
    "Plusieurs notes",
    "session notée la plus récemment créée",
    "Plusieurs tags",
    "premier nom alphabétique"
  ]) {
    assert.equal(html.includes(phrase), false, phrase);
  }
  assert.doesNotMatch(html, /sortHelp/);
  assert.doesNotMatch(readFileSync(new URL("../style.css", import.meta.url), "utf8"), /\.sort-help/);
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
    workDetails: {},
    workGrid: {
      innerHTML: "",
      after: () => {},
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
      positionWorkDetailsInGrid: () => {},
      escapeHTML: (value) => String(value),
      displayName: (item) => item.name || item,
      DEFAULT_COVER_IMAGE: "./assets/default-book-cover.png",
      coverImageMarkup: (work, className, loading) =>
        `<img class="${className}" src="${work.cover_url || "./assets/default-book-cover.png"}"${loading ? ' loading="lazy"' : ""}>`,
      attachCoverFallbacks: () => {}
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
    workDetails: {},
    workGrid: {
      innerHTML: "",
      after: () => {},
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
    positionWorkDetailsInGrid: () => {},
    escapeHTML: (value) => String(value),
    displayName: (item) => item.name || item,
    DEFAULT_COVER_IMAGE: "./assets/default-book-cover.png",
    coverImageMarkup: (work, className, loading) =>
      `<img class="${className}" src="${work.cover_url || "./assets/default-book-cover.png"}"${loading ? ' loading="lazy"' : ""}>`,
    attachCoverFallbacks: () => {}
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

test("details panel follows the selected card row across grid layouts", () => {
  const placement = functionBlock("positionWorkDetailsInGrid");
  assert.match(functionBlock("renderWorks"), /positionWorkDetailsInGrid\(\)/);
  assert.match(frontend, /window\.addEventListener\("resize",[\s\S]*?positionWorkDetailsInGrid\(\)/);

  class FakeElement {
    constructor(name, offsetTop = 0, workSelect = "") {
      this.name = name;
      this.offsetTop = offsetTop;
      this.dataset = workSelect ? { workSelect } : {};
      this.children = [];
      this.parentNode = null;
      this.hidden = false;
      this.classList = {
        add: () => { this.hidden = true; },
        remove: () => { this.hidden = false; }
      };
    }

    get previousElementSibling() {
      if (!this.parentNode) return null;
      return this.parentNode.children[this.parentNode.children.indexOf(this) - 1] || null;
    }

    insertAfter(reference, node) {
      const currentParent = node.parentNode;
      if (currentParent) currentParent.children.splice(currentParent.children.indexOf(node), 1);
      const index = this.children.indexOf(reference);
      this.children.splice(index + 1, 0, node);
      node.parentNode = this;
    }

    after(node) {
      this.parentNode.insertAfter(this, node);
    }

    querySelectorAll(selector) {
      assert.equal(selector, "[data-work-select]");
      return this.children.filter((child) => child.dataset.workSelect);
    }
  }

  const wrapper = new FakeElement("wrapper");
  const grid = new FakeElement("grid");
  const panel = new FakeElement("panel");
  wrapper.children = [grid, panel];
  grid.parentNode = wrapper;
  panel.parentNode = wrapper;
  const cards = Array.from({ length: 14 }, (_, index) => {
    const card = new FakeElement(
      `card-${index}`,
      Math.floor(index / 6) * 100,
      `book-${index}`,
    );
    card.parentNode = grid;
    return card;
  });
  grid.children = cards;
  let selectedWorkId = "book-0";
  const position = runInNewContext(
    `${functionBlock("findLastCardInRow")}\n${placement}; positionWorkDetailsInGrid`,
    {
    $: (id) => id === "workForm" ? null : id === "workGrid" ? grid : panel,
    get selectedWorkId() { return selectedWorkId; }
    },
  );
  const gridOrder = () => grid.children.map((child) => child.name);

  position();
  assert.deepEqual(gridOrder().slice(0, 7), [
    "card-0", "card-1", "card-2", "card-3", "card-4", "card-5", "panel"
  ]);
  selectedWorkId = "book-8";
  position();
  assert.deepEqual(gridOrder().slice(6, 13), [
    "card-6", "card-7", "card-8", "card-9", "card-10", "card-11", "panel"
  ]);
  selectedWorkId = "book-13";
  position();
  assert.deepEqual(gridOrder().slice(-2), ["card-13", "panel"]);

  cards.forEach((card, index) => {
    card.offsetTop = Math.floor(index / 3) * 100;
  });
  selectedWorkId = "book-4";
  position();
  assert.deepEqual(gridOrder().slice(3, 7), [
    "card-3", "card-4", "card-5", "panel"
  ]);

  selectedWorkId = "";
  position();
  assert.equal(panel.parentNode, wrapper);
  assert.equal(panel.hidden, true);
});

test("delegated card events keep selecting books after rerenders and panel moves", async () => {
  const calls = [];
  const activeCards = new Set();
  const grid = {
    contains: (card) => activeCards.has(card)
  };
  const handlers = {
    click: functionBlock("handleWorkCardClick"),
    keydown: functionBlock("handleWorkCardKeydown")
  };
  assert.match(frontend, /\$\("workGrid"\)\.addEventListener\("click", handleWorkCardClick\)/);
  assert.match(frontend, /\$\("workGrid"\)\.addEventListener\("keydown", handleWorkCardKeydown\)/);
  assert.doesNotMatch(functionBlock("renderWorks"), /card\.addEventListener\("click"/);

  const context = {
    $: (id) => id === "workGrid" ? grid : null,
    openWorkDetails: async (id) => {
      calls.push(id);
      activeCards.clear();
      activeCards.add({ dataset: { workSelect: `after-${id}` } });
    }
  };
  const click = runInNewContext(`${handlers.click}; handleWorkCardClick`, context);
  const keyboard = runInNewContext(`${handlers.keydown}; handleWorkCardKeydown`, context);

  for (const id of ["A", "B", "C", "after-C"]) {
    const card = { dataset: { workSelect: id } };
    activeCards.add(card);
    await click({ target: { closest: () => card } });
  }
  assert.deepEqual(calls, ["A", "B", "C", "after-C"]);

  const keyboardCard = { dataset: { workSelect: "keyboard" } };
  activeCards.add(keyboardCard);
  let prevented = false;
  await keyboard({
    target: { closest: () => keyboardCard },
    key: "Enter",
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(calls.at(-1), "keyboard");

  let staleTargetOpened = false;
  await click({
    target: { closest: () => ({ dataset: { workSelect: "stale" } }) }
  });
  staleTargetOpened = calls.includes("stale");
  assert.equal(staleTargetOpened, false);
});
