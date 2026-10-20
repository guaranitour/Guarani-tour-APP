// supabase/functions/resend-webhook/index.ts
//
// Recibe los webhooks de Resend y avisa al staff con el permiso
// mail_automaticos.ver cuando un correo automático (recibos, BYC):
//   · rebota           → email.bounced
//   · es marcado spam  → email.complained
// Avisa por push FCM (data-only, mismo patrón que send-notifications) y
// deja una fila en notificaciones_bandeja. El resto de eventos se ignora.
//
// Seguridad: verifica la firma Svix (svix-id, svix-timestamp, svix-signature)
// con el secreto RESEND_WEBHOOK_SECRET ("whsec_...") de Resend.
// Despliegue: verify_jwt = false (Resend no envía JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!;
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");

const PERMISO = "mail_automaticos.ver";
const TOLERANCIA_SEG = 300;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Firma Svix ---
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function firmaValida(body: string, req: Request, secreto: string): Promise<boolean> {
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const firmas = req.headers.get("svix-signature");
  if (!id || !ts || !firmas) return false;

  // Rechaza mensajes viejos o del futuro (replay)
  if (Math.abs(Date.now() / 1000 - Number(ts)) > TOLERANCIA_SEG) return false;

  const key = await crypto.subtle.importKey(
    "raw", b64ToBytes(secreto.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)),
  );
  const esperado = btoa(String.fromCharCode(...sig));

  // El header trae una o más firmas: "v1,xxx v1,yyy"
  return firmas.split(" ").some((f) => {
    const [, valor] = f.split(",");
    if (!valor || valor.length !== esperado.length) return false;
    let diff = 0;
    for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ valor.charCodeAt(i);
    return diff === 0;
  });
}

// --- FCM: access token a partir de la Service Account ---
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  return b64ToBytes(b64).buffer;
}

async function getAccessToken(): Promise<string> {
  const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sigB64}`,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("No se pudo obtener access_token: " + JSON.stringify(data));
  return data.access_token;
}

// --- Destinatarios: staff activo con el permiso (rol o concesión individual) ---
async function destinatarios(): Promise<string[]> {
  const [{ data: staff }, { data: porRol }, { data: individuales }] = await Promise.all([
    supabase.from("staff").select("id, role").eq("status", "enabled"),
    supabase.from("rol_permisos").select("role").eq("permiso", PERMISO),
    supabase.from("staff_permisos").select("staff_id, concedido").eq("permiso", PERMISO),
  ]);
  const roles = new Set((porRol ?? []).map((r: { role: string }) => r.role));
  const ind = new Map((individuales ?? []).map((p: { staff_id: string; concedido: boolean }) => [p.staff_id, p.concedido]));

  return (staff ?? [])
    .filter((s: { id: string; role: string }) => (ind.has(s.id) ? ind.get(s.id) : roles.has(s.role)))
    .map((s: { id: string }) => s.id);
}

function recortar(txt: string, max: number): string {
  return txt.length > max ? txt.slice(0, max - 1) + "…" : txt;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!RESEND_WEBHOOK_SECRET) return new Response("Falta RESEND_WEBHOOK_SECRET", { status: 500 });

  const body = await req.text();
  if (!(await firmaValida(body, req, RESEND_WEBHOOK_SECRET))) {
    return new Response("Firma inválida", { status: 401 });
  }

  let evento: any;
  try { evento = JSON.parse(body); } catch { return new Response("JSON inválido", { status: 400 }); }

  const rebote = evento?.type === "email.bounced";
  const spam = evento?.type === "email.complained";
  if (!rebote && !spam) return new Response("Evento ignorado", { status: 200 });

  try {
    const d = evento.data ?? {};
    const para = Array.isArray(d.to) ? d.to.join(", ") : String(d.to ?? "destinatario desconocido");
    const asunto = d.subject ? String(d.subject) : "sin asunto";
    const motivo = rebote && d.bounce?.message ? ` Motivo: ${d.bounce.message}` : "";

    const titulo = rebote ? "Correo rebotado" : "Correo marcado como spam";
    const mensaje = recortar(
      rebote
        ? `No se pudo entregar a ${para} (${asunto}).${motivo} Revisá el correo del pasajero.`
        : `${para} marcó como spam el correo "${asunto}".`,
      400,
    );

    const ids = await destinatarios();
    if (ids.length === 0) return new Response(JSON.stringify({ avisados: 0 }), { status: 200 });

    // Bandeja
    const { error: bErr } = await supabase.from("notificaciones_bandeja").insert(
      ids.map((staff_id) => ({ staff_id, tipo: "correo", titulo, mensaje })),
    );
    if (bErr) console.error("bandeja", bErr);

    // Push
    const { data: tokens } = await supabase.from("push_tokens").select("token").in("staff_id", ids);
    let pushEnviados = 0;
    const invalidos: string[] = [];

    if (tokens && tokens.length > 0) {
      const projectId = JSON.parse(FIREBASE_SERVICE_ACCOUNT).project_id;
      const accessToken = await getAccessToken();

      const results = await Promise.allSettled(
        tokens.map((t: { token: string }) =>
          fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token: t.token,
                android: { priority: "high", ttl: "43200s" },
                data: {
                  title: `⚠️ ${titulo}`,
                  body: mensaje,
                  icon: "/icons/guaranitour_192.png",
                  link: "/?goto=notificaciones",
                },
              },
            }),
          })
        ),
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status !== "fulfilled") continue;
        pushEnviados++;
        const res = await r.value.json().catch(() => null);
        if (res?.error?.status === "NOT_FOUND" || res?.error?.status === "INVALID_ARGUMENT") {
          invalidos.push(tokens[i].token);
        }
      }
    }

    if (invalidos.length > 0) await supabase.from("push_tokens").delete().in("token", invalidos);

    return new Response(JSON.stringify({ avisados: ids.length, push_enviados: pushEnviados }), { status: 200 });
  } catch (err) {
    // 500 → Resend reintenta el webhook
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
