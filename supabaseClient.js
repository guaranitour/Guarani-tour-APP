const SUPABASE_URL = "https://pmxwpmxiemhbeliywhpj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBteHdwbXhpZW1oYmVsaXl3aHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDEwOTQsImV4cCI6MjA5MzU3NzA5NH0.Jhsdv_kh4JbmEh2ZmMvGqPNGjg1dYNXsYBtUyvnshxg";

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);