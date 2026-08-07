// ── Generador de Historial de Pagos PDF (html-to-image + jsPDF) ─────────────
// Reemplaza la llamada a Apps Script: todo se arma y renderiza en el cliente.
// No requiere backend ni exponer keys. El texto queda rasterizado (no
// seleccionable) — aceptado a propósito para simplificar el flujo.
//
// Paleta: azul institucional (marca cliente-facing), no el verde interno
// del panel de staff. Coincide con el mockup v3 aprobado.

const LOGO_URL = "app_imagen_512px.png"; // raíz del repo, mismo origen que index.html

const HP_COLOR = {
  azulProfundo : "#0B3D66",
  azulCielo    : "#1E7FBF",
  dorado       : "#D4A017",
  verdeOk      : "#1E7A4C",
  rojoSaldo    : "#C6432E",
  grisTinta    : "#3B4552",
  grisSuave    : "#8A97A6",
  papel        : "#F7F9FB",
  linea        : "#E1E7ED"
};

async function generarHistorialPDF(event, vpId, nombrePasajero) {
  event.stopPropagation();

  const btn = event.currentTarget;
  btn.disabled = true;
  btn.classList.add("btn-pdf-loading");

  let hoja = null;

  try {
    // 1. Datos del viaje_pasajero
    const { data: vp, error: vpErr } = await supabaseClient
      .from("viaje_pasajeros")
      .select("total_a_pagar")
      .eq("id", parseInt(vpId))
      .single();

    if (vpErr || !vp) throw new Error("No se pudo obtener datos del pasajero.");

    // 2. Pagos + bancos + servicios extra en paralelo
    const [{ data: pagos, error: pgErr }, { data: bancosData }, { data: extrasVp }] = await Promise.all([
      supabaseClient
        .from("pagos")
        .select("monto, tipo, fecha_pago, banco, comprobante_nro")
        .eq("viaje_pasajero_id", parseInt(vpId))
        .order("fecha_pago", { ascending: true }),
      supabaseClient
        .from("bancos")
        .select("id, banco_id"),
      supabaseClient
        .from("servicio_extra_pasajeros")
        .select("precio_venta_real")
        .eq("viaje_pasajero_id", parseInt(vpId)),
    ]);

    if (pgErr) throw new Error("No se pudo obtener el historial de pagos.");

    const bancosMap = Object.fromEntries(
      (bancosData || []).map(b => [String(b.id), b.banco_id])
    );

    const listaPagos      = pagos || [];
    const pagosReales     = listaPagos.filter(p => p.tipo === "Pago");
    const devoluciones    = listaPagos.filter(p => p.tipo === "Devolución");
    const transferencias  = listaPagos.filter(p => p.tipo === "Transferencia");

    const sumaPagado    = pagosReales.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaDevuelto  = devoluciones.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaTransf    = transferencias.reduce((s, p) => s + (p.monto || 0), 0);
    const neto          = sumaPagado - sumaDevuelto - sumaTransf;
    const totalExtras   = (extrasVp || []).reduce((s, e) => s + (e.precio_venta_real || 0), 0);
    const total         = (vp.total_a_pagar || 0) + totalExtras;
    const saldo         = Math.max(0, total - neto);
    const pct           = total > 0 ? Math.min(100, Math.round((neto / total) * 100)) : 0;

    const formatFechaLocal = (fechaStr) => {
      if (!fechaStr) return "—";
      const d = new Date(fechaStr + "T00:00:00");
      return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    const formatGs = (n) => "Gs. " + Math.round(Math.abs(n)).toLocaleString("es-PY");

    const filasPagos = listaPagos.map(p => {
      const montoNeto = (p.tipo === "Devolución" || p.tipo === "Transferencia")
        ? -Math.abs(p.monto || 0)
        : (p.monto || 0);
      return {
        fecha       : formatFechaLocal(p.fecha_pago),
        banco       : bancosMap[String(p.banco)] || "—",
        comprobante : p.comprobante_nro || "—",
        monto       : montoNeto,
        tipo        : p.tipo || "Pago"
      };
    });

    const nombreViaje = viajeActualData?.nombre || "—";

    // 3. Armar el nodo HTML en memoria (fuera de pantalla) y capturarlo
    hoja = construirHojaHistorial({
      pasajero  : nombrePasajero,
      viaje     : nombreViaje,
      total, saldo, neto, pct,
      filas     : filasPagos,
      formatGs
    });
    document.body.appendChild(hoja);

    // esperar fuentes/logo antes de capturar
    await document.fonts.ready;
    await esperarImagenes(hoja);

    const dataUrl = await htmlToImage.toPng(hoja, {
      pixelRatio: 2,
      backgroundColor: "#ffffff"
    });

    // 4. Convertir la imagen a PDF con jsPDF (tamaño ajustado al contenido)
    const { jsPDF } = window.jspdf;
    const imgProps  = await obtenerDimensiones(dataUrl);
    const pdfWidth  = 210; // A4 mm
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    const pdf = new jsPDF({
      orientation : "portrait",
      unit        : "mm",
      format      : [pdfWidth, pdfHeight]
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, pdfWidth, pdfHeight);

    const nombreArchivo = `Historial_${nombrePasajero.replace(/\s+/g, "_")}_${nombreViaje.replace(/\s+/g, "_")}.pdf`;
    pdf.save(nombreArchivo);

  } catch (err) {
    console.error("Error generando PDF:", err);
    alert("No se pudo generar el PDF: " + err.message);
  } finally {
    if (hoja) hoja.remove();
    btn.disabled = false;
    btn.classList.remove("btn-pdf-loading");
  }
}

function esperarImagenes(root) {
  const imgs = Array.from(root.querySelectorAll("img"));
  return Promise.all(imgs.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
      img.onload  = resolve;
      img.onerror = resolve; // no bloquear el PDF si el logo falla en cargar
    });
  }));
}

