import { supabase } from './supabaseClient.js';
import { currentProfile, isAdmin } from './auth.js';

/**
 * Получить общую статистику
 */
export async function getAdminStats() {
  if (!isAdmin(currentProfile?.username)) {
    throw new Error('Доступ запрещен: требуется статус администратора');
  }

  const [usersRes, convsRes, msgsRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('conversations').select('id', { count: 'exact', head: true }),
    supabase.from('messages').select('id', { count: 'exact', head: true })
  ]);

  return {
    totalUsers: usersRes.count || 0,
    totalConversations: convsRes.count || 0,
    totalMessages: msgsRes.count || 0
  };
}

/**
 * Получить всех пользователей системы
 */
export async function getAllUsers() {
  if (!isAdmin(currentProfile?.username)) {
    throw new Error('Доступ запрещен');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Получить последние сообщения во всех чатах
 */
export async function getAllRecentMessages(limit = 100) {
  if (!isAdmin(currentProfile?.username)) {
    throw new Error('Доступ запрещен');
  }

  const { data, error } = await supabase
    .from('messages')
    .select(`
      id,
      conversation_id,
      sender_id,
      content,
      created_at,
      profiles:sender_id (
        id,
        username,
        display_name,
        avatar_url
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Удалить сообщение
 */
export async function adminDeleteMessage(messageId) {
  if (!isAdmin(currentProfile?.username)) {
    throw new Error('Доступ запрещен');
  }

  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);

  if (error) throw error;
  return true;
}

/**
 * Забанить / разбанить пользователя
 */
export async function adminBanUser(userId, isBanned) {
  if (!isAdmin(currentProfile?.username)) {
    throw new Error('Доступ запрещен');
  }

  const { error } = await supabase
    .from('profiles')
    .update({ 
      is_banned: isBanned,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (error) throw error;
  return true;
}

/**
 * Выдать мут пользователю на N минут
 */
export async function adminMuteUser(userId, durationMinutes) {
  if (!isAdmin(currentProfile?.username)) {
    throw new Error('Доступ запрещен');
  }

  const mutedUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('profiles')
    .update({ 
      muted_until: mutedUntil,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (error) throw error;
  return mutedUntil;
}

/**
 * Снять мут с пользователя
 */
export async function adminUnmuteUser(userId) {
  if (!isAdmin(currentProfile?.username)) {
    throw new Error('Доступ запрещен');
  }

  const { error } = await supabase
    .from('profiles')
    .update({ 
      muted_until: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (error) throw error;
  return true;
}

