import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedFields = [
  "title", "author", "cover_url", "summary", "genre",
  "pages", "publication_year", "is_read", "is_owned",
];

const allowedWorkFields = [
  "title", "summary", "cover_url", "original_language", "work_type", "is_priority",
  "is_read", "is_owned",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanWork(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const field of allowedWorkFields) {
    if (field in value) result[field] = value[field];
  }
  return result;
}

function hasValidWorkStatuses(
  value: Record<string, unknown>,
  requireStatuses = false,
): boolean {
  return ["is_read", "is_owned"].every((field) =>
    (field in value || !requireStatuses) &&
      (!(field in value) || value[field] === null || typeof value[field] === "boolean")
  );
}

async function optionalRows(
  supabase: ReturnType<typeof createClient>,
  table: string,
  column: string,
  values: string[],
) {
  if (!values.length) return { rows: [], error: null };

  const { data, error } = await supabase.from(table).select("*").in(column, values);
  if (
    error &&
    isRecord(error) &&
    (error.code === "PGRST205" || error.code === "42703")
  ) {
    return { rows: [], error: null };
  }
  return { rows: data || [], error };
}

interface WorkAuthorInput {
  id?: string;
  name: string;
  role: string;
  position: number;
}

function parseWorkAuthors(value: unknown): WorkAuthorInput[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: WorkAuthorInput[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const author = value[index];
    if (
      !isRecord(author) ||
      typeof author.name !== "string" ||
      (author.id !== undefined && typeof author.id !== "string")
    ) return null;

    const name = author.name.trim();
    const role = typeof author.role === "string" && author.role.trim()
      ? author.role.trim()
      : "author";
    const position = author.position === undefined ? index + 1 : author.position;

    if (
      !name ||
      name.length > 300 ||
      role.length > 80 ||
      !Number.isInteger(position) ||
      (position as number) < 1 ||
      (author.id !== undefined && !isUuid(author.id))
    ) {
      return null;
    }

    const key = `${author.id || name.toLocaleLowerCase("fr")}\u0000${role.toLocaleLowerCase("fr")}`;
    if (seen.has(key)) return null;
    seen.add(key);
    parsed.push({
      ...(typeof author.id === "string" ? { id: author.id } : {}),
      name,
      role,
      position: position as number,
    });
  }

  return parsed;
}

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function replyDatabaseError(action: string, message: string, error: unknown) {
  console.error(`${action} failed`, error);
  const databaseError = isRecord(error) ? error : {};
  return reply({
    error: message,
    ...(typeof databaseError.code === "string" ? { code: databaseError.code } : {}),
    ...(typeof databaseError.message === "string"
      ? { details: databaseError.message }
      : {}),
  }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return reply({ error: "Méthode non autorisée" }, 405);
  }

  try {
    const body = await req.json();
    if (!isRecord(body)) {
      return reply({ error: "Requête invalide" }, 400);
    }

    const { password, action, id, book, work } = body;
    const viewPassword = Deno.env.get("DREAM_LIBRARY_VIEW_PASSWORD");
    const editPassword = Deno.env.get("DREAM_LIBRARY_PASSWORD");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!viewPassword || !editPassword || !supabaseUrl || !serviceKey) {
      return reply({ error: "Configuration serveur incomplète" }, 500);
    }

    if (typeof password !== "string") {
      return reply({ error: "Mot de passe incorrect" }, 401);
    }

    const role = password === editPassword
      ? "edit"
      : password === viewPassword
      ? "view"
      : null;

    if (!role) {
      return reply({ error: "Mot de passe incorrect" }, 401);
    }

    if (action === "verify") {
      return reply({ valid: true, role });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    if (action === "works_list") {
      const { data: works, error: worksError } = await supabase
        .from("works")
        .select("id, title, summary, cover_url, original_language, work_type, is_priority, is_read, is_owned, created_at")
        .order("created_at", { ascending: false });

      if (worksError) {
        return replyDatabaseError("works_list", "Impossible de charger les œuvres", worksError);
      }

      const workIds = works.map((work) => work.id);
      if (!workIds.length) return reply({ works: [] });

      const { data: links, error: linksError } = await supabase
        .from("work_authors")
        .select("work_id, author_id, role, position")
        .in("work_id", workIds)
        .order("position", { ascending: true });

      if (linksError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les auteurs des œuvres",
          linksError,
        );
      }

      const authorIds = [...new Set(links.map((link) => link.author_id))];
      const { data: authors, error: authorsError } = authorIds.length
        ? await supabase.from("authors").select("id, name").in("id", authorIds)
        : { data: [], error: null };

      if (authorsError) {
        return replyDatabaseError("works_list", "Impossible de charger les auteurs", authorsError);
      }

      const authorsById = new Map(authors.map((author) => [author.id, author]));
      const authorsByWork = new Map<string, {
        id: string;
        name: string;
        role: string;
        position: number;
      }[]>();

      for (const link of links) {
        const author = authorsById.get(link.author_id);
        if (!author) continue;
        const workAuthors = authorsByWork.get(link.work_id) || [];
        workAuthors.push({
          id: author.id,
          name: author.name,
          role: link.role,
          position: link.position,
        });
        authorsByWork.set(link.work_id, workAuthors);
      }

      const { rows: workTagLinks, error: workTagError } = await optionalRows(
        supabase,
        "work_tags",
        "work_id",
        workIds,
      );
      if (workTagError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les tags des œuvres",
          workTagError,
        );
      }
      const { rows: directTags, error: directTagsError } = await optionalRows(
        supabase,
        "tags",
        "work_id",
        workIds,
      );
      if (directTagsError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les tags des œuvres",
          directTagsError,
        );
      }
      const tagIds = [...new Set(workTagLinks.flatMap((link) =>
        typeof link.tag_id === "string" ? [link.tag_id] : []
      ))];
      const { rows: linkedTags, error: linkedTagsError } = await optionalRows(
        supabase,
        "tags",
        "id",
        tagIds,
      );
      if (linkedTagsError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les tags des œuvres",
          linkedTagsError,
        );
      }
      const tagsByWork = new Map<string, Record<string, unknown>[]>();
      for (const work of works) {
        if (Array.isArray(work.tags)) {
          tagsByWork.set(work.id, work.tags);
        }
      }
      for (const link of workTagLinks) {
        const tag = linkedTags.find((item) => item.id === link.tag_id) || link;
        if (!tag) continue;
        tagsByWork.set(link.work_id, [...(tagsByWork.get(link.work_id) || []), tag]);
      }
      for (const tag of directTags) {
        if (typeof tag.work_id !== "string") continue;
        tagsByWork.set(tag.work_id, [...(tagsByWork.get(tag.work_id) || []), tag]);
      }

      return reply({
        works: works.map((work) => ({
          ...work,
          authors: authorsByWork.get(work.id) || [],
          tags: tagsByWork.get(work.id) || [],
        })),
      });
    }

    if (action === "works_detail") {
      if (typeof id !== "string" || !isUuid(id)) {
        return reply({ error: "Identifiant d’œuvre invalide" }, 400);
      }

      const { data: work, error: workError } = await supabase
        .from("works").select("*").eq("id", id).maybeSingle();
      if (workError) {
        return replyDatabaseError("works_detail", "Impossible de charger l’œuvre", workError);
      }
      if (!work) return reply({ error: "Œuvre introuvable" }, 404);

      const { data: authorLinks, error: authorLinksError } = await supabase
        .from("work_authors")
        .select("author_id, role, position")
        .eq("work_id", id)
        .order("position", { ascending: true });
      if (authorLinksError) {
        return replyDatabaseError(
          "works_detail",
          "Impossible de charger les auteurs de l’œuvre",
          authorLinksError,
        );
      }

      const authorIds = [...new Set(authorLinks.map((link) => link.author_id))];
      const { data: authors, error: authorsError } = authorIds.length
        ? await supabase.from("authors").select("id, name").in("id", authorIds)
        : { data: [], error: null };
      if (authorsError) {
        return replyDatabaseError("works_detail", "Impossible de charger les auteurs", authorsError);
      }
      const authorsById = new Map(authors.map((author) => [author.id, author]));
      const workAuthors = authorLinks.flatMap((link) => {
        const author = authorsById.get(link.author_id);
        return author
          ? [{ id: author.id, name: author.name, role: link.role, position: link.position }]
          : [];
      });

      const loadOptional = async (table: string, column: string, values: string[]) => {
        const result = await optionalRows(supabase, table, column, values);
        return result.error
          ? { rows: [], response: replyDatabaseError(
            "works_detail",
            `Impossible de charger les informations associées (${table})`,
            result.error,
          ) }
          : { rows: result.rows, response: null };
      };
      const uniqueIds = (rows: Record<string, unknown>[], field: string) =>
        [...new Set(rows.flatMap((row) =>
          typeof row[field] === "string" ? [row[field] as string] : []
        ))];

      const editionsResult = await loadOptional("editions", "work_id", [id]);
      if (editionsResult.response) return editionsResult.response;
      const editions = editionsResult.rows;
      const editionIds = uniqueIds(editions, "id");

      const copiesByWork = await loadOptional("copies", "work_id", [id]);
      if (copiesByWork.response) return copiesByWork.response;
      const copiesByEdition = await loadOptional("copies", "edition_id", editionIds);
      if (copiesByEdition.response) return copiesByEdition.response;
      const copies = [...new Map(
        [...copiesByWork.rows, ...copiesByEdition.rows].map((copy) => [copy.id, copy]),
      ).values()];

      const workTagsResult = await loadOptional("work_tags", "work_id", [id]);
      if (workTagsResult.response) return workTagsResult.response;
      const directTagsResult = await loadOptional("tags", "work_id", [id]);
      if (directTagsResult.response) return directTagsResult.response;
      const tagIds = uniqueIds(workTagsResult.rows, "tag_id");
      const linkedTagsResult = await loadOptional("tags", "id", tagIds);
      if (linkedTagsResult.response) return linkedTagsResult.response;
      const resolvedTagIds = new Set(linkedTagsResult.rows.map((tag) => tag.id));
      const tags = [...new Map(
        [
          ...directTagsResult.rows,
          ...linkedTagsResult.rows,
          ...workTagsResult.rows.filter((link) => !resolvedTagIds.has(link.tag_id)),
        ].map((tag, index) => [
          tag.id || tag.tag_id || JSON.stringify(tag) || index,
          tag,
        ]),
      ).values()];

      const readingSessions = await loadOptional("reading_sessions", "work_id", [id]);
      if (readingSessions.response) return readingSessions.response;
      const readingNotes = await loadOptional("reading_notes", "work_id", [id]);
      if (readingNotes.response) return readingNotes.response;
      const notes = await loadOptional("notes", "work_id", [id]);
      if (notes.response) return notes.response;
      const citations = await loadOptional("citations", "work_id", [id]);
      if (citations.response) return citations.response;
      const passages = await loadOptional("important_passages", "work_id", [id]);
      if (passages.response) return passages.response;

      const relationByWork = await loadOptional("work_relations", "work_id", [id]);
      if (relationByWork.response) return relationByWork.response;
      const relationBySource = await loadOptional("work_relations", "source_work_id", [id]);
      if (relationBySource.response) return relationBySource.response;
      const relationByTarget = await loadOptional("work_relations", "target_work_id", [id]);
      if (relationByTarget.response) return relationByTarget.response;
      const relations = [...new Map(
        [
          ...relationByWork.rows,
          ...relationBySource.rows,
          ...relationByTarget.rows,
        ].map((relation) => [
          relation.id || JSON.stringify(relation),
          relation,
        ]),
      ).values()];
      const relatedWorkIds = [...new Set(relations.flatMap((relation) => [
        relation.related_work_id,
        relation.target_work_id,
        relation.source_work_id,
      ].filter((relatedId): relatedId is string =>
        typeof relatedId === "string" && relatedId !== id
      )))];
      const { data: relatedWorks, error: relatedWorksError } = relatedWorkIds.length
        ? await supabase.from("works").select("id, title").in("id", relatedWorkIds)
        : { data: [], error: null };
      if (relatedWorksError) {
        return replyDatabaseError(
          "works_detail",
          "Impossible de charger les œuvres liées",
          relatedWorksError,
        );
      }
      const relatedTitles = new Map(relatedWorks.map((relatedWork) => [
        relatedWork.id,
        relatedWork.title,
      ]));
      const relationsWithTitles = relations.map((relation) => {
        const relatedId = [
          relation.related_work_id,
          relation.target_work_id,
          relation.source_work_id,
        ].find((relatedId) =>
          typeof relatedId === "string" && relatedId !== id
        );
        return {
          ...relation,
          related_work_title: typeof relatedId === "string"
            ? relatedTitles.get(relatedId)
            : undefined,
        };
      });

      const locationIds = uniqueIds(copies, "location_id");
      const locationsResult = await loadOptional("locations", "id", locationIds);
      if (locationsResult.response) return locationsResult.response;
      const locationsById = new Map(locationsResult.rows.map((location) => [
        location.id,
        location.name || location.label || location.location,
      ]));
      const copiesWithLocations = copies.map((copy) => ({
        ...copy,
        location_name: locationsById.get(copy.location_id),
      }));

      return reply({
        work: { ...work, authors: workAuthors },
        editions,
        copies: copiesWithLocations,
        tags,
        reading_sessions: readingSessions.rows,
        notes: [
          ...readingNotes.rows,
          ...notes.rows,
          ...citations.rows,
          ...passages.rows,
        ],
        relations: relationsWithTitles,
      });
    }

    if (action === "works_authors_get") {
      if (typeof id !== "string") {
        return reply({ error: "Identifiant d’œuvre invalide" }, 400);
      }

      const { data: links, error: linksError } = await supabase
        .from("work_authors")
        .select("author_id, role, position")
        .eq("work_id", id)
        .order("position", { ascending: true });

      if (linksError) {
        return replyDatabaseError(
          "works_authors_get",
          "Impossible de charger les auteurs de l’œuvre",
          linksError,
        );
      }

      const authorIds = links.map((link) => link.author_id);
      const { data: authors, error: authorsError } = authorIds.length
        ? await supabase.from("authors").select("id, name").in("id", authorIds)
        : { data: [], error: null };

      if (authorsError) {
        return replyDatabaseError(
          "works_authors_get",
          "Impossible de charger les auteurs",
          authorsError,
        );
      }

      const authorsById = new Map(authors.map((author) => [author.id, author]));
      return reply({
        authors: links.flatMap((link) => {
          const author = authorsById.get(link.author_id);
          return author
            ? [{ id: author.id, name: author.name, role: link.role, position: link.position }]
            : [];
        }),
      });
    }

    if (action === "authors_list") {
      const { data, error } = await supabase
        .from("authors")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) return replyDatabaseError("authors_list", "Impossible de charger les auteurs", error);
      return reply({ authors: data });
    }

    if (action === "works_create") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }
      if (!isRecord(work) || typeof work.title !== "string" || !work.title.trim()) {
        return reply({ error: "Le titre de l’œuvre est obligatoire" }, 400);
      }
      if (!hasValidWorkStatuses(work, true)) {
        return reply({
          error: "Les statuts de lecture et de possession doivent être fournis comme booléens ou null",
        }, 400);
      }

      const { data, error } = await supabase
        .from("works").insert(cleanWork(work)).select().single();

      if (error) return replyDatabaseError("works_create", "Impossible d'ajouter l’œuvre", error);
      return reply({ work: data }, 201);
    }

    if (action === "works_update") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }
      if (typeof id !== "string" || !isRecord(work)) {
        return reply({ error: "Données d’œuvre invalides" }, 400);
      }
      if (!hasValidWorkStatuses(work, true)) {
        return reply({
          error: "Les statuts de lecture et de possession doivent être fournis comme booléens ou null",
        }, 400);
      }

      const updates = cleanWork(work);
      if (typeof updates.title !== "string" || !updates.title.trim()) {
        return reply({ error: "Le titre de l’œuvre est obligatoire" }, 400);
      }

      const { data, error } = await supabase
        .from("works").update(updates).eq("id", id).select().single();

      if (error) return replyDatabaseError("works_update", "Impossible de modifier l’œuvre", error);
      return reply({ work: data });
    }

    if (action === "works_delete") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }
      if (typeof id !== "string" || !isUuid(id)) {
        return reply({ error: "Identifiant d’œuvre invalide" }, 400);
      }

      const { data, error } = await supabase
        .from("works").delete().eq("id", id).select("id").maybeSingle();

      if (error) {
        return replyDatabaseError("works_delete", "Impossible de supprimer l’œuvre", error);
      }
      if (!data) return reply({ error: "Œuvre introuvable" }, 404);
      return reply({ deleted: data.id });
    }

    if (action === "works_authors_set") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }
      if (typeof id !== "string") {
        return reply({ error: "Identifiant d’œuvre invalide" }, 400);
      }

      const workAuthors = parseWorkAuthors(body.authors);
      if (!workAuthors) {
        return reply({ error: "Liste d’auteurs invalide ou contenant des doublons" }, 400);
      }

      const { data: work, error: workError } = await supabase
        .from("works").select("id").eq("id", id).maybeSingle();
      if (workError) {
        return replyDatabaseError(
          "works_authors_set",
          "Impossible de vérifier l’œuvre",
          workError,
        );
      }
      if (!work) return reply({ error: "Œuvre introuvable" }, 404);

      const { data: existingLinks, error: existingError } = await supabase
        .from("work_authors")
        .select("author_id, role")
        .eq("work_id", id);
      if (existingError) {
        return replyDatabaseError(
          "works_authors_set",
          "Impossible de lire les auteurs existants",
          existingError,
        );
      }

      const selectedAuthorIds = [...new Set(
        workAuthors.flatMap((author) => author.id ? [author.id] : []),
      )];
      const authorIdsByName = new Map<string, string>();
      if (selectedAuthorIds.length) {
        const { data: selectedRows, error: selectedError } = await supabase
          .from("authors")
          .select("id, name")
          .in("id", selectedAuthorIds);
        if (selectedError) {
          return replyDatabaseError(
            "works_authors_set",
            "Impossible de vérifier les auteurs sélectionnés",
            selectedError,
          );
        }
        if (selectedRows.length !== selectedAuthorIds.length) {
          return reply({ error: "Un auteur sélectionné n’existe plus" }, 400);
        }
        for (const author of selectedRows) {
          authorIdsByName.set(author.name, author.id);
        }
      }

      const newAuthorNames = [...new Set(
        workAuthors.filter((author) => !author.id).map(({ name }) => name),
      )];
      if (newAuthorNames.length) {
        const authorRows = newAuthorNames
          .map((name) => ({ name }));
        const { data: savedAuthors, error: saveAuthorsError } = await supabase
          .from("authors")
          .upsert(authorRows, { onConflict: "name" })
          .select("id, name");

        if (saveAuthorsError) {
          return replyDatabaseError(
            "works_authors_set",
            "Impossible d'enregistrer les auteurs",
            saveAuthorsError,
          );
        }
        for (const author of savedAuthors) {
          authorIdsByName.set(author.name, author.id);
        }
      }

      const newLinks: {
        work_id: string;
        author_id: string;
        role: string;
        position: number;
      }[] = [];
      for (const author of workAuthors) {
        const authorId = author.id || authorIdsByName.get(author.name);
        if (!authorId) {
          return reply({ error: "Un auteur n’a pas pu être retrouvé après enregistrement" }, 400);
        }
        newLinks.push({
          work_id: id,
          author_id: authorId,
          role: author.role,
          position: author.position,
        });
      }

      if (newLinks.length) {
        const { error: saveLinksError } = await supabase
          .from("work_authors")
          .upsert(newLinks, { onConflict: "work_id,author_id,role" });
        if (saveLinksError) {
          return replyDatabaseError(
            "works_authors_set",
            "Impossible d'enregistrer les liens d’auteurs",
            saveLinksError,
          );
        }
      }

      const retainedKeys = new Set(
        newLinks.map((link) => `${link.author_id}\u0000${link.role}`),
      );
      for (const link of existingLinks) {
        if (retainedKeys.has(`${link.author_id}\u0000${link.role}`)) continue;
        const { error: deleteLinkError } = await supabase
          .from("work_authors")
          .delete()
          .eq("work_id", id)
          .eq("author_id", link.author_id)
          .eq("role", link.role);
        if (deleteLinkError) {
          return replyDatabaseError(
            "works_authors_set",
            "Certains anciens liens d’auteurs n’ont pas pu être retirés",
            deleteLinkError,
          );
        }
      }

      return reply({
        authors: newLinks.map((link, index) => ({
          id: link.author_id,
          name: workAuthors[index].name,
          role: link.role,
          position: link.position,
        })),
      });
    }

    if (action === "list") {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) return reply({ error: "Impossible de charger les livres" }, 400);
      return reply({ books: data });
    }

    if (role !== "edit") {
      return reply({ error: "Droits d’édition insuffisants" }, 403);
    }

    if (action === "create") {
      if (
        !isRecord(book) ||
        typeof book.title !== "string" ||
        !book.title.trim()
      ) {
        return reply({ error: "Le titre est obligatoire" }, 400);
      }

      const cleanBook: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (field in book) cleanBook[field] = book[field];
      }

      const { data, error } = await supabase
        .from("books").insert(cleanBook).select().single();

      if (error) return reply({ error: "Impossible d'ajouter le livre" }, 400);
      return reply({ book: data }, 201);
    }

    if (action === "update") {
      if (
        typeof id !== "string" ||
        !isRecord(book)
      ) {
        return reply({ error: "Données invalides" }, 400);
      }

      const cleanBook: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (field in book) cleanBook[field] = book[field];
      }

      const { data, error } = await supabase
        .from("books").update(cleanBook).eq("id", id).select().single();

      if (error) return reply({ error: "Impossible de modifier le livre" }, 400);
      return reply({ book: data });
    }

    if (action === "delete") {
      if (typeof id !== "string") {
        return reply({ error: "Identifiant invalide" }, 400);
      }

      const { data, error } = await supabase
        .from("books").delete().eq("id", id).select("id").single();

      if (error) return reply({ error: "Impossible de supprimer le livre" }, 400);
      return reply({ deleted: data.id });
    }

    return reply({ error: "Action inconnue" }, 400);
  } catch {
    return reply({ error: "Requête invalide" }, 400);
  }
});
