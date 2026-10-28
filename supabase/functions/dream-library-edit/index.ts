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

interface RelatedInput {
  editions: {
    id: string;
    isbn: string | null;
    publisher: string | null;
    publication_year: number | null;
    language: string | null;
    format: string | null;
    pages: number | null;
  }[];
  copies: {
    id: string;
    edition_id: string;
    ownership_status: string;
    location_id: string | null;
    condition: string | null;
    acquired_at: string | null;
    notes: string | null;
  }[];
  reading_sessions: {
    id: string;
    copy_id: string | null;
    started_at: string | null;
    finished_at: string | null;
    status: string;
    rating: number | null;
    review: string | null;
  }[];
  notes: {
    id: string;
    reading_session_id: string | null;
    note_type: string;
    content: string;
    page: string | null;
    chapter: string | null;
  }[];
  relations: {
    id: string;
    source_work_id: string;
    target_work_id: string;
    relation_type: string;
    comment: string | null;
  }[];
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

function validDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parseRelatedInput(value: unknown, workId: string): RelatedInput | null {
  if (!isRecord(value)) return null;
  const arrayFields = [
    "editions", "copies", "reading_sessions", "notes", "relations"
  ] as const;
  if (arrayFields.some((field) => !Array.isArray(value[field]))) return null;

  const editions: RelatedInput["editions"] = [];
  for (const raw of value.editions as unknown[]) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !isUuid(raw.id)) return null;
    const isbn = nullableText(raw.isbn);
    const publisher = nullableText(raw.publisher);
    const language = nullableText(raw.language);
    const format = nullableText(raw.format);
    const year = raw.publication_year;
    const pages = raw.pages;
    if (
      isbn === undefined || publisher === undefined || language === undefined ||
      format === undefined ||
      (year !== null && (!Number.isInteger(year) || (year as number) < 1 || (year as number) > 9999)) ||
      (pages !== null && (!Number.isInteger(pages) || (pages as number) < 1))
    ) return null;
    editions.push({
      id: raw.id,
      isbn,
      publisher,
      publication_year: year as number | null,
      language,
      format,
      pages: pages as number | null,
    });
  }

  const copies: RelatedInput["copies"] = [];
  for (const raw of value.copies as unknown[]) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !isUuid(raw.id) ||
      typeof raw.edition_id !== "string" ||
      !isUuid(raw.edition_id) ||
      !["owned", "borrowed", "loaned", "wanted", "digital"].includes(
        String(raw.ownership_status),
      )
    ) return null;
    const locationId = raw.location_id;
    const condition = nullableText(raw.condition);
    const acquiredAt = raw.acquired_at;
    const notes = nullableText(raw.notes);
    if (
      (locationId !== null && (typeof locationId !== "string" || !isUuid(locationId))) ||
      condition === undefined ||
      !validDate(acquiredAt) ||
      notes === undefined
    ) return null;
    copies.push({
      id: raw.id,
      edition_id: raw.edition_id,
      ownership_status: raw.ownership_status as string,
      location_id: locationId as string | null,
      condition,
      acquired_at: acquiredAt,
      notes,
    });
  }

  const readingSessions: RelatedInput["reading_sessions"] = [];
  for (const raw of value.reading_sessions as unknown[]) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !isUuid(raw.id) ||
      !["planned", "in_progress", "completed", "abandoned"].includes(String(raw.status))
    ) return null;
    const copyId = raw.copy_id;
    const startedAt = raw.started_at;
    const finishedAt = raw.finished_at;
    const review = nullableText(raw.review);
    const rating = raw.rating;
    if (
      (copyId !== null && (typeof copyId !== "string" || !isUuid(copyId))) ||
      !validDate(startedAt) ||
      !validDate(finishedAt) ||
      review === undefined ||
      (rating !== null &&
        (typeof rating !== "number" || rating < 0.5 || rating > 5 || rating * 2 % 1 !== 0))
    ) return null;
    readingSessions.push({
      id: raw.id,
      copy_id: copyId as string | null,
      started_at: startedAt,
      finished_at: finishedAt,
      status: raw.status as string,
      rating: rating as number | null,
      review,
    });
  }

  const notes: RelatedInput["notes"] = [];
  for (const raw of value.notes as unknown[]) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !isUuid(raw.id) ||
      !["quote", "reflection", "summary", "highlight"].includes(String(raw.note_type)) ||
      typeof raw.content !== "string" ||
      !raw.content.trim()
    ) return null;
    const sessionId = raw.reading_session_id;
    const page = nullableText(raw.page);
    const chapter = nullableText(raw.chapter);
    if (
      (sessionId !== null && (typeof sessionId !== "string" || !isUuid(sessionId))) ||
      page === undefined ||
      chapter === undefined
    ) return null;
    notes.push({
      id: raw.id,
      reading_session_id: sessionId as string | null,
      note_type: raw.note_type as string,
      content: raw.content.trim(),
      page,
      chapter,
    });
  }

  const relations: RelatedInput["relations"] = [];
  const relationKeys = new Set<string>();
  for (const raw of value.relations as unknown[]) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !isUuid(raw.id) ||
      typeof raw.source_work_id !== "string" ||
      !isUuid(raw.source_work_id) ||
      typeof raw.target_work_id !== "string" ||
      !isUuid(raw.target_work_id) ||
      raw.source_work_id === raw.target_work_id ||
      (raw.source_work_id !== workId && raw.target_work_id !== workId) ||
      !["same_subject", "complements", "contradicts", "criticizes", "alternative_view"]
        .includes(String(raw.relation_type))
    ) return null;
    const comment = nullableText(raw.comment);
    const key = `${raw.source_work_id}\u0000${raw.target_work_id}\u0000${raw.relation_type}`;
    if (comment === undefined || relationKeys.has(key)) return null;
    relationKeys.add(key);
    relations.push({
      id: raw.id,
      source_work_id: raw.source_work_id,
      target_work_id: raw.target_work_id,
      relation_type: raw.relation_type as string,
      comment,
    });
  }

  for (const [items, label] of [
    [editions, "editions"],
    [copies, "copies"],
    [readingSessions, "reading sessions"],
    [notes, "notes"],
    [relations, "relations"],
  ] as const) {
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      console.error(`works_related_set has duplicate ${label}`);
      return null;
    }
  }

  const editionIds = new Set(editions.map((edition) => edition.id));
  const copyIds = new Set(copies.map((copy) => copy.id));
  const sessionIds = new Set(readingSessions.map((session) => session.id));
  if (
    copies.some((copy) => !editionIds.has(copy.edition_id)) ||
    readingSessions.some((session) => session.copy_id && !copyIds.has(session.copy_id)) ||
    notes.some((note) => note.reading_session_id && !sessionIds.has(note.reading_session_id))
  ) return null;

  return {
    editions,
    copies,
    reading_sessions: readingSessions,
    notes,
    relations,
  };
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

      const [{ data: editions, error: editionsError }, { data: readingSessions, error: sessionsError }] =
        await Promise.all([
          supabase.from("editions").select("work_id, publication_year").in("work_id", workIds),
          supabase.from("reading_sessions")
            .select("id, work_id, rating, created_at")
            .in("work_id", workIds)
            .not("rating", "is", null)
            .order("created_at", { ascending: false })
            .order("id", { ascending: true }),
        ]);

      if (editionsError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les années de publication",
          editionsError,
        );
      }
      if (sessionsError) {
        return replyDatabaseError(
          "works_list",
          "Impossible de charger les notes des œuvres",
          sessionsError,
        );
      }

      const publicationYearByWork = new Map<string, number>();
      for (const edition of editions) {
        const year = edition.publication_year;
        if (
          typeof year === "number" &&
          Number.isInteger(year) &&
          (!publicationYearByWork.has(edition.work_id) ||
            year < publicationYearByWork.get(edition.work_id)!)
        ) {
          publicationYearByWork.set(edition.work_id, year);
        }
      }

      const personalRatingByWork = new Map<string, number>();
      for (const session of readingSessions) {
        if (
          typeof session.rating === "number" &&
          !personalRatingByWork.has(session.work_id)
        ) {
          personalRatingByWork.set(session.work_id, session.rating);
        }
      }

      const { data: links, error: linksError } = await supabase
        .from("work_authors")
        .select("work_id, author_id, role, position")
        .in("work_id", workIds)
        .order("position", { ascending: true })
        .order("author_id", { ascending: true });

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
          publication_year: publicationYearByWork.get(work.id) ?? null,
          personal_rating: personalRatingByWork.get(work.id) ?? null,
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
          related_work_id: relatedId,
          direction: relation.source_work_id === id ? "outgoing" : "incoming",
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

    if (action === "locations_list") {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, parent_id")
        .order("name", { ascending: true });
      if (error) {
        return replyDatabaseError("locations_list", "Impossible de charger les emplacements", error);
      }
      return reply({ locations: data });
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

    if (action === "authors_resolve") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.trim().length > 300
      ) {
        return reply({ error: "Nom d’auteur invalide" }, 400);
      }

      const { data, error } = await supabase.rpc("resolve_author", {
        p_name: body.name.trim(),
      });
      if (error) {
        return replyDatabaseError(
          "authors_resolve",
          "Impossible de retrouver ou créer l’auteur",
          error,
        );
      }
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isRecord(data[0]) ||
        typeof data[0].id !== "string" ||
        typeof data[0].name !== "string"
      ) {
        return reply({ error: "La base n’a pas confirmé la résolution de l’auteur" }, 500);
      }
      return reply({ author: data[0] });
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

    if (action === "works_related_set") {
      if (role !== "edit") {
        return reply({ error: "Droits d’édition insuffisants" }, 403);
      }
      if (typeof id !== "string" || !isUuid(id)) {
        return reply({ error: "Identifiant d’œuvre invalide" }, 400);
      }

      const related = parseRelatedInput(body.related, id);
      if (!related) {
        return reply({ error: "Les informations associées sont invalides" }, 400);
      }

      const { data: workRow, error: workCheckError } = await supabase
        .from("works").select("id").eq("id", id).maybeSingle();
      if (workCheckError) {
        return replyDatabaseError("works_related_set", "Impossible de vérifier l’œuvre", workCheckError);
      }
      if (!workRow) return reply({ error: "Œuvre introuvable" }, 404);

      const [
        { data: existingEditions, error: editionsReadError },
        { data: existingSessions, error: sessionsReadError },
        { data: existingNotes, error: notesReadError },
        { data: outgoingRelations, error: outgoingError },
        { data: incomingRelations, error: incomingError },
      ] = await Promise.all([
        supabase.from("editions").select("id").eq("work_id", id),
        supabase.from("reading_sessions").select("id").eq("work_id", id),
        supabase.from("notes").select("id").eq("work_id", id),
        supabase.from("work_relations").select("id").eq("source_work_id", id),
        supabase.from("work_relations").select("id").eq("target_work_id", id),
      ]);
      if (editionsReadError) {
        return replyDatabaseError("works_related_set", "Impossible de vérifier les éditions", editionsReadError);
      }
      if (sessionsReadError) {
        return replyDatabaseError("works_related_set", "Impossible de vérifier les sessions de lecture", sessionsReadError);
      }
      if (notesReadError) {
        return replyDatabaseError("works_related_set", "Impossible de vérifier les notes", notesReadError);
      }
      if (outgoingError || incomingError) {
        return replyDatabaseError(
          "works_related_set",
          "Impossible de vérifier les relations de l’œuvre",
          outgoingError || incomingError,
        );
      }

      const existingEditionIds = existingEditions.map((item) => item.id);
      const { data: existingCopies, error: copiesReadError } = existingEditionIds.length
        ? await supabase.from("copies").select("id").in("edition_id", existingEditionIds)
        : { data: [], error: null };
      if (copiesReadError) {
        return replyDatabaseError("works_related_set", "Impossible de vérifier les exemplaires", copiesReadError);
      }

      const relatedWorkIds = [...new Set(related.relations.flatMap((relation) => [
        relation.source_work_id,
        relation.target_work_id,
      ]).filter((workId) => workId !== id))];
      const { data: relatedWorkRows, error: relatedWorksError } = relatedWorkIds.length
        ? await supabase.from("works").select("id").in("id", relatedWorkIds)
        : { data: [], error: null };
      if (relatedWorksError) {
        return replyDatabaseError("works_related_set", "Impossible de vérifier les œuvres liées", relatedWorksError);
      }
      if (relatedWorkRows.length !== relatedWorkIds.length) {
        return reply({ error: "Une œuvre liée n’existe plus" }, 400);
      }

      const locationIds = [...new Set(related.copies.flatMap((copy) =>
        copy.location_id ? [copy.location_id] : []
      ))];
      const { data: locationRows, error: locationsError } = locationIds.length
        ? await supabase.from("locations").select("id").in("id", locationIds)
        : { data: [], error: null };
      if (locationsError) {
        return replyDatabaseError("works_related_set", "Impossible de vérifier les emplacements", locationsError);
      }
      if (locationRows.length !== locationIds.length) {
        return reply({ error: "Un emplacement sélectionné n’existe plus" }, 400);
      }

      const editionIds = new Set(related.editions.map((item) => item.id));
      const copyIds = new Set(related.copies.map((item) => item.id));
      const sessionIds = new Set(related.reading_sessions.map((item) => item.id));
      const noteIds = new Set(related.notes.map((item) => item.id));
      const relationRows = [...new Map(
        [...outgoingRelations, ...incomingRelations].map((item) => [item.id, item]),
      ).values()];

      for (const edition of related.editions) {
        const exists = existingEditions.some((item) => item.id === edition.id);
        const values = {
          isbn: edition.isbn,
          publisher: edition.publisher,
          publication_year: edition.publication_year,
          language: edition.language,
          format: edition.format,
          pages: edition.pages,
        };
        const result = exists
          ? await supabase.from("editions").update(values).eq("id", edition.id).eq("work_id", id)
          : await supabase.from("editions").insert({ id: edition.id, work_id: id, ...values });
        if (result.error) {
          return replyDatabaseError("works_related_set", "Impossible d’enregistrer une édition", result.error);
        }
      }

      for (const copy of related.copies) {
        const exists = existingCopies.some((item) => item.id === copy.id);
        const values = {
          edition_id: copy.edition_id,
          ownership_status: copy.ownership_status,
          location_id: copy.location_id,
          condition: copy.condition,
          acquired_at: copy.acquired_at,
          notes: copy.notes,
        };
        const result = exists
          ? await supabase.from("copies").update(values).eq("id", copy.id)
          : await supabase.from("copies").insert({ id: copy.id, ...values });
        if (result.error) {
          return replyDatabaseError("works_related_set", "Impossible d’enregistrer un exemplaire", result.error);
        }
      }

      for (const session of related.reading_sessions) {
        const exists = existingSessions.some((item) => item.id === session.id);
        const values = {
          copy_id: session.copy_id,
          started_at: session.started_at,
          finished_at: session.finished_at,
          status: session.status,
          rating: session.rating,
          review: session.review,
        };
        const result = exists
          ? await supabase.from("reading_sessions").update(values).eq("id", session.id).eq("work_id", id)
          : await supabase.from("reading_sessions").insert({ id: session.id, work_id: id, ...values });
        if (result.error) {
          return replyDatabaseError("works_related_set", "Impossible d’enregistrer une session de lecture", result.error);
        }
      }

      for (const note of related.notes) {
        const exists = existingNotes.some((item) => item.id === note.id);
        const values = {
          reading_session_id: note.reading_session_id,
          note_type: note.note_type,
          content: note.content,
          page: note.page,
          chapter: note.chapter,
        };
        const result = exists
          ? await supabase.from("notes").update(values).eq("id", note.id).eq("work_id", id)
          : await supabase.from("notes").insert({ id: note.id, work_id: id, ...values });
        if (result.error) {
          return replyDatabaseError("works_related_set", "Impossible d’enregistrer une note", result.error);
        }
      }

      for (const relation of related.relations) {
        const exists = relationRows.some((item) => item.id === relation.id);
        const values = {
          source_work_id: relation.source_work_id,
          target_work_id: relation.target_work_id,
          relation_type: relation.relation_type,
          comment: relation.comment,
        };
        const result = exists
          ? await supabase.from("work_relations").update(values).eq("id", relation.id)
          : await supabase.from("work_relations").insert({ id: relation.id, ...values });
        if (result.error) {
          return replyDatabaseError("works_related_set", "Impossible d’enregistrer une relation", result.error);
        }
      }

      const deleteOmitted = async (
        table: string,
        existing: { id: string }[],
        retained: Set<string>,
        ownerColumn?: string,
      ) => {
        for (const record of existing) {
          if (retained.has(record.id)) continue;
          let query = supabase.from(table).delete().eq("id", record.id);
          if (ownerColumn) query = query.eq(ownerColumn, id);
          const { error } = await query;
          if (error) {
            return error;
          }
        }
        return null;
      };

      const notesDeleteError = await deleteOmitted("notes", existingNotes, noteIds, "work_id");
      if (notesDeleteError) {
        return replyDatabaseError("works_related_set", "Impossible de retirer une note", notesDeleteError);
      }
      const sessionsDeleteError = await deleteOmitted(
        "reading_sessions",
        existingSessions,
        sessionIds,
        "work_id",
      );
      if (sessionsDeleteError) {
        return replyDatabaseError("works_related_set", "Impossible de retirer une session de lecture", sessionsDeleteError);
      }
      const copiesDeleteError = await deleteOmitted("copies", existingCopies, copyIds);
      if (copiesDeleteError) {
        return replyDatabaseError("works_related_set", "Impossible de retirer un exemplaire", copiesDeleteError);
      }
      const retainedRelationIds = new Set(related.relations.map((item) => item.id));
      const relationsDeleteError = await deleteOmitted("work_relations", relationRows, retainedRelationIds);
      if (relationsDeleteError) {
        return replyDatabaseError("works_related_set", "Impossible de retirer une relation", relationsDeleteError);
      }
      const editionsDeleteError = await deleteOmitted(
        "editions",
        existingEditions,
        editionIds,
        "work_id",
      );
      if (editionsDeleteError) {
        return replyDatabaseError("works_related_set", "Impossible de retirer une édition", editionsDeleteError);
      }

      return reply({
        saved: true,
        counts: {
          editions: related.editions.length,
          copies: related.copies.length,
          reading_sessions: related.reading_sessions.length,
          notes: related.notes.length,
          relations: related.relations.length,
        },
      });
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
      const authorNamesById = new Map<string, string>();
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
          authorNamesById.set(author.id, author.name);
        }
      }

      const newAuthorNames = [...new Set(
        workAuthors.filter((author) => !author.id).map(({ name }) => name),
      )];
      for (const name of newAuthorNames) {
        const { data, error } = await supabase.rpc("resolve_author", {
          p_name: name,
        });
        if (error) {
          return replyDatabaseError(
            "works_authors_set",
            "Impossible d'enregistrer les auteurs",
            error,
          );
        }
        if (
          !Array.isArray(data) ||
          data.length !== 1 ||
          !isRecord(data[0]) ||
          typeof data[0].id !== "string" ||
          typeof data[0].name !== "string"
        ) {
          return reply({
            error: "La base n’a pas confirmé l’enregistrement d’un auteur",
          }, 500);
        }
        authorIdsByName.set(name, data[0].id);
        authorNamesById.set(data[0].id, data[0].name);
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
          name: authorNamesById.get(link.author_id) || workAuthors[index].name,
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
