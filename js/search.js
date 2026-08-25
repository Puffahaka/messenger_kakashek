import { supabase } from './supabaseClient.js';
import { currentUser, normalizeTag } from './auth.js';

/**
 * Поиск пользователей по тегу (@tag) или имени
 */
export async function searchUsers(query) {
  if (!query || !query.trim()) return [];

  const cleanQuery = normalizeTag(query);
  if (!cleanQuery) return [];

  try {
    // Ищем по частичному совпадению тега или имени
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .or(`username.ilike.%${cleanQuery}%,display_name.ilike.%${cleanQuery}%`)
      .limit(10);

    if (error) {
      console.error('Search error:', error);
      return [];
    }

    // Исключаем текущего пользователя из списка результатов
    const currentUserId = currentUser?.id;
    return (data || []).filter(user => user.id !== currentUserId);
  } catch (err) {
    console.error('Search exception:', err);
    return [];
  }
}
