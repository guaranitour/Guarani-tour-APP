const SUPABASE_URL = "https://pmxwpmxiemhbeliywhpj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBteHdwbXhpZW1oYmVsaXl3aHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDEwOTQsImV4cCI6MjA5MzU3NzA5NH0.Jhsdv_kh4JbmEh2ZmMvGqPNGjg1dYNXsYBtUyvnshxg";

const { createClient } = supabase;

// storageKey: por defecto Supabase guarda la sesión en localStorage bajo
// una clave fija ("sb-<project-ref>-auth-token"). Como Guarani Tour App
// y Selección de Asientos viven en el mismo dominio (guaranitour.github.io)
// y usan el MISMO proyecto Supabase, sin esto ambas apps pisan la misma
// entrada de localStorage y se invalidan la sesión mutuamente. Con una
// storageKey propia y distinta en cada app, cada una tiene su sesión
// completamente independiente, aunque compartan dominio y proyecto.
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'sb-guaranitour-auth-token' }
});