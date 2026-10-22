// supabase/functions/notify-new-passenger/index.ts
//
// Se dispara vía Database Webhook cuando se INSERTA una fila en
// `viaje_pasajeros` (registro de un pasajero en un viaje).
// El INSERT solo trae viaje_id y pasajero_id, así que primero
// consultamos `viajes` y `pasajeros` para armar el texto, y después
// mandamos la notificación FCM a todos los tokens registrados.

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

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const registro = payload.record; // fila insertada en viaje_pasajeros

    if (!registro || !registro.viaje_id || !registro.pasajero_id) {
      return new Response(
        JSON.stringify({ error: "Payload incompleto (falta viaje_id o pasajero_id)" }),
        { status: 400 }
      );
    }

    // 1. Traer nombre del viaje y nombre del pasajero en paralelo
    const [{ data: viaje, error: viajeError }, { data: pasajero, error: pasajeroError }] =
      await Promise.all([
        supabase.from("viajes").select("nombre").eq("id", registro.viaje_id).single(),
        supabase.from("pasajeros").select("Pasajero").eq("id", registro.pasajero_id).single(),
      ]);

    if (viajeError) throw viajeError;
    if (pasajeroError) throw pasajeroError;

    // 2. Traer todos los tokens registrados, excluyendo a los del rol
    //    "finanzas" — esta notificación puntual (nuevo pasajero) no le
    //    es relevante a ese rol. "staff!inner(...)" fuerza un inner join
    //    real contra staff (vía push_tokens.staff_id): sin el !inner,
    //    PostgREST no garantiza aplicar el filtro sobre una relación
    //    embebida de forma confiable. Si el FK no se llama exactamente
    //    "staff" en tu esquema, Supabase puede pedir el nombre explícito
    //    de la relación/constraint acá (ej. "staff!push_tokens_staff_id_fkey").
    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token, staff!inner(role)")
      .neq("staff.role", "finanzas");

    if (tokensError) throw tokensError;
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ message: "No hay tokens registrados" }), { status: 200 });
    }

    // 3. Armar el mensaje
    const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    const projectId = sa.project_id;
    const accessToken = await getAccessToken();

    const nombrePasajero = pasajero?.Pasajero || "Un pasajero";
    const nombreViaje = viaje?.nombre || "un viaje";

    const titulo = "🙋 Nuevo pasajero registrado";
    const cuerpo = `${nombrePasajero} - ${nombreViaje}`;

    // 4. Enviar a cada token (data-only, para que solo el Service Worker
    // muestre la notificación y no aparezca duplicada)
    const results = await Promise.allSettled(
      tokens.map((t: { token: string; staff: { role: string } }) =>
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
                // "priority: high" es necesario para mensajes data-only en
                // Android: sin esto, FCM usa prioridad normal por default,
                // y el sistema puede posponer la entrega indefinidamente
                // mientras el dispositivo está en Doze/App Standby (ej. sin
                // señal). Con high priority, FCM entrega apenas el
                // dispositivo reconecta, en vez de esperar a que despierte
                // por otro motivo.
                // ttl: 24h — cuánto tiempo FCM sigue intentando entregar si
                // el dispositivo está offline, antes de descartar el
                // mensaje. Sin esto, el default es 4 semanas; 24h es más
                // razonable para un aviso de "nuevo pasajero" que pierde
                // sentido si se entrega demasiado tarde.
                android: {
                  priority: "high",
                  ttl: "86400s",
                },
                // Links desde la raíz del dominio propio (app.guaranitour.com),
                // sin el prefijo /Guarani-tour-APP/ de GitHub Pages. Se usa
                // ?goto= porque Android ignora el hash al abrir desde una
                // notificación.
                data: {
                  title: titulo,
                  body: cuerpo,
                  icon: "/icons/guaranitour_192.png",
                  link: `/?goto=viaje-detalle&idx=${registro.viaje_id}`,
                },
              },
            }),
          }
        )
      )
    );

    // 5. Revisar la respuesta de FCM de cada envío y limpiar tokens inválidos.
    //    Antes los errores de FCM se ignoraban en silencio; ahora se loguean
    //    y se cuentan los envíos realmente aceptados por FCM.
    const invalidTokens: string[] = [];
    let aceptados = 0;
    const fallos: { token: string; http: number | null; status?: string; message?: string }[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const tk = tokens[i].token.slice(0, 12);
      if (r.status !== "fulfilled") {
        console.error("FCM fetch falló", tk, String(r.reason));
        fallos.push({ token: tk, http: null, message: String(r.reason) });
        continue;
      }
      const body = await r.value.json().catch(() => null);
      if (r.value.ok) {
        aceptados++;
        continue;
      }
      const status = body?.error?.status;
      const detalle = body?.error?.details?.find?.((d: { errorCode?: string }) => d.errorCode)?.errorCode;
      console.error("FCM rechazó el envío", tk, r.value.status, status, detalle, body?.error?.message);
      fallos.push({ token: tk, http: r.value.status, status: detalle || status, message: body?.error?.message });
      if (status === "NOT_FOUND" || status === "INVALID_ARGUMENT" || detalle === "UNREGISTERED") {
        invalidTokens.push(tokens[i].token);
      }
    }
    if (invalidTokens.length > 0) {
      await supabase.from("push_tokens").delete().in("token", invalidTokens);
    }

    return new Response(
      JSON.stringify({
        enviados: tokens.length,
        aceptados,
        invalidos_eliminados: invalidTokens.length,
        fallos,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
