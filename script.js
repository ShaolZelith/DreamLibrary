const SUPABASE_URL = "https://itbmwxnqeajiequjdezh.supabase.co";
const SUPABASE_KEY = "sb_publishable_wyI9gQlY6JxcZ6EskKxCCQ_Of9BZBZF";
const EDIT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/dream-library-edit`;

const $ = (id) => document.getElementById(id);

let works = [];
let selectedWorkId = "";
let availableAuthors = [];
let selectedAuthors = [];
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
  $("authorStatus").textContent = message;
  $("authorStatus").style.color = isError ? "#a34848" : "";
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

async function loadAuthors() {
  const result = await editRequest("authors_list");
  if (!Array.isArray(result.authors)) {
    throw new Error("Réponse invalide : la liste des auteurs est absente.");
  }
  availableAuthors = result.authors;
  renderAuthorOptions();
  showAuthorStatus("");
}

function renderAuthorOptions() {
  const select = $("authorSelect");
  const selectedId = select.value;
  select.replaceChildren(new Option("Choisir un auteur…", ""));
  availableAuthors.forEach((author) => {
    select.add(new Option(author.name, author.id));
  });
  select.value = availableAuthors.some((author) => author.id === selectedId)
    ? selectedId
    : "";
}

function renderSelectedAuthors() {
  const container = $("selectedAuthors");
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

function addSelectedAuthor(author) {
  if (accessLevel !== "edit") return false;
  const key = `${author.name.trim().toLocaleLowerCase("fr")}\u0000${author.role.toLocaleLowerCase("fr")}`;
  const duplicate = selectedAuthors.some((item) =>
    `${item.name.trim().toLocaleLowerCase("fr")}\u0000${item.role.toLocaleLowerCase("fr")}` === key
  );
  if (duplicate) {
    showStatus("Cet auteur avec ce rôle est déjà associé.", true);
    return false;
  }

  selectedAuthors.push({ ...author, position: selectedAuthors.length + 1 });
  renderSelectedAuthors();
  showAuthorStatus("");
  showStatus("");
  return true;
}

function getAuthorsForSubmission() {
  const authors = [...selectedAuthors];
  const selectedId = $("authorSelect").value;
  if (selectedId) {
    const author = availableAuthors.find((item) => item.id === selectedId);
    if (!author) throw new Error("L’auteur sélectionné n’existe plus. Recharge la liste.");
    authors.push({
      id: author.id,
      name: author.name,
      role: $("existingAuthorRole").value.trim() || "author"
    });
  }

  const newName = $("newAuthorName").value.trim();
  if (newName) {
    authors.push({
      name: newName,
      role: $("newAuthorRole").value.trim() || "author"
    });
  }

  const uniqueAuthors = [];
  const seen = new Set();
  for (const author of authors) {
    const key = `${author.id || author.name.trim().toLocaleLowerCase("fr")}\u0000${author.role.toLocaleLowerCase("fr")}`;
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

function showEditor() {
  if (accessLevel !== "edit") return;
  $("editorPanel").classList.remove("hidden");
  $("toggleEditorButton").textContent = "Masquer le formulaire";
}

function hideEditor() {
  $("editorPanel").classList.add("hidden");
  $("toggleEditorButton").textContent = "Afficher le formulaire";
  resetForm();
}

function resetForm() {
  $("workForm").reset();
  $("workId").value = "";
  $("formTitle").textContent = "Ajouter une œuvre";
  selectedAuthors = [];
  renderSelectedAuthors();
  showAuthorStatus("");
}

function fillForm(work) {
  if (accessLevel !== "edit") return;
  $("workId").value = work.id;
  $("title").value = work.title === "Sans titre" ? "" : work.title;
  selectedAuthors = work.authors.map((author, index) => ({
    id: author.id,
    name: author.name,
    role: author.role || "author",
    position: author.position || index + 1
  }));
  renderSelectedAuthors();
  $("existingAuthorRole").value = "author";
  $("coverUrl").value = work.cover_url;
  $("summary").value = work.summary;
  $("originalLanguage").value = work.original_language;
  $("workType").value = work.work_type;
  $("isPriority").checked = work.is_priority;
  $("is_owned").checked = work.is_owned === true;
  $("is_not_owned").checked = work.is_owned === false;
  $("is_read").checked = work.is_read === true;
  $("is_not_read").checked = work.is_read === false;
  $("formTitle").textContent = "Modifier une œuvre";
  showEditor();
  $("editorPanel").scrollIntoView({ behavior: "smooth" });
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
  $("editModeButton").textContent = isEditor
    ? "Passer en mode lecture"
    : "Passer en mode édition";

  if (isEditor) {
    showEditor();
  } else {
    selectedAuthors = [];
    hideEditor();
    availableAuthors = [];
    renderAuthorOptions();
    renderSelectedAuthors();
    showAuthorStatus("");
  }

  renderWorks();
  if (selectedWorkId) openWorkDetails(selectedWorkId);
}

function logout() {
  accessPassword = "";
  accessLevel = "";
  modeSwitchTarget = "";
  works = [];
  selectedWorkId = "";
  availableAuthors = [];
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
  hideEditor();
}

$("editModeButton").addEventListener("click", () => {
  beginModeSwitch(accessLevel === "edit" ? "view" : "edit");
});

$("toggleEditorButton").addEventListener("click", () => {
  if (accessLevel !== "edit") return;
  if ($("editorPanel").classList.contains("hidden")) {
    showEditor();
    $("editorPanel").scrollIntoView({ behavior: "smooth" });
  } else {
    hideEditor();
  }
});

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
      try {
        await loadAuthors();
      } catch (error) {
        showAuthorStatus(`Impossible de charger la liste des auteurs : ${error.message}`, true);
        console.error(error);
      }
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

$("workForm").addEventListener("submit", async (event) => {
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
  const submitButton = $("workForm").querySelector('[type="submit"]');
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
        if (!availableAuthors.some((item) => item.id === author.id)) {
          availableAuthors.push({ id: author.id, name: author.name });
        }
      }
      renderAuthorOptions();
    } catch (error) {
      await loadWorks();
      showStatus(`Œuvre enregistrée, mais les auteurs n’ont pas été enregistrés : ${error.message}`, true);
      console.error("works_authors_set failed", error);
      return;
    }

    const worksLoaded = await loadWorks();
    if (!worksLoaded) {
      showStatus("Œuvre et auteurs enregistrés, mais impossible de vérifier leur affichage. Rechargez la bibliothèque.", true);
      return;
    }
    const savedWork = works.find((item) => item.id === savedId);
    if (
      !savedWork ||
      savedWork.is_owned !== work.is_owned ||
      savedWork.is_read !== work.is_read
    ) {
      showStatus(
        "Œuvre enregistrée, mais les statuts Lu/Non lu et Possédé/Non possédé ne correspondent pas aux valeurs relues depuis Supabase. Vérifie le déploiement de l’Edge Function.",
        true
      );
      return;
    }
    const missingAuthor = authorsToSave.find((selected) =>
      !savedWork?.authors.some((author) =>
        (selected.id ? author.id === selected.id : author.name === selected.name) &&
        author.role === selected.role
      )
    );
    if (missingAuthor) {
      showStatus(
        `L’œuvre est enregistrée, mais l’association de « ${missingAuthor.name} » n’a pas été retrouvée après relecture.`,
        true
      );
      return;
    }

    resetForm();
    showStatus(id ? "Œuvre modifiée !" : "Œuvre ajoutée !");
    if (id && selectedWorkId === savedId) await openWorkDetails(savedId);
  } catch (error) {
    showStatus(error.message || "Impossible d'enregistrer l’œuvre.", true);
    console.error("Saving work failed", error);
  } finally {
    submitButton.disabled = false;
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

$("resetForm").addEventListener("click", resetForm);
$("logoutButton").addEventListener("click", logout);

[
  ["is_owned", "is_not_owned"],
  ["is_read", "is_not_read"]
].forEach(([positiveId, negativeId]) => {
  const positive = $(positiveId);
  const negative = $(negativeId);
  positive.addEventListener("change", () => {
    if (positive.checked) negative.checked = false;
  });
  negative.addEventListener("change", () => {
    if (negative.checked) positive.checked = false;
  });
});

renderSelectedAuthors();

$("addExistingAuthor").addEventListener("click", () => {
  if (accessLevel !== "edit") return;
  const author = availableAuthors.find((item) => item.id === $("authorSelect").value);
  if (!author) {
    showAuthorStatus("Choisis un auteur existant dans la liste.", true);
    return;
  }
  const role = $("existingAuthorRole").value.trim() || "author";
  if (addSelectedAuthor({ id: author.id, name: author.name, role })) {
    $("authorSelect").value = "";
    $("existingAuthorRole").value = "author";
  }
});

$("addNewAuthor").addEventListener("click", () => {
  if (accessLevel !== "edit") return;
  const name = $("newAuthorName").value.trim();
  const role = $("newAuthorRole").value.trim() || "author";
  if (!name) {
    showAuthorStatus("Saisis le nom du nouvel auteur.", true);
    return;
  }
  if (addSelectedAuthor({ name, role })) {
    $("newAuthorName").value = "";
    $("newAuthorRole").value = "author";
  }
});

["search", "workTypeFilter", "priorityFilter"].forEach((id) => {
  $(id).addEventListener("input", renderWorks);
  $(id).addEventListener("change", renderWorks);
});
