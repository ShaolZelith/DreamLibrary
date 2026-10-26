const SUPABASE_URL = "https://itbmwxnqeajiequjdezh.supabase.co";
const SUPABASE_KEY = "sb_publishable_wyI9gQlY6JxcZ6EskKxCCQ_Of9BZBZF";
const EDIT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/dream-library-edit`;

const $ = (id) => document.getElementById(id);

let books = [];
let accessPassword = "";
let accessLevel = "";

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

function normalizeBook(book) {
  return {
    id: book.id,
    title: book.title || "Sans titre",
    author: book.author || "Auteur inconnu",
    cover_url: book.cover_url || "",
    summary: book.summary || "",
    genre: book.genre || "",
    pages: book.pages ?? "",
    publication_year: book.publication_year ?? "",
    is_read: Boolean(book.is_read),
    is_owned: Boolean(book.is_owned)
  };
}

async function editRequest(action, password = accessPassword, book, id) {
  const response = await fetch(EDIT_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY
    },
    body: JSON.stringify({
      password,
      action,
      ...(id ? { id } : {}),
      ...(book ? { book } : {})
    })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || `Erreur serveur (${response.status})`);
  }

  return result;
}

async function loadBooks() {
  showStatus("Chargement de la bibliothèque…");

  try {
    const result = await editRequest("list");
    books = result.books.map(normalizeBook);
    renderBooks();
    showStatus(books.length ? "" : "La bibliothèque est vide. Ajoute ton premier livre !");
  } catch (error) {
    showStatus("Impossible de charger les livres. Vérifie la configuration de la fonction Supabase.", true);
    console.error(error);
  }
}

function renderBooks() {
  const query = $("search").value.trim().toLocaleLowerCase("fr");
  const readFilter = $("readFilter").value;
  const ownedFilter = $("ownedFilter").value;

  const filtered = books.filter((book) => {
    const matchesQuery =
      book.title.toLocaleLowerCase("fr").includes(query) ||
      book.author.toLocaleLowerCase("fr").includes(query);

    const matchesRead =
      readFilter === "all" || String(book.is_read) === readFilter;

    const matchesOwned =
      ownedFilter === "all" || String(book.is_owned) === ownedFilter;

    return matchesQuery && matchesRead && matchesOwned;
  });

  $("bookCount").textContent =
    `${filtered.length} livre${filtered.length > 1 ? "s" : ""}`;

  const grid = $("bookGrid");

  if (!filtered.length) {
    grid.innerHTML = '<p class="empty-state">Aucun livre trouvé.</p>';
    return;
  }

  grid.innerHTML = filtered.map((book) => {
    const cover = book.cover_url
      ? `<img class="book-cover" src="${escapeHTML(book.cover_url)}" alt="Couverture de ${escapeHTML(book.title)}" loading="lazy">`
      : `<div class="book-cover">${escapeHTML(book.title)}</div>`;

    return `
      <article class="book-card">
        ${cover}
        <div class="book-info">
          <h3>${escapeHTML(book.title)}</h3>
          <p class="book-author">${escapeHTML(book.author)}</p>
          <div class="badges">
            <span class="badge ${book.is_read ? "read" : ""}">
              ${book.is_read ? "Lu" : "Non lu"}
            </span>
            <span class="badge ${book.is_owned ? "owned" : ""}">
              ${book.is_owned ? "Possédé" : "Non possédé"}
            </span>
          </div>
          ${book.genre ? `<p>${escapeHTML(book.genre)}</p>` : ""}
          ${book.pages ? `<p>${escapeHTML(book.pages)} pages</p>` : ""}
          ${book.publication_year ? `<p>${escapeHTML(book.publication_year)}</p>` : ""}
          ${book.summary ? `<details><summary>Lire le résumé</summary><p>${escapeHTML(book.summary)}</p></details>` : ""}
        </div>
        ${accessLevel === "edit" ? `
          <div class="book-actions">
            <button type="button" data-edit="${escapeHTML(book.id)}">Modifier</button>
            <button type="button" class="delete-button" data-delete="${escapeHTML(book.id)}">Supprimer</button>
          </div>` : ""}
      </article>
    `;
  }).join("");

  if (accessLevel === "edit") {
    grid.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const book = books.find((item) => item.id === button.dataset.edit);
        if (book) fillForm(book);
      });
    });

    grid.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteBook(button.dataset.delete));
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
  $("editorPanel").classList.remove("hidden");
  $("editModeButton").textContent = "Quitter le mode édition";
}

function hideEditor() {
  $("editorPanel").classList.add("hidden");
  $("editModeButton").textContent = "Passer en mode édition";
  resetForm();
}

function resetForm() {
  $("bookForm").reset();
  $("bookId").value = "";
  $("formTitle").textContent = "Ajouter un livre";
}

function fillForm(book) {
  $("bookId").value = book.id;
  $("title").value = book.title === "Sans titre" ? "" : book.title;
  $("author").value = book.author === "Auteur inconnu" ? "" : book.author;
  $("coverUrl").value = book.cover_url;
  $("summary").value = book.summary;
  $("genre").value = book.genre;
  $("pages").value = book.pages;
  $("year").value = book.publication_year;
  $("isRead").checked = book.is_read;
  $("isOwned").checked = book.is_owned;
  $("formTitle").textContent = "Modifier un livre";
  showEditor();
  $("editorPanel").scrollIntoView({ behavior: "smooth" });
}

function openLogin() {
  $("loginPage").classList.remove("hidden");
  $("loginPanel").classList.remove("hidden");
  $("loginTitle").textContent = accessLevel === "view"
    ? "Accès éditeur"
    : "Accès à Dream Library";
  $("password").focus();
}

function closeLogin() {
  $("loginPanel").classList.add("hidden");
  $("password").value = "";
  $("loginMessage").textContent = "";
  if (accessLevel) {
    $("loginPage").classList.add("hidden");
  } else {
    $("loginPanel").classList.remove("hidden");
  }
}

function logout() {
  accessPassword = "";
  accessLevel = "";
  books = [];
  $("appContent").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginPanel").classList.remove("hidden");
  $("loginTitle").textContent = "Accès à Dream Library";
  $("password").value = "";
  $("loginMessage").textContent = "";
  $("bookGrid").replaceChildren();
  $("bookCount").textContent = "0 livre";
  $("search").value = "";
  $("readFilter").value = "all";
  $("ownedFilter").value = "all";
  hideEditor();
}

$("editModeButton").addEventListener("click", () => {
  if (accessLevel === "edit") {
    if ($("editorPanel").classList.contains("hidden")) {
      showEditor();
      $("editorPanel").scrollIntoView({ behavior: "smooth" });
    } else {
      hideEditor();
    }
    return;
  }

  openLogin();
});

$("cancelLogin").addEventListener("click", () => {
  if (accessLevel) {
    closeLogin();
  } else {
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
    accessPassword = candidatePassword;
    accessLevel = result.role;
    $("loginPage").classList.add("hidden");
    $("appContent").classList.remove("hidden");
    $("loginPanel").classList.add("hidden");
    $("password").value = "";
    $("loginMessage").textContent = "";

    if (accessLevel === "edit") {
      showEditor();
    } else {
      hideEditor();
    }

    await loadBooks();
  } catch (error) {
    $("loginMessage").textContent = error.message === "Mot de passe incorrect"
      ? "Mot de passe incorrect."
      : "La vérification a échoué. Vérifie la configuration de la fonction Supabase.";
  } finally {
    submitButton.disabled = false;
  }
});

$("bookForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (accessLevel !== "edit" || !accessPassword) return;

  const title = $("title").value.trim();
  if (!title) {
    showStatus("Le titre est obligatoire.", true);
    return;
  }

  const book = {
    title,
    author: $("author").value.trim(),
    cover_url: $("coverUrl").value.trim(),
    summary: $("summary").value.trim(),
    genre: $("genre").value.trim(),
    pages: $("pages").value ? Number($("pages").value) : null,
    publication_year: $("year").value ? Number($("year").value) : null,
    is_read: $("isRead").checked,
    is_owned: $("isOwned").checked
  };

  const id = $("bookId").value;
  const submitButton = $("bookForm").querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    await editRequest(id ? "update" : "create", accessPassword, book, id);
    resetForm();
    await loadBooks();
    showStatus(id ? "Livre modifié !" : "Livre ajouté !");
  } catch (error) {
    showStatus(error.message || "Impossible d'enregistrer le livre.", true);
  } finally {
    submitButton.disabled = false;
  }
});

async function deleteBook(id) {
  if (accessLevel !== "edit" || !confirm("Supprimer ce livre ?")) return;

  try {
    await editRequest("delete", accessPassword, null, id);
    await loadBooks();
    showStatus("Livre supprimé.");
  } catch (error) {
    showStatus(error.message || "Impossible de supprimer le livre.", true);
  }
}

$("resetForm").addEventListener("click", resetForm);
$("logoutButton").addEventListener("click", logout);

["search", "readFilter", "ownedFilter"].forEach((id) => {
  $(id).addEventListener("input", renderBooks);
  $(id).addEventListener("change", renderBooks);
});
