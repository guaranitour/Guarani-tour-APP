// tema.js — menú hamburguesa, tema claro/oscuro y modal "Acerca de".
// Extraído de app.js.

// ── Menú hamburguesa ───────────────────────────────────────
function toggleMenu() {
  document.getElementById("hamburger-menu").classList.toggle("open");
}

function closeMenu() {
  document.getElementById("hamburger-menu").classList.remove("open");
}

// ── Tema claro/oscuro ──────────────────────────────────────
const THEME_KEY = "gt-theme";
const THEME_COLOR_LIGHT = "#1a3a2a";
const THEME_COLOR_DARK = "#15171a";

function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);

  const metaColorScheme = document.getElementById("meta-color-scheme");
  if (metaColorScheme) metaColorScheme.setAttribute("content", theme === "dark" ? "dark" : "light");

  const iconDark = document.getElementById("theme-icon-dark");
  const iconLight = document.getElementById("theme-icon-light");
  const label = document.getElementById("theme-toggle-label");
  if (iconDark && iconLight && label) {
    if (theme === "dark") {
      iconDark.style.display = "none";
      iconLight.style.display = "";
      label.textContent = "Modo claro";
    } else {
      iconDark.style.display = "";
      iconLight.style.display = "none";
      label.textContent = "Modo oscuro";
    }
  }
}

function toggleTheme() {
  const next = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
}

// Sincronizar el botón del menú con el tema ya aplicado (definido inline en <head>)
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getCurrentTheme());
});

// Si el usuario no eligió tema manualmente, seguir la preferencia del sistema en vivo
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!getStoredTheme()) applyTheme(e.matches ? "dark" : "light");
  });
}

// ── Modal Acerca de ────────────────────────────────────────
function abrirAcercaDe() {
  const modal = document.getElementById("modal-acerca");
  if (!modal) return;
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function cerrarAcercaDe(e) {
  // Si se pasa un evento, solo cerrar si el click fue en el overlay (no en el sheet)
  if (e && e.target !== document.getElementById("modal-acerca")) return;
  const modal = document.getElementById("modal-acerca");
  if (!modal) return;
  modal.style.display = "none";
  document.body.style.overflow = "";
}

// Cerrar al hacer click fuera
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("hamburger-wrap") || e.target.closest(".hamburger-wrap");
  if (!e.target.closest(".hamburger-wrap")) closeMenu();
});
