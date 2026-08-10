const SUPABASE_URL = "https://pmxwpmxiemhbeliywhpj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBteHdwbXhpZW1oYmVsaXl3aHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDEwOTQsImV4cCI6MjA5MzU3NzA5NH0.Jhsdv_kh4JbmEh2ZmMvGqPNGjg1dYNXsYBtUyvnshxg";

const { createClient } = supabase;

// storageKey: por defecto Supabase guarda la sesión en localStorage bajo
// una clave fija ("sb-<project-ref>-auth-token"). Guarani Tour App
// (app.guaranitour.com) y Selección de Asientos (dominio propio) usan
// el MISMO proyecto Supabase. Aunque hoy viven en dominios distintos
// (localStorage ya no se comparte entre ellos), se mantiene esta
// storageKey propia por si en el futuro comparten dominio o subdominio,
// y para que cada app tenga una sesión explícitamente independiente.
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'sb-guaranitour-auth-token' }
});