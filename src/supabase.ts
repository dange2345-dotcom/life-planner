import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from './config'

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Вход только по паролю: ссылки из писем на iOS открываются в Safari, а не в приложении.
        detectSessionInUrl: false,
      },
    })
  : null
