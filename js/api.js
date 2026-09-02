// ============================================================
// api.js - Capa de acceso a datos (Supabase)
// ============================================================
// Reemplaza los endpoints AppScript (apiGetTrips, apiGetSeats,
// apiReserve, etc.) del prototipo original.

const Api = {

  /** Lista de viajes activos, con sus plantas. */
  async getViajes() {
    const { data, error } = await supabase
      .from('viajes')
      .select('id, nombre, tipo, start_at, plantas(id, etiqueta, orden)')
      .eq('activo', true)
      .order('start_at', { ascending: true, nullsFirst: false });

    if (error) throw error;

    // Ordenar plantas dentro de cada viaje
    (data || []).forEach(v => {
      if (Array.isArray(v.plantas)) {
        v.plantas.sort((a, b) => (a.orden || 0) - (b.orden || 0));
      }
    });
    return data || [];
  },

  /** Todos los asientos de una planta (sin datos de pasajero: ya no viven aca). */
  async getAsientosByPlanta(plantaId) {
    const { data, error } = await supabase
      .from('asientos')
      .select('id, code, fila, letra, estado')
      .eq('planta_id', plantaId)
      .order('fila', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * Reserva uno o varios asientos de forma atomica.
   * pares: [{ code, pasajero, ci }, ...]
   */
  async reservarAsientos(plantaId, pares) {
    const { error } = await supabase.rpc('reservar_asientos', {
      p_planta_id: plantaId,
      p_pares: pares.map(p => ({ code: p.code, pasajero: p.pasajero, ci: p.ci }))
    });
    if (error) throw error;
  },

  /** Suscribe a cambios en tiempo real de los asientos de una planta. */
  subscribeToPlanta(plantaId, onChange) {
    const channel = supabase
      .channel('asientos-planta-' + plantaId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'reservas', table: 'asientos', filter: 'planta_id=eq.' + plantaId },
        function (payload) {
          console.log('[Realtime] Evento recibido:', payload); // TEMP: quitar luego del diagnostico
          onChange(payload);
        }
      )
      .subscribe(function (status, err) {
        console.log('[Realtime] Estado de la suscripcion:', status, err || ''); // TEMP: quitar luego del diagnostico
      });
    return channel;
  },

  /**
   * Busca pasajeros ya cargados en la base de clientes (public.pasajeros)
   * para autocompletar el formulario de reserva cuando el staff está
   * logueado. Depende 100% de RLS: la tabla solo es visible para
   * auth.email() presente en staff con status 'enabled' — no filtramos
   * nada acá, Postgres ya lo hace. Si quien llama no es staff válido,
   * simplemente vuelve una lista vacía (o error de permiso), nunca datos.
   *
   * No se llama nunca si Auth.isAuthorized() es false: el input de
   * autocomplete ni siquiera se muestra a un visitante anónimo.
   */
  async buscarPasajeros(query) {
    const q = (query || '').trim();
    if (q.length < 3) return []; // evita ida y vuelta por cada tecla + scrape letra a letra

    const { data, error } = await supabase
      .schema('public')
      .from('pasajeros')
      .select('"Pasajero", "Documento de Identidad"') // comillas dobles obligatorias: PostgREST
                                                        // recorta espacios de nombres de columna
                                                        // si no van entre comillas dentro del string
      .ilike('Pasajero', `%${q}%`)
      .limit(8);

    if (error) {
      console.error('[buscarPasajeros]', error);
      return []; // fallo silencioso: el autocomplete es una ayuda, no algo crítico
    }
    return data || [];
  },

  /**
   * Inserta una aceptación de Bases y Condiciones (tabla pública
   * "basesycondiciones", la misma que usa el Apps Script del Sheet).
   * "estado" se marca "aceptado" directo al insertar: antes lo completaba
   * Apps Script junto con el resto de la fila, pero ahora esa columna
   * depende de la web en el momento de la aceptación. "estado_envio"
   * queda en null porque el PDF/email lo sigue completando un proceso
   * aparte más adelante.
   */
  async aceptarBasesYCondiciones({ nombre, ci, email_disponible, email }) {
    const { error } = await supabase
      .schema('public')
      .from('basesycondiciones')
      .insert({
        nombre,
        ci,
        email_disponible,
        email: email || null,
        estado: 'aceptado',
        estado_envio: null,
        correo_duplicado: false,
        link: null
      });

    if (error) throw error;
  },

  /**
   * Inserta la información adicional del Paso 2 del wizard de Bases y
   * Condiciones (tabla "reservas.bases_info_adicional"): cumpleaños
   * (opcional) y contacto de emergencia. Vinculada a basesycondiciones
   * por CI, no por id — mismo criterio que se usó para esa tabla.
   */
  async guardarInfoAdicional({ ci, cumpleanos, contacto_emergencia_nombre, contacto_emergencia_telefono, contacto_emergencia_parentesco }) {
    const { error } = await supabase
      .schema('reservas')
      .from('bases_info_adicional')
      .insert({
        ci,
        cumpleanos: cumpleanos || null, // 'YYYY-MM-DD' con año fijo 2000, o null si no la cargó
        contacto_emergencia_nombre,
        contacto_emergencia_telefono,
        contacto_emergencia_parentesco
      });

    if (error) throw error;
  }
};

window.Api = Api;
