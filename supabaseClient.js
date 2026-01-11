
// Supabase Client Helper
const SUPABASE_URL = 'https://yebnxarysefnqkpevoze.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3jP-OhK1UJYZQtxti4hFeg_UZ7FU8Ai';

// Initialize Supabase
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("Supabase Client Initialized");
window.supabaseClient = client;