function obtenerDimensiones(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.src = dataUrl;
  });
}

// ── Construcción del nodo HTML a capturar ────────────────────────────────
function construirHojaHistorial({ pasajero, viaje, total, saldo, neto, pct, filas, formatGs }) {
  const wrap = document.createElement("div");
  wrap.id = "hp-captura";
  wrap.style.cssText = `
    position:fixed; left:-9999px; top:0;
    width:680px;
    background:#ffffff;
    font-family:'Inter', -apple-system, sans-serif;
    color:${HP_COLOR.grisTinta};
  `;

  const filasHtml = filas.length
    ? filas.map((f, i) => `
      <tr style="background:${i % 2 === 0 ? "#ffffff" : HP_COLOR.papel};">
        <td style="padding:9px 10px;border-bottom:1px solid ${HP_COLOR.linea};color:${HP_COLOR.grisSuave};white-space:nowrap;">${f.fecha}</td>
        <td style="padding:9px 10px;border-bottom:1px solid ${HP_COLOR.linea};">${f.banco}</td>
        <td style="padding:9px 10px;border-bottom:1px solid ${HP_COLOR.linea};color:${HP_COLOR.grisSuave};">${f.comprobante}</td>
        <td style="padding:9px 10px;border-bottom:1px solid ${HP_COLOR.linea};text-align:right;font-weight:700;
                    color:${f.monto < 0 ? HP_COLOR.rojoSaldo : HP_COLOR.verdeOk};white-space:nowrap;">
          ${f.monto < 0 ? "− " : ""}${formatGs(f.monto)}
        </td>
      </tr>`).join("")
    : `<tr><td colspan="4" style="padding:20px;text-align:center;color:${HP_COLOR.grisSuave};">Sin pagos registrados</td></tr>`;

  wrap.innerHTML = `
    <div style="border-radius:14px;overflow:hidden;border:1px solid ${HP_COLOR.linea};">

      <div style="background:linear-gradient(135deg,${HP_COLOR.azulProfundo} 0%,${HP_COLOR.azulCielo} 100%);
                   padding:18px 28px;display:flex;align-items:center;gap:14px;">
        <img src="${LOGO_URL}" crossorigin="anonymous"
             style="width:40px;height:40px;border-radius:50%;background:#fff;object-fit:cover;flex-shrink:0;" />
        <div>
          <div style="font-size:17px;font-weight:800;color:#ffffff;letter-spacing:.2px;">Historial de Pagos</div>
          <div style="font-size:10.5px;font-weight:600;color:rgba(255,255,255,.72);
                       text-transform:uppercase;letter-spacing:.6px;">Guaranitour</div>
        </div>
      </div>

      <div style="padding:14px 28px;background:${HP_COLOR.papel};border-bottom:1px solid ${HP_COLOR.linea};">
        <div style="display:grid;grid-template-columns:88px 1fr;gap:10px;padding:3px 0;align-items:baseline;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${HP_COLOR.grisSuave};">Pasajero</span>
          <span style="font-size:13.5px;font-weight:700;color:${HP_COLOR.azulProfundo};word-break:break-word;">${escapeHtml(pasajero)}</span>
        </div>
        <div style="display:grid;grid-template-columns:88px 1fr;gap:10px;padding:3px 0;align-items:baseline;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${HP_COLOR.grisSuave};">Viaje</span>
          <span style="font-size:13.5px;font-weight:700;color:${HP_COLOR.azulProfundo};word-break:break-word;">${escapeHtml(viaje)}</span>
        </div>
      </div>

      <div style="margin:14px 28px;display:grid;grid-template-columns:1fr 1fr 1fr;
                   border:1px solid ${HP_COLOR.linea};border-radius:10px;overflow:hidden;">
        <div style="padding:11px 8px;text-align:center;border-right:1px solid ${HP_COLOR.linea};">
          <div style="font-size:16px;font-weight:800;color:${HP_COLOR.azulProfundo};">${formatGs(total)}</div>
          <div style="font-size:9px;color:${HP_COLOR.grisSuave};text-transform:uppercase;letter-spacing:.3px;font-weight:700;margin-top:2px;">Total</div>
        </div>
        <div style="padding:11px 8px;text-align:center;border-right:1px solid ${HP_COLOR.linea};">
          <div style="font-size:16px;font-weight:800;color:${HP_COLOR.verdeOk};">${formatGs(neto)}</div>
          <div style="font-size:9px;color:${HP_COLOR.grisSuave};text-transform:uppercase;letter-spacing:.3px;font-weight:700;margin-top:2px;">Pagado</div>
        </div>
        <div style="padding:11px 8px;text-align:center;">
          <div style="font-size:16px;font-weight:800;color:${saldo > 0 ? HP_COLOR.rojoSaldo : HP_COLOR.verdeOk};">${formatGs(saldo)}</div>
          <div style="font-size:9px;color:${HP_COLOR.grisSuave};text-transform:uppercase;letter-spacing:.3px;font-weight:700;margin-top:2px;">Saldo</div>
        </div>
      </div>

      <div style="padding:0 28px 6px;">
        <div style="height:6px;background:${HP_COLOR.linea};border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${HP_COLOR.azulCielo},${HP_COLOR.verdeOk});"></div>
        </div>
      </div>

      <div style="margin:16px 28px 0;">
        <div style="font-size:12.5px;font-weight:800;color:${HP_COLOR.azulProfundo};margin-bottom:6px;
                     display:flex;align-items:center;gap:6px;">
          <span style="width:3px;height:12px;background:${HP_COLOR.dorado};border-radius:2px;display:inline-block;"></span>
          Histórico de pagos (${filas.length})
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;
                          color:${HP_COLOR.grisSuave};font-weight:700;padding:6px 10px;border-bottom:2px solid ${HP_COLOR.linea};">Fecha</th>
              <th style="text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;
                          color:${HP_COLOR.grisSuave};font-weight:700;padding:6px 10px;border-bottom:2px solid ${HP_COLOR.linea};">Banco</th>
              <th style="text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;
                          color:${HP_COLOR.grisSuave};font-weight:700;padding:6px 10px;border-bottom:2px solid ${HP_COLOR.linea};">Comprobante</th>
              <th style="text-align:right;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;
                          color:${HP_COLOR.grisSuave};font-weight:700;padding:6px 10px;border-bottom:2px solid ${HP_COLOR.linea};">Monto</th>
            </tr>
          </thead>
          <tbody>${filasHtml}</tbody>
        </table>
      </div>

      <div style="padding:14px 28px 20px;text-align:center;font-size:9.5px;color:${HP_COLOR.grisSuave};
                   border-top:1px solid ${HP_COLOR.linea};margin-top:12px;">
        Documento generado automáticamente a partir de los registros de pagos de Guaranitour.
      </div>
    </div>
  `;

  return wrap;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
