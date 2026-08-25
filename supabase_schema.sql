-- ========================================================
-- SUPABASE SQL SCHEMA FOR MESSENGER APPLICATION
-- Скопируйте и выполните этот код в Supabase SQL Editor
-- (https://supabase.com/dashboard/project/vvrpsqydnttvkeraefcr/sql)
-- ========================================================

-- ========================================================
-- ОЧИСТКА СТАРЫХ ТАБЛИЦ (если они были созданы ранее)
-- ========================================================
drop table if exists public.messages cascade;
drop table if exists public.conversation_members cascade;
drop table if exists public.conversations cascade;
drop table if exists public.profiles cascade;

-- 1. ТАБЛИЦА ПРОФИЛЕЙ ПОЛЬЗОВАТЕЛЕЙ
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  display_name text,
  avatar_url text,
  is_banned boolean default false not null,
  muted_until timestamp with time zone default null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Индекс для быстрого поиска по тегу/юзернейму
create index if not exists profiles_username_idx on public.profiles (username);

-- 2. ТАБЛИЦА ДИАЛОГОВ (ЧАТОВ)
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. ТАБЛИЦА УЧАСТНИКОВ ДИАЛОГА
create table public.conversation_members (
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (conversation_id, user_id)
);

create index if not exists conv_members_user_idx on public.conversation_members (user_id);
create index if not exists conv_members_conv_idx on public.conversation_members (conversation_id);

-- 4. ТАБЛИЦА СООБЩЕНИЙ
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists messages_conv_created_idx on public.messages (conversation_id, created_at);

-- ========================================================
-- ROW LEVEL SECURITY (RLS) ПОЛИТИКИ И ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
-- ========================================================

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Helper 1: Проверка администратора puffahaka
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and lower(username) = 'puffahaka'
  );
$$ language sql security definer;

-- Helper 2: Проверка участия в диалоге (SECURITY DEFINER предотвращает рекурсию RLS!)
create or replace function public.is_member_of_conversation(c_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = c_id and user_id = auth.uid()
  );
$$ language sql security definer;

-- Helper 3: Проверка возможности отправки сообщений (не забанен и не замучен)
create or replace function public.can_send_message()
returns boolean as $$
  select not exists (
    select 1 from public.profiles
    where id = auth.uid() and (is_banned = true or (muted_until is not null and muted_until > now()))
  );
$$ language sql security definer;

-- Политики для Profiles
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile or admin can update any" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile or admin can update any"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin());

-- Политики для Conversations
drop policy if exists "Users can view conversations they belong to" on public.conversations;
create policy "Users can view conversations they belong to"
  on public.conversations for select
  using (public.is_admin() or public.is_member_of_conversation(id));

drop policy if exists "Authenticated users can create conversations" on public.conversations;
create policy "Authenticated users can create conversations"
  on public.conversations for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "Admins or members can delete conversations" on public.conversations;
create policy "Admins or members can delete conversations"
  on public.conversations for delete
  using (public.is_admin() or public.is_member_of_conversation(id));

-- Политики для Conversation Members
drop policy if exists "Users can view members of their conversations" on public.conversation_members;
create policy "Users can view members of their conversations"
  on public.conversation_members for select
  using (public.is_admin() or user_id = auth.uid() or public.is_member_of_conversation(conversation_id));

drop policy if exists "Authenticated users can add members" on public.conversation_members;
create policy "Authenticated users can add members"
  on public.conversation_members for insert
  with check (auth.role() = 'authenticated');

-- Политики для Messages
drop policy if exists "Users can view messages in their conversations" on public.messages;
create policy "Users can view messages in their conversations"
  on public.messages for select
  using (public.is_admin() or public.is_member_of_conversation(conversation_id));

drop policy if exists "Users can insert messages to their conversations" on public.messages;
create policy "Users can insert messages to their conversations"
  on public.messages for insert
  with check (
    auth.uid() = sender_id
    and public.can_send_message()
    and public.is_member_of_conversation(conversation_id)
  );

drop policy if exists "Users can delete own messages or admin can delete any" on public.messages;
create policy "Users can delete own messages or admin can delete any"
  on public.messages for delete
  using (auth.uid() = sender_id or public.is_admin());

