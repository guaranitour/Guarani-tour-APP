// supabase/functions/send-notifications/index.ts
//
// Procesa las notificaciones (recordatorios / consejos) vencidas:
//   · activa = true y proxima_ejecucion <= now()
//   · resuelve los destinatarios (todos / por rol / personas)
//   · guarda una fila en notificaciones_bandeja por destinatario
//   · manda el push FCM data-only a sus tokens (mismo patrón que notify-birthdays)
//   · reprograma (diaria / semanal / mensual) o desactiva (única)
//
// La invoca pg_cron cada 5 minutos y el cliente al crear una notificación
// inmediata. Antes de enviar "reclama" la fila con un UPDATE condicionado a
// proxima_ejecucion, así dos invocaciones simultáneas no la mandan dos veces.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PREFIJO_TIPO: Record<string, string> = {
  recordatorio: "⏰",
  consejo: "💡",
};

// --- Genera un access token OAuth2 a partir de la Service Account ---
async function getAccessToken(): Promise<string> {
  const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const unsigned = `${enc(header)}.${enc(claimSet)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

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
  if (!data.access_token) {
    throw new Error("No se pudo obtener access_token: " + JSON.stringify(data));
  }
  return data.access_token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Próxima fecha de una notificación recurrente, siempre en el futuro
// (si el cron estuvo caído no se "recuperan" los envíos perdidos).
function siguienteEjecucion(desde: Date, frecuencia: string): Date | null {
  const avanzar = (d: Date) => {
    const n = new Date(d);
    if (frecuencia === "diaria") n.setUTCDate(n.getUTCDate() + 1);
    else if (frecuencia === "semanal") n.setUTCDate(n.getUTCDate() + 7);
    else if (frecuencia === "mensual") {
      // Se conserva el día original; si el mes no lo tiene, queda en el último día
      const dia = n.getUTCDate();
      n.setUTCDate(1);
      n.setUTCMonth(n.getUTCMonth() + 1);
      const ultimo = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
      n.setUTCDate(Math.min(dia, ultimo));
    } else return null;
    return n;
  };

  let next = avanzar(desde);
  const ahora = new Date();
  while (next && next <= ahora) next = avanzar(next);
  return next;
}

type Notificacion = {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  destino: "todos" | "roles" | "usuarios";
  roles: string[];
  staff_ids: string[];
  frecuencia: string;
  proxima_ejecucion: string;
  termina_en: string | null;
};

Deno.serve(async (_req) => {
  try {
    const ahora = new Date();

    const { data: vencidas, error } = await supabase
      .from("notificaciones")
      .select("id, tipo, titulo, mensaje, destino, roles, staff_ids, frecuencia, proxima_ejecucion, termina_en")
      .eq("activa", true)
      .lte("proxima_ejecucion", ahora.toISOString())
      .order("proxima_ejecucion", { ascending: true })
      .limit(50);

    if (error) throw error;
    if (!vencidas || vencidas.length === 0) {
      return new Response(JSON.stringify({ procesadas: 0 }), { status: 200 });
    }

    // Credenciales FCM una sola vez
    const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    const projectId = sa.project_id;
    let accessToken: string | null = null;

    let procesadas = 0;
    let pushEnviados = 0;
    const invalidTokens = new Set<string>();

    for (const n of vencidas as Notificacion[]) {
      // 1) Reclamar: reprogramar / desactivar solo si nadie la tomó antes
      const programada = new Date(n.proxima_ejecucion);
      const siguiente = n.frecuencia === "unica" ? null : siguienteEjecucion(programada, n.frecuencia);
      const hayOtra = !!siguiente && (!n.termina_en || siguiente <= new Date(n.termina_en));

      const { data: reclamada } = await supabase
        .from("notificaciones")
        .update({
          ultimo_envio: ahora.toISOString(),
          proxima_ejecucion: hayOtra ? siguiente!.toISOString() : null,
          activa: hayOtra,
          updated_at: ahora.toISOString(),
        })
        .eq("id", n.id)
        .eq("activa", true)
        .eq("proxima_ejecucion", n.proxima_ejecucion)
        .select("id");

      if (!reclamada || reclamada.length === 0) continue;

      // 2) Destinatarios
      let q = supabase.from("staff").select("id, role").eq("status", "enabled");
      if (n.destino === "roles") q = q.in("role", n.roles?.length ? n.roles : ["__ninguno__"]);
      if (n.destino === "usuarios") {
        q = q.in("id", n.staff_ids?.length ? n.staff_ids : ["00000000-0000-0000-0000-000000000000"]);
      }
      const { data: destinatarios, error: dErr } = await q;
      if (dErr) { console.error("destinatarios", n.id, dErr); continue; }
      if (!destinatarios || destinatarios.length === 0) { procesadas++; continue; }

      // 3) Bandeja
      const { error: bErr } = await supabase.from("notificaciones_bandeja").insert(
        destinatarios.map((s: { id: string }) => ({
          notificacion_id: n.id,
          staff_id: s.id,
          tipo: n.tipo,
          titulo: n.titulo,
          mensaje: n.mensaje,
        }))
      );
      if (bErr) console.error("bandeja", n.id, bErr);

      // 4) Push
      const { data: tokens } = await supabase
        .from("push_tokens")
        .select("token")
        .in("staff_id", destinatarios.map((s: { id: string }) => s.id));

      if (tokens && tokens.length > 0) {
        accessToken ??= await getAccessToken();
        const titulo = `${PREFIJO_TIPO[n.tipo] ?? ""} ${n.titulo}`.trim();

        const results = await Promise.allSettled(
          tokens.map((t: { token: string }) =>
            fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                message: {
                  token: t.token,
                  // data-only + prioridad alta: llega aunque el equipo esté en Doze
                  android: { priority: "high", ttl: "43200s" },
                  data: {
                    title: titulo,
                    body: n.mensaje,
                    icon: "/icons/guaranitour_192.png",
                    link: "/?goto=notificaciones",
                  },
                },
              }),
            })
          )
        );

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status !== "fulfilled") continue;
          pushEnviados++;
          const body = await r.value.json().catch(() => null);
          if (body?.error?.status === "NOT_FOUND" || body?.error?.status === "INVALID_ARGUMENT") {
            invalidTokens.add(tokens[i].token);
          }
        }
      }

      procesadas++;
    }

    if (invalidTokens.size > 0) {
      await supabase.from("push_tokens").delete().in("token", Array.from(invalidTokens));
    }

    return new Response(
      JSON.stringify({ procesadas, push_enviados: pushEnviados, invalidos_eliminados: invalidTokens.size }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
