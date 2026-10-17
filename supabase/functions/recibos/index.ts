// ══════════════════════════════════════════════
//  EDGE FUNCTION: recibos
//  Orquesta: validación → Apps Script (PDF) → insert en Supabase.
//  Si el insert falla después de generar el PDF, se hace rollback
//  (se borra el archivo en Drive) para no dejar PDFs huérfanos.
//
//  Permisos por tareas (public.has_permission):
//    generar   → recibos.crear
//    descargar → recibos.ver
// ══════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

// ── Config (secrets) ──────────────────────────────────────────
const APPSCRIPT_URL = Deno.env.get("APPSCRIPT_URL")!;
const APPSCRIPT_TOKEN = Deno.env.get("APPSCRIPT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ── Permisos por tareas ───────────────────────────────────────
// has_permission() es SECURITY DEFINER y resuelve al usuario por el JWT
// del cliente, así que se llama con el mismo cliente autenticado.
async function tienePermiso(supabase: ReturnType<typeof createClient>, codigo: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_permission", { p: codigo });
  return !error && data === true;
}

// ── Llamada a Apps Script ─────────────────────────────────────
// Reintenta una vez si la respuesta no es JSON válido: Apps Script a
// veces devuelve HTML de error transitorio (redirección/cuota) aunque
// la ejecución interna haya terminado bien. Un reintento simple cubre
// la mayoría de esos casos sin duplicar efectos (generarRecibo y
// enviarEmailRecibo son las únicas acciones con efectos secundarios
// reales, y un reintento aislado en ellas es aceptable: ver nota en
// accionGenerar sobre por qué el email se separó a un segundo paso).
async function llamarAppsScriptUnaVez(payload: Record<string, unknown>) {
  const res = await fetch(APPSCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // Apps Script requiere text/plain para evitar preflight CORS
    body: JSON.stringify({ token: APPSCRIPT_TOKEN, ...payload }),
  });
  return await res.json();
}

async function llamarAppsScript(payload: Record<string, unknown>) {
  let data;
  try {
    data = await llamarAppsScriptUnaVez(payload);
  } catch {
    // Falló el parseo (probablemente HTML en vez de JSON) — reintentar
    // una vez antes de dar por perdido el llamado.
    data = await llamarAppsScriptUnaVez(payload);
  }

  if (!data.ok) throw new Error(data.error || "Error en Apps Script");
  return data.data;
}

