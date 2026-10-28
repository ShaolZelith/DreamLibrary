const SUPABASE_URL = "https://itbmwxnqeajiequjdezh.supabase.co";
const SUPABASE_KEY = "sb_publishable_wyI9gQlY6JxcZ6EskKxCCQ_Of9BZBZF";
const EDIT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/dream-library-edit`;

const $ = (id) => document.getElementById(id);

let works = [];
let selectedWorkId = "";
let availableAuthors = [];
let selectedAuthors = [];
let authorSuggestions = [];
let selectedAuthorSuggestion = null;
let authorListRequestId = 0;
let activeAuthorSuggestionIndex = -1;
let availableTags = [];
let selectedTags = [];
let tagsEdited = false;
let accessPassword = "";
let accessLevel = "";
let modeSwitchTarget = "";

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function showStatus(message, isError = false) {
  $("statusMessage").textContent = message;
  $("statusMessage").style.color = isError ? "#a34848" : "";
}

function showAuthorStatus(message, isError = false) {
  const status = $("authorStatus");
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? "#a34848" : "";
}

function showTagStatus(message, isError = false) {
  const status = $("tagStatus");
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? "#a34848" : "";
}

function normalizeWork(work) {
  return {
    id: work.id,
    title: work.title || "Sans titre",
    summary: work.summary || "",
    cover_url: work.cover_url || "",
    original_language: work.original_language || "",
    work_type: work.work_type || "",
    is_priority: Boolean(work.is_priority),
    is_read: typeof work.is_read === "boolean" ? work.is_read : null,
    is_owned: typeof work.is_owned === "boolean" ? work.is_owned : null,
    authors: Array.isArray(work.authors) ? work.authors : [],
    tags: Array.isArray(work.tags) ? work.tags : []
  };
}

function selectedBoolean(checkedValue, uncheckedValue) {
  if ($(checkedValue).checked) return true;
  if ($(uncheckedValue).checked) return false;
  return null;
}

function displayName(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  return item.name || item.label || item.title || item.tag || "";
}

function detailFields(record, excluded = []) {
  const hiddenFields = new Set([
    "id", "work_id", "edition_id", "copy_id", "tag_id", "author_id",
    "location_id", "reading_session_id", "source_work_id", "target_work_id",
    "related_work_id", "created_at", "updated_at", ...excluded
  ]);
  const labels = {
    isbn: "ISBN",
    publisher: "Éditeur",
    publication_year: "Année de publication",
    original_language: "Langue originale",
    language: "Langue",
    format: "Format",
    pages: "Nombre de pages",
    status: "Statut",
    ownership_status: "Possession",
    location_name: "Emplacement",
    condition: "État",
    acquired_at: "Date d’acquisition",
    acquisition_date: "Date d’acquisition",
    started_at: "Début",
    start_date: "Début",
    finished_at: "Fin",
    end_date: "Fin",
    rating: "Note",
    review: "Critique",
    comment: "Commentaire",
    content: "Contenu",
    quote: "Citation",
    personal_notes: "Notes personnelles",
    summary: "Résumé",
    passage: "Passage important",
    relation_type: "Type de relation",
    related_work_title: "Œuvre liée",
    name: "Nom",
    title: "Titre",
    notes: "Notes"
  };
  const rows = Object.entries(record || {}).flatMap(([key, value]) => {
    if (
      hiddenFields.has(key) ||
      key.endsWith("_id") ||
      value === null ||
      value === undefined ||
      value === ""
    ) return [];
    if (typeof value === "object") return [];

    const formattedValue = typeof value === "boolean"
      ? value ? "Oui" : "Non"
      : String(value);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(formattedValue)) {
      return [];
    }
    const label = labels[key] || key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (character) => character.toLocaleUpperCase("fr"));
    return [[label, formattedValue]];
  });

  if (!rows.length) return "";
  return `<dl class="detail-fields">${rows.map(([label, value]) => `
    <div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>
  `).join("")}</dl>`;
}

async function editRequest(action, password = accessPassword, payload, id, extra = {}) {
  let response;
  try {
    response = await fetch(EDIT_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY
      },
      body: JSON.stringify({
        password,
        action,
        ...(id ? { id } : {}),
        ...(payload ? (action.startsWith("works_") ? { work: payload } : { book: payload }) : {}),
        ...extra
      })
    });
  } catch (error) {
    throw new Error(`Échec réseau pour l’action ${action} : ${error.message}`);
  }

  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Réponse non JSON pour l’action ${action} (HTTP ${response.status}).`
      );
    }
  }

  if (!response.ok) {
    const message = result.error || `Erreur serveur (${response.status})`;
    const detail = result.details || result.code;
    throw new Error(
      `${message} (HTTP ${response.status})${detail ? ` — ${detail}` : ""}`
    );
  }

  return result;
}

async function loadWorks() {
  showStatus("Chargement de la bibliothèque…");

  try {
    const result = await editRequest("works_list");
    if (!Array.isArray(result.works)) {
      throw new Error("Réponse invalide : la liste des œuvres est absente.");
    }
    works = result.works.map(normalizeWork);
    updateWorkTypeFilter();
    renderWorks();
    showStatus(works.length ? "" : "La bibliothèque est vide. Ajoute ta première œuvre !");
    return true;
  } catch (error) {
    showStatus(error.message || "Impossible de charger les œuvres.", true);
    console.error(error);
    return false;
  }
}

