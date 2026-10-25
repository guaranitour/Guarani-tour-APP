// archivos-nativo.js — descargar/compartir archivos tanto en la web como en la
// app nativa (Capacitor). En el WebView de Android un <a download> con un blob
// no hace nada y navigator.share({files}) no está soportado, así que en nativo
// se escribe el archivo en el caché y se abre el panel de compartir del sistema
// (desde ahí se puede guardar en Descargas/Drive, mandar por WhatsApp, etc.).

(function () {
  const esNativa = () =>
    !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  function blobABase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  function nombreSeguro(nombre) {
    return String(nombre || "archivo").replace(/[\/:*?"<>|]+/g, "_");
  }

  // Descarga (web) o abre el panel de compartir/guardar (nativo).
  // opciones: { title, text } para el panel de compartir.
  window.compartirOGuardarArchivo = async function (blob, nombre, opciones = {}) {
    nombre = nombreSeguro(nombre);

    if (esNativa()) {
      const { Filesystem, Share } = window.Capacitor.Plugins;
      if (!Filesystem || !Share) {
        throw new Error("Falta actualizar la app (plugins Filesystem/Share).");
      }
      const { uri } = await Filesystem.writeFile({
        path: nombre,
        data: await blobABase64(blob),
        directory: "CACHE",
      });
      try {
        await Share.share({
          title: opciones.title || nombre,
          text: opciones.text,
          url: uri,
          dialogTitle: opciones.title || "Guardar o compartir",
        });
      } catch (e) {
        // El usuario cerró el panel: no es un error.
        if (!/cancel/i.test(String(e && (e.message || e)))) throw e;
      }
      return;
    }

    const file = new File([blob], nombre, { type: blob.type });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: opciones.title, text: opciones.text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
        // otro error: cae a descarga directa
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  // Abre el archivo con el visor del sistema (nativo) o en una pestaña (web).
  window.abrirArchivo = async function (blob, nombre) {
    nombre = nombreSeguro(nombre);
    if (!esNativa()) {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }
    const { Filesystem, FileOpener } = window.Capacitor.Plugins;
    if (!Filesystem || !FileOpener) throw new Error("Falta actualizar la app (plugins).");
    const { uri } = await Filesystem.writeFile({
      path: nombre,
      data: await blobABase64(blob),
      directory: "CACHE",
    });
    await FileOpener.open({ filePath: uri, contentType: blob.type || undefined });
  };

  // Guarda de verdad el archivo: en nativo va a Descargas (o Documentos/GuaraniTour
  // si Android no deja escribir ahí) y devuelve un texto con el destino.
  window.guardarArchivo = async function (blob, nombre) {
    nombre = nombreSeguro(nombre);
    if (!esNativa()) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return "";
    }
    const { Filesystem } = window.Capacitor.Plugins;
    if (!Filesystem) throw new Error("Falta actualizar la app (plugins).");
    const data = await blobABase64(blob);
    try {
      await Filesystem.writeFile({ path: "Download/" + nombre, data, directory: "EXTERNAL_STORAGE", recursive: true });
      return "Descargas";
    } catch (_) {
      await Filesystem.writeFile({ path: "GuaraniTour/" + nombre, data, directory: "DOCUMENTS", recursive: true });
      return "Documentos/GuaraniTour";
    }
  };

  // Comparte directo a WhatsApp (si hay normal y Business deja elegir entre los dos).
  // Sin WhatsApp instalado, o en la web, cae al panel de compartir de siempre.
  window.compartirPorWhatsApp = async function (blob, nombre, opciones = {}) {
    nombre = nombreSeguro(nombre);
    if (esNativa()) {
      const { Filesystem, WhatsAppShare } = window.Capacitor.Plugins;
      if (Filesystem && WhatsAppShare) {
        const { uri } = await Filesystem.writeFile({
          path: nombre,
          data: await blobABase64(blob),
          directory: "CACHE",
        });
        try {
          await WhatsAppShare.compartir({ uri, texto: opciones.text || "", mime: blob.type || "image/png" });
          return;
        } catch (e) {
          if (!/no_whatsapp/.test(String(e && (e.message || e)))) throw e;
        }
      }
    }
    return window.compartirOGuardarArchivo(blob, nombre, opciones);
  };
})();
