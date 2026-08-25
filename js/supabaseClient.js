import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

if (!window.supabase) {
  console.error('Supabase library is not loaded. Please make sure @supabase/supabase-js CDN is included.');
}

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
