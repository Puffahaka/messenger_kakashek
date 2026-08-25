import { supabase } from './supabaseClient.js';

export let currentUser = null;
export let currentProfile = null;

/**
 * Очистить и нормализовать тег (@username -> username)
 */
export function normalizeTag(tag) {
  if (!tag) return '';
  return tag.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Валидация формата тега / юзернейма
 */
export function validateTag(tag) {
  const normalized = normalizeTag(tag);
  const regex = /^[a-z0-9_-]{2,30}$/;
  if (!regex.test(normalized)) {
    return {
      valid: false,
      error: 'Имя пользователя должно содержать от 2 до 30 латинских букв, цифр или _'
    };
  }
  return { valid: true, tag: normalized };
}

/**
 * Вспомогательная функция для генерации внутреннего Email из тега
 */
export function tagToEmail(tagOrEmail) {
  if (!tagOrEmail) return '';
  const trimmed = tagOrEmail.trim();
  // Если уже передан валидный email с доменом
  if (trimmed.includes('@') && trimmed.split('@')[1].includes('.')) {
    return trimmed.toLowerCase();
  }
  const clean = normalizeTag(trimmed);
  return `${clean}@mail.com`;
}

/**
 * Регистрация нового аккаунта (по имени пользователя / тегу и паролю)
 */
export async function signUp({ username, password, displayName, email = null }) {
  const tagValidation = validateTag(username);
  if (!tagValidation.valid) {
    throw new Error(tagValidation.error);
  }
  const cleanTag = tagValidation.tag;

  if (!password || password.length < 6) {
    throw new Error('Пароль должен быть не менее 6 символов');
  }

  // Проверка уникальности тега
  const { data: existingUser, error: checkError } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', cleanTag)
    .maybeSingle();

  if (existingUser) {
    throw new Error(`Имя пользователя @${cleanTag} уже занято! Пожалуйста, выберите другое.`);
  }

  const finalDisplayName = (displayName && displayName.trim()) ? displayName.trim() : cleanTag;
  const userEmail = email ? email.trim() : tagToEmail(cleanTag);

  const { data, error } = await supabase.auth.signUp({
    email: userEmail,
    password: password,
    options: {
      data: {
        username: cleanTag,
        display_name: finalDisplayName
      }
    }
  });

  if (error) {
    console.error('Supabase signUp error:', error);
    const msg = error.message ? error.message.toLowerCase() : '';
    if (msg.includes('already registered') || msg.includes('user already exists')) {
      throw new Error(`Пользователь @${cleanTag} уже зарегистрирован. Попробуйте войти.`);
    }
    throw new Error(error.message || 'Ошибка регистрации');
  }

  // Автоматический вход сразу после создания аккаунта
  try {
    const loginRes = await signIn({ usernameOrEmail: cleanTag, password });
    return loginRes;
  } catch (loginErr) {
    console.warn('Auto sign-in error after signup:', loginErr);
    // Если сессия сразу создана из signup
    if (data.user) {
      currentUser = data.user;
      currentProfile = await getProfile(data.user.id);
    }
    return data;
  }
}

/**
 * Проверка, является ли пользователь администратором
 */
export function isAdmin(username) {
  if (!username) return false;
  return normalizeTag(username) === 'puffahaka';
}

/**
 * Вход в аккаунт (по имени пользователя / @тегу и паролю)
 */
export async function signIn({ usernameOrEmail, password }) {
  if (!usernameOrEmail || !usernameOrEmail.trim()) {
    throw new Error('Введите имя пользователя или тег');
  }
  if (!password) {
    throw new Error('Введите пароль');
  }

  const resolvedEmail = tagToEmail(usernameOrEmail);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: resolvedEmail,
    password: password
  });

  if (error) {
    console.error('Supabase signIn error:', error);
    const msg = error.message ? error.message.toLowerCase() : '';
    
    if (msg.includes('email not confirmed')) {
      throw new Error('⚠️ Email не подтвержден! В настройках Supabase отключите подтверждение почты: Authentication -> Providers -> Email -> выключите "Confirm email".');
    }
    if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
      throw new Error('Неверное имя пользователя или пароль');
    }
    throw new Error(error.message || 'Ошибка входа в аккаунт');
  }

  currentUser = data.user;
  currentProfile = await getProfile(data.user.id);
  return data;
}

/**
 * Выход из аккаунта
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  if (error) throw error;
}

/**
 * Получить профиль пользователя по ID
 */
export async function getProfile(userId) {
  if (!userId) return null;
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }

  if (!data && currentUser && currentUser.id === userId) {
    // Если триггер еще не отработал, создаем профиль на лету
    const rawUsername = currentUser.user_metadata?.username || `user_${userId.slice(0, 6)}`;
    const rawName = currentUser.user_metadata?.display_name || rawUsername;
    const fallbackProfile = {
      id: userId,
      username: normalizeTag(rawUsername),
      display_name: rawName,
      avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${rawUsername}`,
      is_banned: false,
      muted_until: null
    };
    
    try {
      await supabase.from('profiles').upsert(fallbackProfile, { onConflict: 'id' });
    } catch (e) {
      console.warn('Profile fallback upsert notice:', e);
    }
    return fallbackProfile;
  }

  return data;
}

/**
 * Инициализация текущей сессии
 */
export async function initAuth(onStateChange) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session?.user) {
      currentUser = session.user;
      currentProfile = await getProfile(currentUser.id);
    } else {
      currentUser = null;
      currentProfile = null;
    }
  } catch (err) {
    console.error('Session retrieval exception:', err);
    currentUser = null;
    currentProfile = null;
  }

  onStateChange(currentUser, currentProfile);

  supabase.auth.onAuthStateChange(async (event, session) => {
    try {
      if (session?.user) {
        currentUser = session.user;
        currentProfile = await getProfile(currentUser.id);
      } else {
        currentUser = null;
        currentProfile = null;
      }
    } catch (e) {
      console.error('Auth state change error:', e);
      currentUser = null;
      currentProfile = null;
    }
    onStateChange(currentUser, currentProfile);
  });
}
