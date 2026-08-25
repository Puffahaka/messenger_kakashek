import { supabase } from './supabaseClient.js';
import { currentUser, currentProfile } from './auth.js';

let activeMessageSubscription = null;
let globalChangesSubscription = null;

/**
 * Получить или создать диалог 1-на-1 с пользователем
 */
export async function getOrCreateConversation(targetUserId) {
  if (!currentUser) throw new Error('Пользователь не авторизован');
  if (currentUser.id === targetUserId) throw new Error('Нельзя создать чат с самим собой');

  // 1. Попытка вызвать хранимую функцию (RPC)
  try {
    const { data: convId, error: rpcError } = await supabase.rpc('get_or_create_direct_conversation', {
      target_user_id: targetUserId
    });
    if (!rpcError && convId) {
      return convId;
    }
  } catch (e) {
    console.warn('RPC unavailable, falling back to direct query:', e);
  }

  // 2. Fallback: поиск через прямые запросы
  const { data: myMemberships } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', currentUser.id);

  if (myMemberships && myMemberships.length > 0) {
    const myConvIds = myMemberships.map(m => m.conversation_id);
    const { data: match } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .in('conversation_id', myConvIds)
      .eq('user_id', targetUserId)
      .limit(1)
      .maybeSingle();

    if (match) {
      return match.conversation_id;
    }
  }

  // 3. Создаем новый диалог
  const { data: newConv, error: convError } = await supabase
    .from('conversations')
    .insert({ created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('id')
    .single();

  if (convError) {
    console.error('Error creating conversation:', convError);
    throw new Error(convError.message || 'Ошибка создания диалога');
  }

  const convId = newConv.id;

  // Добавляем обоих участников
  const { error: membersError } = await supabase
    .from('conversation_members')
    .insert([
      { conversation_id: convId, user_id: currentUser.id },
      { conversation_id: convId, user_id: targetUserId }
    ]);

  if (membersError) {
    console.error('Error adding members:', membersError);
    throw new Error(membersError.message || 'Ошибка добавления участников в чат');
  }

  return convId;
}

/**
 * Получить список всех диалогов текущего пользователя с превью (из постоянной базы данных)
 */
export async function fetchConversations() {
  if (!currentUser) return [];

  try {
    // 1. Получаем список всех ID диалогов, где состоит текущий пользователь
    const { data: myMemberships, error: mError } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', currentUser.id);

    if (mError || !myMemberships || myMemberships.length === 0) {
      return [];
    }

    const convIds = myMemberships.map(m => m.conversation_id);

    // 2. Получаем ID собеседников во всех этих диалогах
    const { data: partnerMembers, error: pmError } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', convIds)
      .neq('user_id', currentUser.id);

    if (pmError || !partnerMembers || partnerMembers.length === 0) {
      return [];
    }

    const partnerUserIds = [...new Set(partnerMembers.map(p => p.user_id))];

    // 3. Загружаем профили всех собеседников
    const { data: profiles, error: pError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', partnerUserIds);

    const profilesMap = new Map();
    if (profiles) {
      profiles.forEach(p => profilesMap.set(p.id, p));
    }

    // 4. Загружаем последнее сообщение для каждого диалога
    const { data: messages } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_id, content, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });

    // 5. Собираем единый список диалогов
    const conversationsMap = new Map();

    partnerMembers.forEach(item => {
      const convId = item.conversation_id;
      const partnerProfile = profilesMap.get(item.user_id) || {
        id: item.user_id,
        username: 'user',
        display_name: 'Собеседник',
        avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${item.user_id}`
      };

      if (!conversationsMap.has(convId)) {
        conversationsMap.set(convId, {
          id: convId,
          partner: partnerProfile,
          lastMessage: null,
          updatedAt: null
        });
      }
    });

    if (messages) {
      messages.forEach(msg => {
        const conv = conversationsMap.get(msg.conversation_id);
        if (conv && !conv.lastMessage) {
          conv.lastMessage = msg;
          conv.updatedAt = msg.created_at;
        }
      });
    }

    const list = Array.from(conversationsMap.values());
    list.sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return timeB - timeA;
    });

    return list;
  } catch (err) {
    console.error('Exception fetching conversations:', err);
    return [];
  }
}

/**
 * Загрузить историю сообщений диалога прямо из таблицы messages в PostgreSQL
 */
export async function fetchMessages(conversationId) {
  if (!conversationId) return [];

  try {
    // 1. Загружаем сообщения из постоянной таблицы messages
    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_id, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('Error loading messages from database:', error);
      return [];
    }

    if (!messages || messages.length === 0) return [];

    // 2. Получаем профили авторов сообщений
    const senderIds = [...new Set(messages.map(m => m.sender_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', senderIds);

    const profilesMap = new Map();
    if (profiles) {
      profiles.forEach(p => profilesMap.set(p.id, p));
    }

    // 3. Добавляем данные профилей к сообщениям
    return messages.map(m => ({
      ...m,
      profiles: profilesMap.get(m.sender_id) || {
        id: m.sender_id,
        username: 'user',
        display_name: 'Пользователь',
        avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${m.sender_id}`
      }
    }));
  } catch (err) {
    console.error('Exception loading messages:', err);
    return [];
  }
}

