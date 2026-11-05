// Populates the navbar's "Receptor"/"Chemokine" dropdowns from the database
// and wires up the navbar search box. Shared by index.html and pair.html —
// loadDB()/queryAll() come from db.js, already loaded on both pages.
(function () {
  function escapeNavHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // Click-based (not hover) so it works the same on touch and desktop.
  document.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
    const toggle = dropdown.querySelector(".nav-dropdown-toggle");
    const menu = dropdown.querySelector(".nav-dropdown-menu");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = menu.classList.contains("open");
      document.querySelectorAll(".nav-dropdown-menu.open").forEach((m) => m.classList.remove("open"));
      if (!isOpen) menu.classList.add("open");
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".nav-dropdown-menu.open").forEach((m) => m.classList.remove("open"));
  });

  const searchForm = document.getElementById("navSearchForm");
  const searchInput = document.getElementById("navSearchInput");
  if (searchForm) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = searchInput.value.trim();
      location.href = `index.html${q ? "?q=" + encodeURIComponent(q) : ""}`;
    });
  }

  (async function populateMenus() {
    const receptorMenu = document.getElementById("receptorMenu");
    const chemokineMenu = document.getElementById("chemokineMenu");
    if (!receptorMenu && !chemokineMenu) return;

    let db;
    try {
      db = await loadDB();
    } catch (err) {
      return; // menus just stay empty if the database can't load
    }

    function populate(menu, rows) {
      if (!menu) return;
      menu.innerHTML = rows
        .map((r) => `<a href="index.html?q=${encodeURIComponent(r.name)}">${escapeNavHtml(r.name)}</a>`)
        .join("");
    }

    populate(receptorMenu, queryAll(db, "SELECT name FROM receptors ORDER BY name"));
    populate(chemokineMenu, queryAll(db, "SELECT name FROM chemokines ORDER BY name"));
  })();
})();
