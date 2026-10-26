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

      const { data: workTagLinks, error: workTagError } = await supabase
        .from("work_tags")
        .select("work_id, tag_id")
        .in("work_id", workIds);
      if (workTagError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les tags des œuvres",
          workTagError,
        );
      }
      const tagIds = [...new Set(workTagLinks.flatMap((link) =>
        typeof link.tag_id === "string" ? [link.tag_id] : []
      ))];
      const { data: linkedTags, error: linkedTagsError } = tagIds.length
        ? await supabase.from("tags").select("id, name, category").in("id", tagIds)
        : { data: [], error: null };
      if (linkedTagsError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les tags des œuvres",
          linkedTagsError,
        );
      }
      const tagsByWork = new Map<string, Record<string, unknown>[]>();
      for (const link of workTagLinks) {
        const tag = linkedTags.find((item) => item.id === link.tag_id);
        if (!tag) {
          return reply({
            error: "Un tag associé à une œuvre est introuvable",
            code: "INCONSISTENT_WORK_TAG",
          }, 500);
        }
        tagsByWork.set(link.work_id, [...(tagsByWork.get(link.work_id) || []), tag]);
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

      const { data: editions, error: editionsError } = await supabase
        .from("editions").select("*").eq("work_id", id);
      if (editionsError) {
        return replyDatabaseError("works_detail", "Impossible de charger les éditions", editionsError);
      }

      const editionIds = editions.map((edition) => edition.id);
      const { data: copies, error: copiesError } = editionIds.length
        ? await supabase.from("copies").select("*").in("edition_id", editionIds)
        : { data: [], error: null };
      if (copiesError) {
        return replyDatabaseError("works_detail", "Impossible de charger les exemplaires", copiesError);
      }

      const { data: workTagLinks, error: workTagError } = await supabase
        .from("work_tags").select("tag_id").eq("work_id", id);
      if (workTagError) {
        return replyDatabaseError("works_detail", "Impossible de charger les tags de l’œuvre", workTagError);
      }
      const tagIds = [...new Set(workTagLinks.map((link) => link.tag_id))];
      const { data: tags, error: tagsError } = tagIds.length
        ? await supabase.from("tags").select("id, name, category").in("id", tagIds)
        : { data: [], error: null };
      if (tagsError) {
        return replyDatabaseError("works_detail", "Impossible de charger les tags", tagsError);
      }
      if (tags.length !== tagIds.length) {
        return reply({ error: "Un tag associé à l’œuvre est introuvable" }, 500);
      }

      const { data: readingSessions, error: readingSessionsError } = await supabase
        .from("reading_sessions").select("*").eq("work_id", id);
      if (readingSessionsError) {
        return replyDatabaseError("works_detail", "Impossible de charger les sessions de lecture", readingSessionsError);
      }
      const { data: notes, error: notesError } = await supabase
        .from("notes").select("*").eq("work_id", id);
      if (notesError) {
        return replyDatabaseError("works_detail", "Impossible de charger les notes", notesError);
      }

      const [
        { data: relationsFromWork, error: relationsFromError },
        { data: relationsToWork, error: relationsToError },
      ] = await Promise.all([
        supabase.from("work_relations").select("*").eq("source_work_id", id),
        supabase.from("work_relations").select("*").eq("target_work_id", id),
      ]);
      if (relationsFromError) {
        return replyDatabaseError("works_detail", "Impossible de charger les relations sortantes", relationsFromError);
      }
      if (relationsToError) {
        return replyDatabaseError("works_detail", "Impossible de charger les relations entrantes", relationsToError);
      }
      const relations = [...new Map(
        [...relationsFromWork, ...relationsToWork].map((relation) => [relation.id, relation]),
      ).values()];
      const relatedWorkIds = [...new Set(relations.map((relation) =>
        relation.source_work_id === id
          ? relation.target_work_id
          : relation.source_work_id
      ))];
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
        const relatedId = relation.source_work_id === id
          ? relation.target_work_id
          : relation.source_work_id;
        return {
          ...relation,
          related_work_title: relatedTitles.get(relatedId),
        };
      });

      const locationIds = [...new Set(copies.flatMap((copy) =>
        typeof copy.location_id === "string" ? [copy.location_id] : []
      ))];
      const { data: locations, error: locationsError } = locationIds.length
        ? await supabase.from("locations").select("id, name").in("id", locationIds)
        : { data: [], error: null };
      if (locationsError) {
        return replyDatabaseError("works_detail", "Impossible de charger les emplacements", locationsError);
      }
      const locationsById = new Map(locations.map((location) => [location.id, location.name]));
      const copiesWithLocations = copies.map((copy) => ({
        ...copy,
        location_name: locationsById.get(copy.location_id),
      }));

      return reply({
        work: { ...work, authors: workAuthors },
        editions,
        copies: copiesWithLocations,
        tags,
        reading_sessions: readingSessions,
        notes,
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

    if (action === "tags_list") {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .order("name", { ascending: true });
      if (error) return replyDatabaseError("tags_list", "Impossible de charger les tags", error);
      return reply({ tags: data });
    }

    if (action === "tags_create") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }

      const validCategories = ["genre", "theme", "place", "period"];
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        typeof body.category !== "string" ||
        !validCategories.includes(body.category)
      ) {
        return reply({ error: "Nom ou catégorie de tag invalide" }, 400);
      }

      const name = body.name.trim();
      const category = body.category;
      const { data: existingTag, error: existingTagError } = await supabase
        .from("tags")
        .select("id, name, category")
        .eq("category", category)
        .eq("name", name)
        .maybeSingle();
      if (existingTagError) {
        return replyDatabaseError("tags_create", "Impossible de vérifier si le tag existe", existingTagError);
      }
      if (existingTag) return reply({ tag: existingTag, created: false });

      const { data: createdTag, error: createError } = await supabase
        .from("tags")
        .insert({ name, category })
        .select("id, name, category")
        .single();
      if (createError) {
        if (createError.code === "23505") {
          const { data: concurrentTag, error: concurrentTagError } = await supabase
            .from("tags")
            .select("id, name, category")
            .eq("category", category)
            .eq("name", name)
            .maybeSingle();
          if (concurrentTagError) {
            return replyDatabaseError("tags_create", "Impossible de relire le tag existant", concurrentTagError);
          }
          if (concurrentTag) return reply({ tag: concurrentTag, created: false });
        }
        return replyDatabaseError("tags_create", "Impossible de créer le tag", createError);
      }
      if (!createdTag) {
        return reply({ error: "La base n’a pas confirmé la création du tag" }, 500);
      }
      return reply({ tag: createdTag, created: true });
    }

    if (action === "works_tags_set") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }
      if (typeof id !== "string" || !isUuid(id) || !Array.isArray(body.tags)) {
        return reply({ error: "Liste de tags invalide" }, 400);
      }

      const tagIds = body.tags;
      if (
        tagIds.some((tagId) => typeof tagId !== "string" || !isUuid(tagId)) ||
        new Set(tagIds).size !== tagIds.length
      ) {
        return reply({ error: "Liste de tags invalide ou contenant des doublons" }, 400);
      }

      const { data: workRow, error: workCheckError } = await supabase
        .from("works").select("id").eq("id", id).maybeSingle();
      if (workCheckError) {
        return replyDatabaseError("works_tags_set", "Impossible de vérifier l’œuvre", workCheckError);
      }
      if (!workRow) return reply({ error: "Œuvre introuvable" }, 404);

      const { data: selectedTags, error: selectedTagsError } = tagIds.length
        ? await supabase.from("tags").select("id").in("id", tagIds)
        : { data: [], error: null };
      if (selectedTagsError) {
        return replyDatabaseError("works_tags_set", "Impossible de vérifier les tags", selectedTagsError);
      }
      if (selectedTags.length !== tagIds.length) {
        return reply({ error: "Un tag sélectionné n’existe plus" }, 400);
      }

      const { data: existingLinks, error: existingLinksError } = await supabase
        .from("work_tags").select("tag_id").eq("work_id", id);
      if (existingLinksError) {
        return replyDatabaseError("works_tags_set", "Impossible de lire les tags associés", existingLinksError);
      }

      for (const tagId of tagIds) {
        if (existingLinks.some((link) => link.tag_id === tagId)) continue;
        const { error: insertError } = await supabase
          .from("work_tags").insert({ work_id: id, tag_id: tagId });
        if (insertError) {
          return replyDatabaseError("works_tags_set", "Impossible d’associer un tag", insertError);
        }
      }
      for (const link of existingLinks) {
        if (tagIds.includes(link.tag_id)) continue;
        const { error: deleteError } = await supabase
          .from("work_tags").delete().eq("work_id", id).eq("tag_id", link.tag_id);
        if (deleteError) {
          return replyDatabaseError("works_tags_set", "Impossible de retirer un tag", deleteError);
        }
      }
      return reply({ tags: tagIds });
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

      if (error) {
        return replyDatabaseError("list", "Impossible de charger les livres", error);
      }
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

      if (error) {
        return replyDatabaseError("create", "Impossible d'ajouter le livre", error);
      }
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

      if (error) {
        return replyDatabaseError("update", "Impossible de modifier le livre", error);
      }
      return reply({ book: data });
    }

    if (action === "delete") {
      if (typeof id !== "string") {
        return reply({ error: "Identifiant invalide" }, 400);
      }

      const { data, error } = await supabase
        .from("books").delete().eq("id", id).select("id").single();

      if (error) {
        return replyDatabaseError("delete", "Impossible de supprimer le livre", error);
      }
      return reply({ deleted: data.id });
    }

    return reply({ error: "Action inconnue" }, 400);
  } catch (error) {
    console.error("dream-library-edit request failed", error);
    if (error instanceof SyntaxError) {
      return reply({ error: "Requête JSON invalide" }, 400);
    }
    return reply({ error: "Erreur interne lors du traitement de la requête" }, 500);
  }
});