/**
 * Отправить и перманентно сохранить сообщение в базу данных
 */
export async function sendMessage(conversationId, content) {
  if (!currentUser) throw new Error('Не авторизован');
  
  if (currentProfile?.is_banned) {
    throw new Error('Ваш аккаунт заблокирован администратором.');
  }

  if (currentProfile?.muted_until) {
    const mutedDate = new Date(currentProfile.muted_until);
    if (mutedDate > new Date()) {
      const formatted = mutedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + mutedDate.toLocaleDateString() + ')';
      throw new Error(`Вам выдан мут до ${formatted}. Вы не можете отправлять сообщения.`);
    }
  }

  if (!content || !content.trim()) return null;

  const text = content.trim();

  // Сохраняем в таблицу messages в базе данных PostgreSQL
  const { data: insertedMsg, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: currentUser.id,
      content: text
    })
    .select('id, conversation_id, sender_id, content, created_at')
    .single();

  if (error) {
    console.error('Error inserting message into database:', error);
    throw new Error(error.message || 'Ошибка сохранения сообщения в базу данных');
  }

  // Прикрепляем профиль текущего пользователя
  insertedMsg.profiles = {
    id: currentUser.id,
    username: currentProfile?.username || 'user',
    display_name: currentProfile?.display_name || currentProfile?.username || 'Я',
    avatar_url: currentProfile?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.id}`
  };

  // Обновляем время диалога в базе
  try {
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  } catch (e) {
    // Non-critical
  }

  return insertedMsg;
}

/**
 * Realtime-подписка на сообщения активного чата
 */
export function subscribeToActiveConversation(conversationId, onMessageReceived) {
  if (activeMessageSubscription) {
    supabase.removeChannel(activeMessageSubscription);
    activeMessageSubscription = null;
  }

  if (!conversationId) return;

  const channelId = `conv_${conversationId}_${Date.now()}`;
  activeMessageSubscription = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      },
      async (payload) => {
        const newMsg = payload.new;
        
        // Загрузим профиль отправителя для красивого отображения
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .eq('id', newMsg.sender_id)
          .maybeSingle();

        newMsg.profiles = profile;
        onMessageReceived(newMsg);
      }
    )
    .subscribe();
}

/**
 * Realtime-подписка на глобальные события (обновление списка диалогов)
 */
export function subscribeToGlobalEvents(onEvent) {
  if (globalChangesSubscription) {
    supabase.removeChannel(globalChangesSubscription);
    globalChangesSubscription = null;
  }

  globalChangesSubscription = supabase
    .channel('realtime:global_messages')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      },
      () => {
        onEvent();
      }
    )
    .subscribe();
}