function normalizeAuthorName(name) {
  return name.trim().toLocaleLowerCase("fr");
}

async function loadAuthors() {
  const requestId = ++authorListRequestId;
  const password = accessPassword;
  let result;
  try {
    result = await editRequest("authors_list");
  } catch (error) {
    if (
      requestId !== authorListRequestId ||
      password !== accessPassword ||
      accessLevel !== "edit"
    ) return;
    throw error;
  }
  if (!Array.isArray(result.authors)) {
    throw new Error("Réponse invalide : la liste des auteurs est absente.");
  }
  if (
    requestId !== authorListRequestId ||
    password !== accessPassword ||
    accessLevel !== "edit"
  ) return;

  availableAuthors = result.authors.filter((author) =>
    author &&
    typeof author.id === "string" &&
    typeof author.name === "string"
  );
  showAuthorStatus("");
  updateAuthorSuggestions($("authorName")?.value || "");
}

async function loadTags() {
  const result = await editRequest("tags_list");
  if (!Array.isArray(result.tags)) {
    throw new Error("Réponse invalide : la liste des tags est absente.");
  }
  availableTags = result.tags;
}

function renderSelectedAuthors() {
  const container = $("selectedAuthors");
  if (!container) return;
  if (!selectedAuthors.length) {
    container.textContent = "Aucun auteur associé pour le moment.";
    return;
  }

  container.innerHTML = selectedAuthors.map((author, index) => `
    <div class="selected-author">
      <span>${escapeHTML(author.name)}${author.role !== "author"
        ? ` (${escapeHTML(author.role)})`
        : ""}</span>
      <button type="button" data-remove-author="${index}">Retirer</button>
    </div>
  `).join("");

  container.querySelectorAll("[data-remove-author]").forEach((button) => {
    button.addEventListener("click", () => {
      if (accessLevel !== "edit") return;
      selectedAuthors.splice(Number(button.dataset.removeAuthor), 1);
      selectedAuthors = selectedAuthors.map((author, index) => ({
        ...author,
        position: index + 1
      }));
      renderSelectedAuthors();
    });
  });
}

