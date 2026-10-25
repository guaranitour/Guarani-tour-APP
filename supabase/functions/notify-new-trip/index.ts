// supabase/functions/notify-new-trip/index.ts
//
// Se dispara vía Database Webhook cuando se INSERTA una fila en `viajes`.
// Junta todos los tokens de push_tokens y les manda una notificación FCM
// usando la Service Account de Firebase (guardada como secret).

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

function formatFecha(fechaIso: string | null): string {
  if (!fechaIso) return "";
  const d = new Date(fechaIso);
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const viaje = payload.record; // fila insertada en `viajes`

    if (!viaje) {
      return new Response(JSON.stringify({ error: "Sin record en el payload" }), { status: 400 });
    }

    // 1. Traer todos los tokens registrados
    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token");

    if (tokensError) throw tokensError;
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ message: "No hay tokens registrados" }), { status: 200 });
    }

    // 2. Armar el mensaje
    const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    const projectId = sa.project_id;
    const accessToken = await getAccessToken();

    const titulo = "🚌 ¡Nuevo viaje disponible!";
    const cuerpo = `${viaje.nombre} — sale ${formatFecha(viaje.fecha_salida)} ✨`;
    const imagen = viaje.imagen_url || undefined;

    // 3. Enviar a cada token (FCM v1 no soporta multicast nativo, se manda 1 a 1)
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
                // ttl 3 días: un "nuevo viaje disponible" sigue siendo relevante
                // más tiempo que un aviso puntual de pasajero.
                // notification: la APK (Capacitor) no tiene service worker; sin
                // este bloque no muestra nada con la app cerrada. Los tokens web
                // (PWA) lo ignoran y la notificación la muestra el SW con "data".
                android: {
                  priority: "high",
                  ttl: "259200s",
                  notification: {
                    title: titulo,
                    body: cuerpo,
                    ...(imagen ? { image: imagen } : {}),
                  },
                },
                // Los links van desde la raíz del dominio propio
                // (app.guaranitour.com). Se usa ?goto= porque Android ignora el
                // hash al abrir desde una notificación.
                data: {
                  title: titulo,
                  body: cuerpo,
                  ...(imagen ? { image: imagen } : {}),
                  icon: "/icons/guaranitour_192.png",
                  link: "/?goto=viajes",
                },
              },
            }),
          }
        )
      )
    );

    // 4. Limpiar tokens inválidos (dispositivos desinstalados, etc.)
    const invalidTokens: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        const body = await r.value.json().catch(() => null);
        if (body?.error?.status === "NOT_FOUND" || body?.error?.status === "INVALID_ARGUMENT") {
          invalidTokens.push(tokens[i].token);
        }
      }
    }
    if (invalidTokens.length > 0) {
      await supabase.from("push_tokens").delete().in("token", invalidTokens);
    }

    return new Response(
      JSON.stringify({ enviados: tokens.length, invalidos_eliminados: invalidTokens.length }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
