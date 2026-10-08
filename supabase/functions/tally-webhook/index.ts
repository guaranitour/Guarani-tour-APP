// tally-webhook — recibe el webhook de Tally (evento FORM_RESPONSE) y guarda
// la respuesta en public.encuesta_respuestas apenas se envía la encuesta.
// Seguridad: verifica el header Tally-Signature (HMAC-SHA256 en base64 del
// body) con el secreto TALLY_SIGNING_SECRET configurado en Supabase y en Tally.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Prefijo del título de cada pregunta -> columna tipada de la tabla
const COLUMNAS: Array<[string, string]> = [
  ["Actualmente, ¿seguís viajando", "sigue_viajando"],
  ["¿Qué es lo que más valorás", "lo_que_valora"],
  ["Pensando en tus experiencias", "que_hace_bien"],
  ["Si actualmente viajás menos", "motivo_viaja_menos"],
  ["Cuando elegís actualmente", "factores_decision"],
  ["¿Qué tipo de experiencias", "experiencias_deseadas"],
  ["¿Qué podríamos mejorar", "que_mejorar"],
  ["¿Qué tendría que darse", "que_tendria_que_darse"],
];

type Campo = {
  key: string;
  label: string | null;
  type: string;
  value: unknown;
  options?: Array<{ id: string; text: string }>;
};

async function firmaValida(body: string, firma: string | null, secreto: string) {
  if (!firma) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const esperado = btoa(String.fromCharCode(...sig));
  if (esperado.length !== firma.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ firma.charCodeAt(i);
  return diff === 0;
}

// Convierte el valor de Tally a algo legible (ids de opciones -> texto)
function valorLegible(c: Campo): unknown {
  if (Array.isArray(c.value) && c.options?.length) {
    return c.value.map((id) => c.options!.find((o) => o.id === id)?.text ?? id);
  }
  if (typeof c.value === "string" && c.options?.length) {
    return c.options.find((o) => o.id === c.value)?.text ?? c.value;
  }
  return c.value;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secreto = Deno.env.get("TALLY_SIGNING_SECRET");
  if (!secreto) return new Response("Falta TALLY_SIGNING_SECRET", { status: 500 });

  const body = await req.text();
  if (!(await firmaValida(body, req.headers.get("tally-signature"), secreto))) {
    return new Response("Firma inválida", { status: 401 });
  }

  let evento: any;
  try { evento = JSON.parse(body); } catch { return new Response("JSON inválido", { status: 400 }); }
  if (evento?.eventType !== "FORM_RESPONSE" || !evento.data) {
    return new Response("Evento ignorado", { status: 200 });
  }

  const d = evento.data;
  const campos: Campo[] = d.fields ?? [];
  // Tally manda además un campo booleano por cada opción de checkbox: se omiten
  const principales = campos.filter((c) => typeof c.value !== "boolean");

  const fila: Record<string, unknown> = {
    submission_id: d.submissionId ?? d.responseId,
    respondent_id: d.respondentId ?? null,
    form_id: d.formId,
    form_name: d.formName ?? null,
    submitted_at: d.createdAt ?? evento.createdAt ?? new Date().toISOString(),
    respuestas: principales.map((c) => ({ label: c.label, type: c.type, value: valorLegible(c) })),
    payload: evento,
  };

  for (const c of principales) {
    const label = (c.label ?? "").trim();
    const v = valorLegible(c);
    if (c.type === "RATING") { fila.probabilidad_volver = typeof v === "number" ? v : Number(v) || null; continue; }
    const col = COLUMNAS.find(([pref]) => label.startsWith(pref))?.[1];
    if (!col || v == null || v === "") continue;
    if (col === "sigue_viajando") fila[col] = Array.isArray(v) ? v.join(", ") : String(v);
    else if (col === "que_hace_bien" || col === "que_mejorar") fila[col] = String(v);
    else {
      // Respuesta "Otro": Tally la manda como campo de texto aparte (label con "(Otro)")
      const arr = Array.isArray(v) ? v.map(String) : [String(v)];
      fila[col] = [...((fila[col] as string[]) ?? []), ...arr];
    }
  }

  const { error } = await supabase
    .from("encuesta_respuestas")
    .upsert(fila, { onConflict: "submission_id" });
  if (error) {
    console.error("Error guardando respuesta:", error);
    return new Response("Error al guardar", { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
