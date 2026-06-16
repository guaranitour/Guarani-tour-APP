// Versión del sistema (simple pero escalable)
const APP_VERSION = "1.0.0";

document.addEventListener("DOMContentLoaded", () => {
  const versionElement = document.getElementById("version");
  versionElement.textContent = "Versión " + APP_VERSION;
});
``
