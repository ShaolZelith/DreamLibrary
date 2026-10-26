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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const { password, action, id, book } = body;
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
