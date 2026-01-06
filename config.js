// /config.js — version navigateur (site statique)
// Dépend de la présence de la librairie supabase-js chargée par <script src="..."></script>

const SUPABASE_URL = "https://isrxjzaphaciwdaxbylt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzcnhqemFwaGFjaXdkYXhieWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2ODI5NDAsImV4cCI6MjA4MzI1ODk0MH0.mPkEHEETgb4DMi4_LGQRkzIVlz6QoaLNvt6BXXSGoZQ";

// Le SDK expose window.supabase
// On crée un client accessible globalement
window.ghostopsSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
