// supabase/functions/notify-birthdays/index.ts
//
// Se dispara vía pg_cron (job diario, ver SQL de configuración) en vez
// de un Database Webhook, porque no reacciona a un INSERT sino a una
// condición de fecha: "hoy es el cumpleaños de algún pasajero".
//
// Cada ejecución consulta `pasajeros` buscando coincidencias de
// mes/día en "Fecha de nacimiento" contra la fecha actual, y por cada
// pasajero encontrado manda una notificación FCM a todos los tokens
// registrados en `push_tokens` (mismo patrón que notify-new-passenger).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

  const jwt = `${unsigned}.${sigB64}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
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

Deno.serve(async (_req) => {
  try {
    // 1. Buscar pasajeros cuyo cumpleaños (mes/día) coincide con hoy.
    //    Se filtra en SQL vía RPC para no traer toda la tabla y
    //    comparar en JS (evita problemas de timezone/parsing en Deno).
    const { data: cumpleañeros, error: rpcError } = await supabase.rpc(
      "pasajeros_cumpleanos_hoy"
    );

    if (rpcError) throw rpcError;

    if (!cumpleañeros || cumpleañeros.length === 0) {
      return new Response(
        JSON.stringify({ message: "No hay cumpleaños hoy" }),
        { status: 200 }
      );
    }

    // 2. Traer todos los tokens registrados
    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token");

    if (tokensError) throw tokensError;
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ message: "No hay tokens registrados" }), { status: 200 });
    }

    // 3. Preparar credenciales FCM (una sola vez para todos los envíos)
    const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    const projectId = sa.project_id;
    const accessToken = await getAccessToken();

    let totalEnviados = 0;
    const invalidTokens = new Set<string>();

    // 4. Por cada pasajero de cumpleaños, notificar a todos los tokens
    for (const pasajero of cumpleañeros as { id: number; Pasajero: string }[]) {
      const titulo = "🎂 Cumpleaños de pasajero";
      const cuerpo = `Hoy es el cumpleaños de ${pasajero.Pasajero || "un pasajero"}`;

      const results = await Promise.allSettled(
        tokens.map((t: { token: string }) =>
          fetch(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                message: {
                  token: t.token,
                  // priority high: evita que Doze/App Standby posponga la entrega.
                  // ttl 12h: el cron corre 1 vez al día, no tiene sentido que FCM
                  // reintente por días.
                  // notification: la APK (Capacitor) no tiene service worker; sin
                  // este bloque no muestra nada con la app cerrada. Los tokens web
                  // (PWA) lo ignoran y la notificación la muestra el SW con "data".
                  android: {
                    priority: "high",
                    ttl: "43200s",
                    notification: { title: titulo, body: cuerpo },
                  },
                  // Link desde la raíz del dominio propio (app.guaranitour.com).
                  // La vista de detalle de pasajero es "detalle" y el id va en idx.
                  data: {
                    title: titulo,
                    body: cuerpo,
                    icon: "/icons/guaranitour_192.png",
                    link: `/?goto=detalle&idx=${pasajero.id}`,
                  },
                },
              }),
            }
          )
        )
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          totalEnviados++;
          const body = await r.value.json().catch(() => null);
          if (body?.error?.status === "NOT_FOUND" || body?.error?.status === "INVALID_ARGUMENT") {
            invalidTokens.add(tokens[i].token);
          }
        }
      }
    }

    // 5. Limpiar tokens inválidos (una sola vez al final)
    if (invalidTokens.size > 0) {
      await supabase.from("push_tokens").delete().in("token", Array.from(invalidTokens));
    }

    return new Response(
      JSON.stringify({
        cumpleañeros_hoy: cumpleañeros.length,
        notificaciones_enviadas: totalEnviados,
        invalidos_eliminados: invalidTokens.size,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