function closeAuthorSuggestions() {
  const input = $("authorName");
  const list = $("authorSuggestions");
  if (!input || !list) return;
  authorSuggestions = [];
  activeAuthorSuggestionIndex = -1;
  list.replaceChildren();
  list.classList.add("hidden");
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function updateAuthorSuggestions(value) {
  const input = $("authorName");
  const list = $("authorSuggestions");
  if (!input || !list) return;

  const query = normalizeAuthorName(value);
  const selectedIds = new Set(selectedAuthors.flatMap((author) =>
    typeof author.id === "string" ? [author.id] : []
  ));
  const selectedNames = new Set(selectedAuthors.map((author) =>
    normalizeAuthorName(author.name)
  ));
  const seenNames = new Set();
  authorSuggestions = query.length >= 2
    ? availableAuthors.filter((author) => {
      const normalizedName = normalizeAuthorName(author.name);
      if (
        !normalizedName.includes(query) ||
        selectedIds.has(author.id) ||
        selectedNames.has(normalizedName) ||
        seenNames.has(normalizedName)
      ) return false;
      seenNames.add(normalizedName);
      return true;
    }).slice(0, 8)
    : [];

  activeAuthorSuggestionIndex = -1;
  list.replaceChildren(...authorSuggestions.map((author, index) => {
    const option = document.createElement("li");
    option.id = `author-suggestion-${index}`;
    option.dataset.authorSuggestion = author.id;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = author.name;
    return option;
  }));
  const isOpen = authorSuggestions.length > 0;
  list.classList.toggle("hidden", !isOpen);
  input.setAttribute("aria-expanded", String(isOpen));
  input.removeAttribute("aria-activedescendant");
}

function setActiveAuthorSuggestion(index) {
  if (!authorSuggestions.length) return;
  activeAuthorSuggestionIndex = (
    index + authorSuggestions.length
  ) % authorSuggestions.length;
  const options = $("authorSuggestions").querySelectorAll('[role="option"]');
  options.forEach((option, optionIndex) => {
    const isActive = optionIndex === activeAuthorSuggestionIndex;
    option.setAttribute("aria-selected", String(isActive));
  });
  $("authorName").setAttribute(
    "aria-activedescendant",
    `author-suggestion-${activeAuthorSuggestionIndex}`,
  );
}

function selectAuthorSuggestion(author) {
  if (!author) return;
  selectedAuthorSuggestion = author;
  $("authorName").value = author.name;
  closeAuthorSuggestions();
  showAuthorStatus("");
}

function renderSelectedTags() {
  const container = $("selectedTags");
  if (!container) return;
  if (!selectedTags.length) {
    container.textContent = "Aucun tag associé.";
    return;
  }
  container.innerHTML = selectedTags.map((tag, index) => `
    <div class="selected-author">
      <span>${escapeHTML(displayName(tag))}${tag.category
        ? ` (${escapeHTML(tag.category)})`
        : ""}</span>
      <button type="button" data-remove-tag="${index}">Retirer</button>
    </div>
  `).join("");
}

function renderTagOptions() {
  const select = $("tagSelect");
  if (!select) return;
  select.replaceChildren(new Option("Choisir un tag…", ""));
  availableTags.forEach((tag) => {
    const name = displayName(tag);
    if (!tag.id || !name) return;
    select.add(new Option(
      tag.category ? `${name} (${tag.category})` : name,
      tag.id,
    ));
  });
}

function addSelectedAuthor(author) {
  if (accessLevel !== "edit") return false;
  const key = normalizeAuthorName(author.name);
  const duplicate = selectedAuthors.some((item) =>
    (author.id && item.id === author.id) ||
    normalizeAuthorName(item.name) === key
  );
  if (duplicate) {
    showAuthorStatus("Cet auteur est déjà associé.", true);
    return false;
  }

  selectedAuthors.push({ ...author, position: selectedAuthors.length + 1 });
  renderSelectedAuthors();
  showAuthorStatus("");
  showStatus("");
  return true;
}

async function addAuthorFromInput() {
  if (accessLevel !== "edit") return;
  const input = $("authorName");
  const name = input.value.trim();
  if (!name) {
    showAuthorStatus("Saisis le nom de l’auteur.", true);
    return;
  }

  const normalizedName = normalizeAuthorName(name);
  if (selectedAuthors.some((author) =>
    (selectedAuthorSuggestion?.id && author.id === selectedAuthorSuggestion.id) ||
    normalizeAuthorName(author.name) === normalizedName
  )) {
    showAuthorStatus("Cet auteur est déjà associé.", true);
    return;
  }

  const button = $("addAuthor");
  button.disabled = true;
  try {
    let author = selectedAuthorSuggestion &&
        normalizeAuthorName(selectedAuthorSuggestion.name) === normalizedName
      ? selectedAuthorSuggestion
      : null;
    if (!author) {
      const result = await editRequest(
        "authors_resolve",
        accessPassword,
        null,
        null,
        { name }
      );
      if (
        !result.author ||
        typeof result.author.id !== "string" ||
        typeof result.author.name !== "string" ||
        !result.author.name.trim()
      ) {
        throw new Error("La fonction n’a pas confirmé la résolution de l’auteur.");
      }
      author = result.author;
    }

    if (!availableAuthors.some((item) => item.id === author.id)) {
      availableAuthors.push({ id: author.id, name: author.name });
    }
    if (addSelectedAuthor({
      id: author.id,
      name: author.name,
      role: "author"
    })) {
      input.value = "";
      selectedAuthorSuggestion = null;
      closeAuthorSuggestions();
    }
  } catch (error) {
    showAuthorStatus(error.message || "Impossible d’ajouter l’auteur.", true);
    console.error("authors_resolve failed", error);
  } finally {
    button.disabled = false;
  }
}

function getAuthorsForSubmission() {
  const uniqueAuthors = [];
  const seen = new Set();
  for (const author of selectedAuthors) {
    const key = `${author.name.trim().toLocaleLowerCase("fr")}\u0000${author.role.toLocaleLowerCase("fr")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueAuthors.push({ ...author, position: uniqueAuthors.length + 1 });
  }
  return uniqueAuthors;
}

function updateWorkTypeFilter() {
  const filter = $("workTypeFilter");
  const selected = filter.value;
  const types = [...new Set(works.map((work) => work.work_type).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"));

  filter.replaceChildren(new Option("Tous les types d’œuvre", "all"));
  types.forEach((type) => filter.add(new Option(type, type)));
  filter.value = types.includes(selected) ? selected : "all";
}

function detailSection(title, content) {
  return content
    ? `<section class="detail-section"><h3>${escapeHTML(title)}</h3>${content}</section>`
    : "";
}

function renderRecordList(records, title) {
  if (!Array.isArray(records) || !records.length) return "";
  const items = records.map((record) => {
    const name = displayName(record);
    const fields = detailFields(record, ["name", "label", "title", "tag"]);
    if (!name && !fields) return "";
    return `<article class="detail-record">${name ? `<h4>${escapeHTML(name)}</h4>` : ""}${fields}</article>`;
  }).filter(Boolean);
  return items.length
    ? detailSection(title, `<div class="detail-records">${items.join("")}</div>`)
    : "";
}

function renderWorkDetails(details) {
  const panel = $("workDetails");
  const work = details.work;
  if (!work) {
    panel.classList.add("hidden");
    panel.replaceChildren();
    return;
  }

  const authors = (work.authors || [])
    .map((author) => author.role && author.role !== "author"
      ? `${author.name} (${author.role})`
      : author.name)
    .filter(Boolean);
  const detailTags = Array.isArray(details.tags) ? details.tags : [];
  const workTags = Array.isArray(work.tags) ? work.tags : [];
  const tags = (detailTags.length ? detailTags : workTags).map(displayName).filter(Boolean);
  const cover = work.cover_url
    ? `<img class="detail-cover" src="${escapeHTML(work.cover_url)}" alt="Couverture de ${escapeHTML(work.title)}">`
    : "";
  const statusBadges = [
    work.is_priority ? '<span class="badge priority">Prioritaire</span>' : "",
    work.is_owned === true ? '<span class="badge owned">Possédé</span>' : "",
    work.is_owned === false ? '<span class="badge not-owned">Non possédé</span>' : "",
    work.is_read === true ? '<span class="badge read">Lu</span>' : "",
    work.is_read === false ? '<span class="badge not-read">Non lu</span>' : ""
  ].filter(Boolean).join("");
  const knownWorkFields = [
    "id", "title", "summary", "cover_url", "original_language", "work_type",
    "is_priority", "is_owned", "is_read", "authors", "tags"
  ];
  const general = [];
  if (work.original_language) general.push(["Langue originale", work.original_language]);
  if (work.work_type) general.push(["Type d’œuvre", work.work_type]);
  const extraWorkFields = detailFields(work, knownWorkFields);
  const generalInfo = general.length
    ? `<dl class="detail-fields">${general.map(([label, value]) => `
      <div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>
    `).join("")}</dl>`
    : "";
  const tagList = tags.length
    ? `<div class="badges">${tags.map((tag) => `<span class="badge">${escapeHTML(tag)}</span>`).join("")}</div>`
    : "";
  const summary = work.summary
    ? `<p class="detail-summary">${escapeHTML(work.summary)}</p>`
    : "";
  const authorsSection = authors.length
    ? detailSection("Auteurs", `<p>${authors.map(escapeHTML).join(", ")}</p>`)
    : "";
  const tagsSection = detailSection("Tags", tagList);
  const generalSection = detailSection(
    "Informations générales",
    `${statusBadges ? `<div class="badges detail-badges">${statusBadges}</div>` : ""}${generalInfo}${extraWorkFields}`
  );
  const summarySection = detailSection("Résumé", summary);
  const actions = accessLevel === "edit"
    ? `<div class="detail-actions">
        <button type="button" data-detail-edit="${escapeHTML(work.id)}">Modifier</button>
        <button type="button" class="delete-button" data-detail-delete="${escapeHTML(work.id)}">Supprimer</button>
      </div>`
    : "";

  panel.classList.toggle("no-cover", !cover);
  panel.innerHTML = `
    <div class="detail-heading">
      <h2>${escapeHTML(work.title || "Sans titre")}</h2>
      <button type="button" class="detail-close" data-close-details>Fermer les détails</button>
    </div>
    <div class="detail-content">
      ${cover ? `<div class="detail-cover-wrap">${cover}</div>` : ""}
      <div class="detail-main">
        ${authorsSection}
        ${generalSection}
        ${tagsSection}
        ${summarySection}
      </div>
      <div class="detail-associated">
        ${renderRecordList(details.editions, "Éditions")}
        ${renderRecordList(details.copies, "Exemplaires")}
        ${renderRecordList(details.reading_sessions, "Lectures")}
        ${renderRecordList(details.notes, "Notes et annotations")}
        ${renderRecordList(details.relations, "Relations avec d’autres œuvres")}
      </div>
    </div>
    ${actions}
  `;
  panel.classList.remove("hidden");
  panel.querySelector("[data-close-details]").addEventListener("click", closeWorkDetails);
  panel.querySelector("[data-detail-edit]")?.addEventListener("click", () => {
    if (accessLevel !== "edit") return;
    fillForm(works.find((item) => item.id === work.id) || normalizeWork(work));
  });
  panel.querySelector("[data-detail-delete]")?.addEventListener("click", () => {
    if (accessLevel === "edit") deleteWork(work.id);
  });
}

async function openWorkDetails(id) {
  if (
    $("workForm") &&
    selectedWorkId !== id &&
    !confirm("Abandonner les modifications non enregistrées ?")
  ) return;
  selectedWorkId = id;
  renderWorks();
  const panel = $("workDetails");
  panel.classList.remove("hidden");
  panel.innerHTML = '<p class="detail-loading" role="status">Chargement des détails…</p>';

  try {
    const result = await editRequest("works_detail", accessPassword, null, id);
    if (selectedWorkId !== id) return;
    if (!result.work || result.work.id !== id) {
      throw new Error("Réponse invalide : les détails de l’œuvre sont absents.");
    }
    renderWorkDetails(result);
    return true;
  } catch (error) {
    if (selectedWorkId !== id) return;
    panel.innerHTML = `
      <div class="detail-heading">
        <h2>Détails indisponibles</h2>
        <button type="button" class="detail-close" data-close-details>Fermer les détails</button>
      </div>
      <p class="detail-error">${escapeHTML(error.message || "Impossible de charger les détails de l’œuvre.")}</p>
    `;
    panel.querySelector("[data-close-details]").addEventListener("click", closeWorkDetails);
    console.error("works_detail failed", error);
    return false;
  }
}

function closeWorkDetails() {
  selectedWorkId = "";
  $("workDetails").classList.add("hidden");
  $("workDetails").replaceChildren();
  renderWorks();
}

function renderWorks() {
  const query = $("search").value.trim().toLocaleLowerCase("fr");
  const workType = $("workTypeFilter").value;
  const priority = $("priorityFilter").value;

  const filtered = works.filter((work) => {
    const matchesQuery =
      work.title.toLocaleLowerCase("fr").includes(query) ||
      work.authors.some((author) =>
        author.name.toLocaleLowerCase("fr").includes(query)
      );
    const matchesType = workType === "all" || work.work_type === workType;
    const matchesPriority =
      priority === "all" || String(work.is_priority) === priority;
    return matchesQuery && matchesType && matchesPriority;
  });

  $("workCount").textContent =
    `${filtered.length} œuvre${filtered.length > 1 ? "s" : ""}`;

  const grid = $("workGrid");
  if (!filtered.length) {
    grid.innerHTML = '<p class="empty-state">Aucune œuvre trouvée.</p>';
    return;
  }

  grid.innerHTML = filtered.map((work) => {
    const cover = work.cover_url
      ? `<img class="book-cover" src="${escapeHTML(work.cover_url)}" alt="Couverture de ${escapeHTML(work.title)}" loading="lazy">`
      : `<div class="book-cover">${escapeHTML(work.title)}</div>`;
    const authorNames = work.authors.length
      ? work.authors.map((author) => {
        const role = author.role && author.role !== "author"
          ? ` (${escapeHTML(author.role)})`
          : "";
        return `${escapeHTML(author.name)}${role}`;
      }).join(", ")
      : "Aucun auteur associé";

    return `
      <article class="book-card${work.id === selectedWorkId ? " selected" : ""}" data-work-select="${escapeHTML(work.id)}" role="button" tabindex="0" aria-pressed="${work.id === selectedWorkId}">
        ${cover}
        <div class="book-info">
          <h3>${escapeHTML(work.title)}</h3>
          <p class="book-author">${authorNames}</p>
          <div class="badges">
            ${work.work_type ? `<span class="badge">${escapeHTML(work.work_type)}</span>` : ""}
            ${work.original_language ? `<span class="badge">${escapeHTML(work.original_language)}</span>` : ""}
            ${work.is_priority ? '<span class="badge priority">Prioritaire</span>' : ""}
            ${work.is_owned === true ? '<span class="badge owned">Possédé</span>' : ""}
            ${work.is_owned === false ? '<span class="badge not-owned">Non possédé</span>' : ""}
            ${work.is_read === true ? '<span class="badge read">Lu</span>' : ""}
            ${work.is_read === false ? '<span class="badge not-read">Non lu</span>' : ""}
            ${work.tags.map(displayName).filter(Boolean).map((tag) => `<span class="badge">${escapeHTML(tag)}</span>`).join("")}
          </div>
        </div>
      </article>
    `;
  }).join("");

  grid.querySelectorAll("[data-work-select]").forEach((card) => {
    card.addEventListener("click", () => openWorkDetails(card.dataset.workSelect));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openWorkDetails(card.dataset.workSelect);
    });
  });

  grid.querySelectorAll("img.book-cover").forEach((img) => {
    img.addEventListener("error", () => {
      const fallback = document.createElement("div");
      fallback.className = "book-cover";
      fallback.textContent = img.alt.replace("Couverture de ", "");
      img.replaceWith(fallback);
    }, { once: true });
  });
}

function renderWorkEditor(mode, work = null) {
  if (accessLevel !== "edit") return;
  selectedAuthorSuggestion = null;
  closeAuthorSuggestions();

  const panel = $("workDetails");
  panel.classList.remove("hidden");
  panel.classList.remove("no-cover");
  panel.innerHTML = `
    <div class="detail-heading">
      <h2>${mode === "create" ? "Ajouter un livre" : "Modifier le livre"}</h2>
    </div>
    <div class="detail-edit-layout"></div>
  `;
  panel.querySelector(".detail-edit-layout").append(
    $("workEditorTemplate").content.cloneNode(true)
  );

  const form = $("workForm");
  $("saveWorkButton").textContent = mode === "create"
    ? "Enregistrer le livre"
    : "Enregistrer les modifications";
  $("workId").value = work?.id || "";
  $("title").value = work?.title === "Sans titre" ? "" : work?.title || "";
  $("coverUrl").value = work?.cover_url || "";
  $("summary").value = work?.summary || "";
  $("originalLanguage").value = work?.original_language || "";
  $("workType").value = work?.work_type || "";
  $("isPriority").checked = work?.is_priority === true;
  $("is_owned").checked = work?.is_owned === true;
  $("is_not_owned").checked = work?.is_owned === false;
  $("is_read").checked = work?.is_read === true;
  $("is_not_read").checked = work?.is_read === false;
  selectedAuthors = (work?.authors || []).map((author, index) => ({
    id: author.id,
    name: author.name,
    role: author.role || "author",
    position: author.position || index + 1
  }));
  renderSelectedAuthors();
  selectedTags = (work?.tags || []).filter((tag) => tag.id);
  tagsEdited = false;
  renderTagOptions();
  renderSelectedTags();
  showAuthorStatus("");
  showTagStatus("");
  $("editorMessage").textContent = "";
  form.dataset.mode = mode;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function beginCreateWork() {
  if (accessLevel !== "edit") return;
  if ($("workForm") && !confirm("Abandonner les modifications non enregistrées ?")) return;
  selectedWorkId = "";
  renderWorks();
  renderWorkEditor("create");
  loadTags().then(renderTagOptions).catch((error) => {
    showTagStatus(`Impossible de charger les tags : ${error.message}`, true);
  });
}

function fillForm(work) {
  if (accessLevel !== "edit") return;
  selectedWorkId = work.id;
  renderWorks();
  renderWorkEditor("edit", work);
  loadTags().then(renderTagOptions).catch((error) => {
    showTagStatus(`Impossible de charger les tags : ${error.message}`, true);
  });
}

function openLogin() {
  $("loginPage").classList.remove("hidden");
  $("loginPanel").classList.remove("hidden");
  $("loginTitle").textContent = "Accès à Dream Library";
  $("password").focus();
}

function closeLogin() {
  $("loginPanel").classList.add("hidden");
  $("password").value = "";
  $("loginMessage").textContent = "";
  if (modeSwitchTarget && accessLevel) {
    modeSwitchTarget = "";
    $("loginPage").classList.add("hidden");
    $("appContent").classList.remove("hidden");
  } else {
    $("loginPanel").classList.remove("hidden");
  }
}

function beginModeSwitch(target) {
  if (target !== "view" && target !== "edit") return;
  modeSwitchTarget = target;
  $("appContent").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginPanel").classList.remove("hidden");
  $("loginTitle").textContent = target === "view"
    ? "Confirmer le mode lecture"
    : "Confirmer le mode édition";
  $("loginMessage").textContent = target === "view"
    ? "Saisis le mot de passe de consultation pour passer en lecture."
    : "Saisis le mot de passe d’édition pour activer les modifications.";
  $("password").value = "";
  $("password").focus();
}

function applyAccessMode() {
  const isEditor = accessLevel === "edit";
  const wasEditing = Boolean($("workForm"));
  $("editModeButton").textContent = isEditor
    ? "Passer en mode lecture"
    : "Passer en mode édition";
  $("addWorkButton").classList.toggle("hidden", !isEditor);

  if (!isEditor) {
    authorListRequestId += 1;
    availableAuthors = [];
    selectedAuthorSuggestion = null;
    closeAuthorSuggestions();
    if (wasEditing) {
      const editingId = $("workId").value;
      if (editingId) openWorkDetails(editingId);
      else closeWorkDetails();
    }
    selectedAuthors = [];
    availableTags = [];
    renderSelectedAuthors();
  }

  renderWorks();
  if (selectedWorkId && !wasEditing) openWorkDetails(selectedWorkId);
}

function logout() {
  accessPassword = "";
  accessLevel = "";
  modeSwitchTarget = "";
  authorListRequestId += 1;
  availableAuthors = [];
  selectedAuthorSuggestion = null;
  closeAuthorSuggestions();
  works = [];
  selectedWorkId = "";
  selectedAuthors = [];
  $("appContent").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginPanel").classList.remove("hidden");
  $("loginTitle").textContent = "Accès à Dream Library";
  $("password").value = "";
  $("loginMessage").textContent = "";
  $("workGrid").replaceChildren();
  $("workDetails").classList.add("hidden");
  $("workDetails").replaceChildren();
  $("workCount").textContent = "0 œuvre";
  $("search").value = "";
  $("workTypeFilter").value = "all";
  $("priorityFilter").value = "all";
  showAuthorStatus("");
  $("addWorkButton").classList.add("hidden");
}

$("editModeButton").addEventListener("click", () => {
  beginModeSwitch(accessLevel === "edit" ? "view" : "edit");
});

$("addWorkButton").addEventListener("click", beginCreateWork);

$("cancelLogin").addEventListener("click", () => {
  if (modeSwitchTarget && accessLevel) {
    closeLogin();
  } else if (!accessLevel) {
    $("password").value = "";
    $("loginMessage").textContent = "";
    $("password").focus();
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const candidatePassword = $("password").value;
  const submitButton = $("loginForm").querySelector('[type="submit"]');
  submitButton.disabled = true;
  $("loginMessage").textContent = "Vérification…";

  try {
    const result = await editRequest("verify", candidatePassword);
    if (result.role !== "view" && result.role !== "edit") {
      throw new Error("La fonction a renvoyé un niveau d’accès invalide.");
    }
    if (modeSwitchTarget && result.role !== modeSwitchTarget) {
      $("loginMessage").textContent = modeSwitchTarget === "view"
        ? "Ce mot de passe ne donne pas l’accès consultation."
        : "Ce mot de passe ne donne pas l’accès édition.";
      $("password").value = "";
      return;
    }

    accessPassword = candidatePassword;
    accessLevel = result.role;
    modeSwitchTarget = "";
    $("loginPage").classList.add("hidden");
    $("appContent").classList.remove("hidden");
    $("loginPanel").classList.add("hidden");
    $("password").value = "";
    $("loginMessage").textContent = "";

    applyAccessMode();

    if (accessLevel === "edit") {
      loadAuthors().catch((error) => {
        if (accessLevel !== "edit") return;
        showAuthorStatus(
          `Les suggestions d’auteurs ne sont pas disponibles : ${error.message}`,
          true,
        );
        console.error("authors_list failed", error);
      });
    }

    await loadWorks();
  } catch (error) {
    $("loginMessage").textContent = error.message === "Mot de passe incorrect"
      ? "Mot de passe incorrect."
      : error.message || "La vérification a échoué. Vérifie la configuration Supabase.";
  } finally {
    submitButton.disabled = false;
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "workForm") return;
  event.preventDefault();
  if (accessLevel !== "edit" || !accessPassword) return;

  const title = $("title").value.trim();
  if (!title) {
    showStatus("Le titre est obligatoire.", true);
    return;
  }

  let authorsToSave;
  try {
    authorsToSave = getAuthorsForSubmission();
  } catch (error) {
    showAuthorStatus(error.message, true);
    return;
  }

  const work = {
    title,
    summary: $("summary").value.trim() || null,
    cover_url: $("coverUrl").value.trim() || null,
    original_language: $("originalLanguage").value.trim() || null,
    work_type: $("workType").value.trim() || null,
    is_priority: $("isPriority").checked,
    is_owned: selectedBoolean("is_owned", "is_not_owned"),
    is_read: selectedBoolean("is_read", "is_not_read")
  };
  const id = $("workId").value;
  const submitButton = $("saveWorkButton");
  const formMode = $("workForm").dataset.mode;
  submitButton.disabled = true;

  try {
    const result = await editRequest(
      id ? "works_update" : "works_create",
      accessPassword,
      work,
      id
    );
    const savedId = id || result.work?.id;
    if (!savedId) throw new Error("La fonction n’a pas renvoyé l’identifiant de l’œuvre.");
    if (!id) {
      $("workId").value = savedId;
      $("workForm").dataset.mode = "edit";
      selectedWorkId = savedId;
    }

    try {
      const authorResult = await editRequest(
        "works_authors_set",
        accessPassword,
        null,
        savedId,
        {
          authors: authorsToSave.map((author, index) => ({
            ...(author.id ? { id: author.id } : {}),
            name: author.name,
            role: author.role,
            position: index + 1
          }))
        }
      );
      if (
        !Array.isArray(authorResult.authors) ||
        authorResult.authors.length !== authorsToSave.length
      ) {
        throw new Error("La fonction n’a pas confirmé toutes les associations d’auteurs.");
      }
      for (const author of authorResult.authors) {
        if (!author.id || !author.name) {
          throw new Error("La fonction n’a pas renvoyé les auteurs associés.");
        }
      }
    } catch (error) {
      await loadWorks();
      $("editorMessage").textContent =
        `Le livre est enregistré, mais les auteurs n’ont pas été enregistrés : ${error.message}`;
      $("editorMessage").classList.add("is-error");
      console.error("works_authors_set failed", error);
      return;
    }

    const tagsNeedVerification = tagsEdited || selectedTags.length > 0;
    if (tagsEdited || selectedTags.length) {
      try {
        const tagsResult = await editRequest(
          "works_tags_set",
          accessPassword,
          null,
          savedId,
          { tags: selectedTags.map((tag) => tag.id) }
        );
        if (
          !Array.isArray(tagsResult.tags) ||
          tagsResult.tags.length !== selectedTags.length
        ) {
          throw new Error("L’API n’a pas confirmé tous les tags associés.");
        }
      } catch (error) {
        $("editorMessage").textContent =
          `Le livre et ses auteurs sont enregistrés, mais les tags n’ont pas été enregistrés : ${error.message}`;
        $("editorMessage").classList.add("is-error");
        console.error("works_tags_set failed", error);
        return;
      }
    }

    const worksLoaded = await loadWorks();
    if (!worksLoaded) {
      $("editorMessage").textContent =
        "Le livre et ses associations sont enregistrés, mais impossible de vérifier leur affichage. Rechargez la bibliothèque.";
      $("editorMessage").classList.add("is-error");
      return;
    }
    const savedWork = works.find((item) => item.id === savedId);
    if (
      !savedWork ||
      savedWork.is_owned !== work.is_owned ||
      savedWork.is_read !== work.is_read
    ) {
      $("editorMessage").textContent =
        "Le livre est enregistré, mais les statuts relus ne correspondent pas aux choix envoyés. Vérifie le déploiement de l’Edge Function.";
      $("editorMessage").classList.add("is-error");
      return;
    }
    const missingAuthor = authorsToSave.find((selected) =>
      !savedWork.authors.some((author) =>
        (selected.id ? author.id === selected.id : author.name === selected.name) &&
        author.role === selected.role
      )
    );
    if (missingAuthor) {
      $("editorMessage").textContent =
        `Le livre est enregistré, mais l’association de « ${missingAuthor.name} » n’a pas été retrouvée après relecture.`;
      $("editorMessage").classList.add("is-error");
      return;
    }
    if (tagsNeedVerification) {
      const savedTagIds = savedWork.tags
        .map((tag) => tag.id)
        .filter((tagId) => typeof tagId === "string");
      if (
        savedTagIds.length !== selectedTags.length ||
        selectedTags.some((tag) => !savedTagIds.includes(tag.id))
      ) {
        $("editorMessage").textContent =
          "Le livre est enregistré, mais les tags relus ne correspondent pas aux choix envoyés.";
        $("editorMessage").classList.add("is-error");
        return;
      }
    }

    selectedWorkId = savedId;
    if (!await openWorkDetails(savedId)) {
      showStatus(
        "Enregistrement confirmé, mais les détails ne peuvent pas être rechargés.",
        true
      );
      return;
    }
    showStatus(formMode === "create" ? "Livre ajouté !" : "Modifications enregistrées.");
  } catch (error) {
    const message = error.message || "Impossible d’enregistrer le livre.";
    const editorMessage = $("editorMessage");
    if (editorMessage) {
      editorMessage.textContent = message;
      editorMessage.classList.add("is-error");
    } else {
      showStatus(message, true);
    }
    console.error("Saving work failed", error);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

async function deleteWork(id) {
  if (accessLevel !== "edit" || !confirm("Supprimer cette œuvre ?")) return;

  try {
    const result = await editRequest("works_delete", accessPassword, null, id);
    if (result.deleted !== id) {
      throw new Error("La fonction n’a pas confirmé la suppression de cette œuvre.");
    }
    if (!await loadWorks()) {
      showStatus("Suppression effectuée, mais impossible de recharger la bibliothèque.", true);
      return;
    }
    if (works.some((work) => work.id === id)) {
      throw new Error("L’œuvre supprimée apparaît encore dans la liste après rechargement.");
    }
    if (selectedWorkId === id) closeWorkDetails();
    showStatus("Œuvre supprimée.");
  } catch (error) {
    showStatus(error.message || "Impossible de supprimer l’œuvre.", true);
    console.error("works_delete failed", error);
  }
}

$("logoutButton").addEventListener("click", logout);

document.addEventListener("change", (event) => {
  for (const [positiveId, negativeId] of [
    ["is_owned", "is_not_owned"],
    ["is_read", "is_not_read"]
  ]) {
    if (event.target.id === positiveId && event.target.checked) $(negativeId).checked = false;
    if (event.target.id === negativeId && event.target.checked) $(positiveId).checked = false;
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!target.closest("#authorAutocomplete")) closeAuthorSuggestions();

  const authorSuggestion = target.closest("[data-author-suggestion]");
  if (authorSuggestion) {
    const author = authorSuggestions.find((item) =>
      item.id === authorSuggestion.dataset.authorSuggestion
    );
    if (author) selectAuthorSuggestion(author);
    return;
  }

  if (target.closest("#addAuthor")) await addAuthorFromInput();

  if (target.closest("#addWorkTag") && accessLevel === "edit") {
    const tag = availableTags.find((item) => item.id === $("tagSelect").value);
    if (!tag) {
      showTagStatus("Choisis un tag dans la liste.", true);
      return;
    }
    if (!selectedTags.some((item) => item.id === tag.id)) {
      selectedTags.push(tag);
      tagsEdited = true;
      renderSelectedTags();
      showTagStatus("");
    }
    $("tagSelect").value = "";
  }

  if (target.closest("#createWorkTag")) {
    if (accessLevel !== "edit") return;
    const name = $("newTagName").value.trim();
    const category = $("newTagCategory").value;
    if (!name) {
      showTagStatus("Saisis le nom du tag.", true);
      return;
    }
    if (!["genre", "theme", "place", "period"].includes(category)) {
      showTagStatus("Choisis une catégorie valide pour le tag.", true);
      return;
    }

    const button = $("createWorkTag");
    button.disabled = true;
    try {
      const result = await editRequest(
        "tags_create",
        accessPassword,
        null,
        null,
        { name, category }
      );
      if (
        !result.tag ||
        typeof result.tag.id !== "string" ||
        result.tag.name !== name ||
        result.tag.category !== category
      ) {
        throw new Error("La fonction n’a pas confirmé la création ou la réutilisation du tag.");
      }

      let refreshError = "";
      try {
        await loadTags();
      } catch (error) {
        refreshError = error.message;
        if (!availableTags.some((tag) => tag.id === result.tag.id)) {
          availableTags.push(result.tag);
        }
        console.error("Refreshing tags after creation failed", error);
      }

      if (!availableTags.some((tag) => tag.id === result.tag.id)) {
        availableTags.push(result.tag);
      }
      renderTagOptions();
      if (!selectedTags.some((tag) => tag.id === result.tag.id)) {
        selectedTags.push(result.tag);
        tagsEdited = true;
        renderSelectedTags();
      }
      $("newTagName").value = "";
      $("newTagCategory").value = "";
      if (result.created === false) {
        showTagStatus(
          `Ce tag existait déjà dans cette catégorie. Il a été réutilisé et ajouté à la fiche. Enregistre le livre pour sauvegarder son association.${refreshError
            ? ` La liste n’a pas pu être actualisée : ${refreshError}`
            : ""}`,
          Boolean(refreshError)
        );
      } else {
        showTagStatus(
          `Tag créé et ajouté à la fiche. Enregistre le livre pour sauvegarder son association.${refreshError
            ? ` La liste n’a pas pu être actualisée : ${refreshError}`
            : ""}`,
          Boolean(refreshError)
        );
      }
    } catch (error) {
      showTagStatus(error.message || "Impossible de créer le tag.", true);
      console.error("tags_create failed", error);
    } finally {
      button.disabled = false;
    }
  }

  const removeTag = target.closest("[data-remove-tag]");
  if (removeTag && accessLevel === "edit") {
    selectedTags.splice(Number(removeTag.dataset.removeTag), 1);
    tagsEdited = true;
    renderSelectedTags();
  }

  if (target.closest("#cancelWorkEditButton") && accessLevel === "edit") {
    const form = $("workForm");
    if (form?.dataset.mode === "create") closeWorkDetails();
    else if (form) openWorkDetails($("workId").value);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "authorName") return;
  selectedAuthorSuggestion = null;
  updateAuthorSuggestions(event.target.value);
});

document.addEventListener("keydown", async (event) => {
  if (event.target.id !== "authorName") return;
  if (event.key === "Escape") {
    if (authorSuggestions.length) {
      event.preventDefault();
      closeAuthorSuggestions();
    }
    return;
  }
  if (event.key === "ArrowDown" && authorSuggestions.length) {
    event.preventDefault();
    setActiveAuthorSuggestion(activeAuthorSuggestionIndex + 1);
    return;
  }
  if (event.key === "ArrowUp" && authorSuggestions.length) {
    event.preventDefault();
    setActiveAuthorSuggestion(
      activeAuthorSuggestionIndex < 0
        ? authorSuggestions.length - 1
        : activeAuthorSuggestionIndex - 1,
    );
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (authorSuggestions.length) {
      selectAuthorSuggestion(
        authorSuggestions[activeAuthorSuggestionIndex < 0
          ? 0
          : activeAuthorSuggestionIndex],
      );
      return;
    }
    await addAuthorFromInput();
  }
});

["search", "workTypeFilter", "priorityFilter"].forEach((id) => {
  $(id).addEventListener("input", renderWorks);
  $(id).addEventListener("change", renderWorks);
});