function extraerFileIdDrive(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ── Validación server-side de campos obligatorios ─────────────
const CAMPOS_OBLIGATORIOS = [
  "cliente", "ci", "email", "monto", "moneda", "fecha", "concepto", "metodo_pago", "abona_por", "tipo_recibo_id",
] as const;
const MONEDAS_VALIDAS = ["PYG", "USD"];

function validarPayloadGenerar(body: Record<string, unknown>): string | null {
  for (const campo of CAMPOS_OBLIGATORIOS) {
    const valor = body[campo];
    if (valor === undefined || valor === null || valor === "") {
      return `Falta el campo obligatorio: ${campo}`;
    }
  }
  if (isNaN(Number(body.monto)) || Number(body.monto) <= 0) {
    return "El monto debe ser un número mayor a 0";
  }
  if (!MONEDAS_VALIDAS.includes(body.moneda as string)) {
    return "La moneda debe ser PYG o USD";
  }
  return null;
}

// ── Acción: generar recibo (PDF + registro en DB) ─────────────
async function accionGenerar(body: Record<string, unknown>, supabase: ReturnType<typeof createClient>) {
  // Se verifica ANTES de generar el PDF: si el insert fuera rechazado por
  // RLS recién al final, ya habría un PDF creado en Drive (y el rollback
  // es de mejor esfuerzo).
  if (!(await tienePermiso(supabase, "recibos.crear"))) {
    return jsonResponse({ ok: false, error: "No tenés permiso para generar recibos" }, 403);
  }

  const errorValidacion = validarPayloadGenerar(body);
  if (errorValidacion) {
    return jsonResponse({ ok: false, error: errorValidacion }, 400);
  }

  // 1. Resolver el tipo de recibo (nombre + plantilla) desde la FK
  const tipoReciboId = Number(body.tipo_recibo_id);
  const { data: tipoRecibo, error: tipoError } = await supabase
    .from("tipo_recibos")
    .select("id, tipo, template_id")
    .eq("id", tipoReciboId)
    .single();

  if (tipoError || !tipoRecibo) {
    return jsonResponse({ ok: false, error: "El tipo de recibo seleccionado no existe" }, 400);
  }
  if (!tipoRecibo.template_id) {
    return jsonResponse({ ok: false, error: `El tipo "${tipoRecibo.tipo}" todavía no tiene una plantilla configurada` }, 400);
  }

  // 2. Generar PDF vía Apps Script
  let pdfData: { recibo: string; url: string; fileId: string; cliente: string; monto: number; moneda: string; fecha: string };
  try {
    pdfData = await llamarAppsScript({
      cliente: body.cliente,
      monto: Number(body.monto),
      moneda: body.moneda,
      fecha: body.fecha,
      ci: body.ci,
      concepto: body.concepto,
      metodo_pago: body.metodo_pago,
      banco: body.banco || "",
      comprobante: body.comprobante || "",
      email: body.email,
      tipo_recibo: tipoRecibo.tipo,
      template_id: tipoRecibo.template_id,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: `No se pudo generar el PDF: ${(e as Error).message}` }, 502);
  }

  // 3. Insertar en la tabla recibos
  const payload = {
    cliente: body.cliente,
    monto: Number(body.monto),
    moneda: body.moneda,
    fecha: body.fecha,
    ci: body.ci || null,
    correo_beneficiario: body.email || null,
    concepto: body.concepto || null,
    forma_pago: body.metodo_pago || null,
    banco: body.banco || null,
    comprobante: body.comprobante || null,
    abona_por: body.abona_por || null,
    tipo_recibo_id: tipoReciboId,
    usuario: body.usuario || null,
    link: pdfData.url,
    recibo_nro: pdfData.recibo,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("recibos")
    .insert([payload])
    .select()
    .single();

  if (insertError) {
    // ── Rollback: el PDF ya existe en Drive pero no se pudo guardar
    // el registro. Lo borramos para no dejar archivos huérfanos.
    const fileId = extraerFileIdDrive(pdfData.url);
    if (fileId) {
      try {
        await llamarAppsScript({ action: "delete", fileId });
      } catch {
        // Si el rollback también falla, priorizamos informar el error
        // original al usuario; el PDF huérfano queda para limpieza manual.
      }
    }
    return jsonResponse({ ok: false, error: `No se pudo guardar el recibo: ${insertError.message}` }, 500);
  }

  // 4. Enviar el email, recién ahora que el recibo ya quedó guardado.
  // Si esto falla, el recibo NO se pierde (ya está en la base) — solo
  // avisamos que el email no salió, para reenviarlo manualmente después.
  let emailEnviado = true;
  let emailError: string | null = null;
  if (body.email) {
    try {
      await llamarAppsScript({
        action: "email",
        email: body.email,
        fileId: pdfData.fileId,
        recibo: pdfData.recibo,
        cliente: body.cliente,
        tipo_recibo: tipoRecibo.tipo,
      });
    } catch (e) {
      emailEnviado = false;
      emailError = (e as Error).message;
    }
  }

  return jsonResponse({
    ok: true,
    data: { ...inserted, email_enviado: emailEnviado, email_error: emailError },
  });
}

// ── Acción: descargar comprobante en base64 (para Web Share API) ─
async function accionDescargar(body: Record<string, unknown>, supabase: ReturnType<typeof createClient>) {
  if (!(await tienePermiso(supabase, "recibos.ver"))) {
    return jsonResponse({ ok: false, error: "No tenés permiso para ver recibos" }, 403);
  }
  if (!body.fileId) return jsonResponse({ ok: false, error: "Falta fileId" }, 400);

  try {
    const data = await llamarAppsScript({ action: "download", fileId: body.fileId });
    return jsonResponse({ ok: true, data });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 502);
  }
}

// ── Handler principal ──────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Método no permitido" }, 405);
  }

  // Autenticación: exige un usuario logueado de Supabase Auth (JWT
  // enviado automáticamente por supabaseClient.functions.invoke).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ ok: false, error: "No autorizado" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ ok: false, error: "No autorizado" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "JSON inválido" }, 400);
  }

  switch (body.action) {
    case "descargar":
      return accionDescargar(body, supabase);
    case "generar":
    default:
      return accionGenerar(body, supabase);
  }
});
