const SUPABASE_URL = "https://itbmwxnqeajiequjdezh.supabase.co";
const SUPABASE_KEY = "sb_publishable_wyI9gQlY6JxcZ6EskKxCCQ_Of9BZBZF";
const EDIT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/dream-library-edit`;

const $ = (id) => document.getElementById(id);

let works = [];
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
    authors: Array.isArray(work.authors) ? work.authors : []
  };
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
      <article class="book-card">
        ${cover}
        <div class="book-info">
          <h3>${escapeHTML(work.title)}</h3>
          <p class="book-author">${authorNames}</p>
          <div class="badges">
            ${work.work_type ? `<span class="badge">${escapeHTML(work.work_type)}</span>` : ""}
            ${work.original_language ? `<span class="badge">${escapeHTML(work.original_language)}</span>` : ""}
            ${work.is_priority ? '<span class="badge owned">Prioritaire</span>' : ""}
          </div>
          ${work.summary ? `<details><summary>Lire le résumé</summary><p>${escapeHTML(work.summary)}</p></details>` : ""}
        </div>
        ${accessLevel === "edit" ? `
          <div class="book-actions">
            <button type="button" data-edit="${escapeHTML(work.id)}">Modifier</button>
            <button type="button" class="delete-button" data-delete="${escapeHTML(work.id)}">Supprimer</button>
          </div>` : ""}
      </article>
    `;
  }).join("");

  if (accessLevel === "edit") {
    grid.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const work = works.find((item) => item.id === button.dataset.edit);
        if (work) fillForm(work);
      });
    });

    grid.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteWork(button.dataset.delete));
    });
  }

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
}

function logout() {
  accessPassword = "";
  accessLevel = "";
  modeSwitchTarget = "";
  works = [];
  availableAuthors = [];
  selectedAuthors = [];
  $("appContent").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginPanel").classList.remove("hidden");
  $("loginTitle").textContent = "Accès à Dream Library";
  $("password").value = "";
  $("loginMessage").textContent = "";
  $("workGrid").replaceChildren();
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
    is_priority: $("isPriority").checked
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
    showStatus("Œuvre supprimée.");
  } catch (error) {
    showStatus(error.message || "Impossible de supprimer l’œuvre.", true);
    console.error("works_delete failed", error);
  }
}

$("resetForm").addEventListener("click", resetForm);
$("logoutButton").addEventListener("click", logout);

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