-- ========================================================
-- ФУНКЦИЯ И ТРИГГЕР: АВТОМАТИЧЕСКОЕ СОЗДАНИЕ ПРОФИЛЯ ПРИ РЕГИСТРАЦИИ
-- ========================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  raw_username text;
  raw_display_name text;
  clean_username text;
begin
  raw_username := new.raw_user_meta_data->>'username';
  raw_display_name := new.raw_user_meta_data->>'display_name';
  
  if raw_username is null or trim(raw_username) = '' then
    -- Если тег не передан, генерируем из email
    clean_username := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
  else
    clean_username := lower(regexp_replace(replace(raw_username, '@', ''), '[^a-zA-Z0-9_]', '', 'g'));
  end if;

  -- Проверка на пустоту после очистки
  if clean_username = '' then
    clean_username := 'user_' || substr(new.id::text, 1, 6);
  end if;

  -- Если имя не задано, берем тег
  if raw_display_name is null or trim(raw_display_name) = '' then
    raw_display_name := clean_username;
  end if;

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    clean_username,
    raw_display_name,
    'https://api.dicebear.com/7.x/bottts/svg?seed=' || clean_username
  )
  on conflict (id) do update
  set username = excluded.username,
      display_name = excluded.display_name;

  return new;
exception when others then
  -- Защита от сбоя при дубликате username
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    'user_' || substr(new.id::text, 1, 8),
    coalesce(raw_display_name, 'User'),
    'https://api.dicebear.com/7.x/bottts/svg?seed=' || substr(new.id::text, 1, 8)
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ========================================================
-- ФУНКЦИЯ: ПОИСК ИЛИ СОЗДАНИЕ ДИАЛОГА 1-НА-1
-- ========================================================

create or replace function public.get_or_create_direct_conversation(target_user_id uuid)
returns uuid as $$
declare
  curr_user_id uuid;
  conv_id uuid;
begin
  curr_user_id := auth.uid();
  if curr_user_id is null then
    raise exception 'Not authenticated';
  end if;
  
  if curr_user_id = target_user_id then
    raise exception 'Cannot create conversation with yourself';
  end if;

  -- Ищем существующий диалог между этими двумя пользователями
  select cm1.conversation_id into conv_id
  from public.conversation_members cm1
  join public.conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  where cm1.user_id = curr_user_id
    and cm2.user_id = target_user_id
    and (
      select count(*) 
      from public.conversation_members cm_count 
      where cm_count.conversation_id = cm1.conversation_id
    ) = 2
  limit 1;

  -- Если диалог найден, возвращаем его ID
  if conv_id is not null then
    return conv_id;
  end if;

  -- Иначе создаем новый диалог
  insert into public.conversations (created_at, updated_at)
  values (now(), now())
  returning id into conv_id;

  -- Добавляем обоих участников
  insert into public.conversation_members (conversation_id, user_id)
  values 
    (conv_id, curr_user_id),
    (conv_id, target_user_id);

  return conv_id;
end;
$$ language plpgsql security definer;

-- ========================================================
-- ВКЛЮЧЕНИЕ REALTIME ДЛЯ ТАБЛИЦ
-- ========================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversation_members;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when others then null;
  end;
end $$;

-- ========================================================
-- АВТОМАТИЧЕСКОЕ ВОССТАНОВЛЕНИЕ ПРОФИЛЕЙ ДЛЯ ВСЕХ СУЩЕСТВУЮЩИХ ПОЛЬЗОВАТЕЛЕЙ
-- ========================================================
insert into public.profiles (id, username, display_name, avatar_url, is_banned)
select 
  id,
  coalesce(nullif(lower(regexp_replace(raw_user_meta_data->>'username', '[^a-zA-Z0-9_]', '', 'g')), ''), 'user_' || substr(id::text, 1, 6)),
  coalesce(nullif(raw_user_meta_data->>'display_name', ''), 'User'),
  'https://api.dicebear.com/7.x/bottts/svg?seed=' || coalesce(nullif(raw_user_meta_data->>'username', ''), id::text),
  false
from auth.users
on conflict (id) do update
set username = excluded.username,
    display_name = excluded.display_name;

-- Перезагрузка кэша схемы PostgREST
notify pgrst, 'reload schema';

