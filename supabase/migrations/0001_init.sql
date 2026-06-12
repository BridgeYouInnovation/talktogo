-- TalkToGo initial schema
-- Run this in the Supabase SQL editor (or `supabase db push`).

-- ============================================================
-- Tables
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  domain text,
  widget_settings jsonb not null default '{
    "primaryColor": "#2563eb",
    "position": "right",
    "title": "Chat with us",
    "subtitle": "We typically reply in a few minutes",
    "welcomeMessage": "Hi there! 👋 How can we help you today?",
    "offlineMessage": "Leave a message and we will get back to you by email.",
    "launcherIcon": "chat",
    "showBranding": true,
    "agentName": "Support",
    "language": "en"
  }'::jsonb,
  created_at timestamptz not null default now()
);

create index sites_owner_idx on public.sites (owner_id);

create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites on delete cascade,
  visitor_key text not null,
  name text,
  email text,
  country text,
  country_code text,
  city text,
  browser text,
  os text,
  device text,
  current_page text,
  current_page_title text,
  referrer text,
  online boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (site_id, visitor_key)
);

create index visitors_site_idx on public.visitors (site_id, last_seen_at desc);

create table public.page_views (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites on delete cascade,
  visitor_id uuid not null references public.visitors on delete cascade,
  url text not null,
  title text,
  created_at timestamptz not null default now()
);

create index page_views_visitor_idx on public.page_views (visitor_id, created_at desc);
create index page_views_site_idx on public.page_views (site_id, created_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites on delete cascade,
  visitor_id uuid not null references public.visitors on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  agent_unread_count int not null default 0,
  unique (site_id, visitor_id)
);

create index conversations_site_idx on public.conversations (site_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  site_id uuid not null references public.sites on delete cascade,
  sender_type text not null check (sender_type in ('visitor', 'agent')),
  agent_id uuid references auth.users,
  body text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- ============================================================
-- Profile auto-creation on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Row Level Security
-- Dashboard users (authenticated) access rows for sites they own.
-- The widget (anon) has NO direct table access; it goes through
-- the SECURITY DEFINER RPCs below, authenticated by visitor_key.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.visitors enable row level security;
alter table public.page_views enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own sites" on public.sites
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "site visitors" on public.visitors
  for all using (exists (select 1 from public.sites s where s.id = visitors.site_id and s.owner_id = auth.uid()));

create policy "site page views" on public.page_views
  for select using (exists (select 1 from public.sites s where s.id = page_views.site_id and s.owner_id = auth.uid()));

create policy "site conversations" on public.conversations
  for all using (exists (select 1 from public.sites s where s.id = conversations.site_id and s.owner_id = auth.uid()));

create policy "site messages" on public.messages
  for all using (exists (select 1 from public.sites s where s.id = messages.site_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.sites s where s.id = messages.site_id and s.owner_id = auth.uid()));

create policy "own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Widget RPCs (SECURITY DEFINER, callable by anon)
-- visitor_key is a long random secret generated by the widget and
-- kept in the visitor's localStorage — it acts as the visitor's token.
-- ============================================================

-- Initialize / resume a visitor session. Returns widget settings,
-- visitor id, conversation id and recent messages in one round trip.
create or replace function public.widget_init(
  p_site_id uuid,
  p_visitor_key text,
  p_url text default null,
  p_title text default null,
  p_referrer text default null,
  p_browser text default null,
  p_os text default null,
  p_device text default null,
  p_country text default null,
  p_country_code text default null,
  p_city text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_visitor public.visitors%rowtype;
  v_conversation public.conversations%rowtype;
  v_messages jsonb;
  v_is_new boolean := false;
begin
  if p_visitor_key is null or length(p_visitor_key) < 16 then
    raise exception 'invalid visitor key';
  end if;

  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'unknown site';
  end if;

  select * into v_visitor from public.visitors
    where site_id = p_site_id and visitor_key = p_visitor_key;

  if not found then
    v_is_new := true;
    insert into public.visitors (
      site_id, visitor_key, browser, os, device, referrer,
      country, country_code, city, current_page, current_page_title, online
    ) values (
      p_site_id, p_visitor_key, p_browser, p_os, p_device, p_referrer,
      p_country, p_country_code, p_city, p_url, p_title, true
    ) returning * into v_visitor;
  else
    update public.visitors set
      online = true,
      last_seen_at = now(),
      current_page = coalesce(p_url, current_page),
      current_page_title = coalesce(p_title, current_page_title),
      browser = coalesce(p_browser, browser),
      os = coalesce(p_os, os),
      device = coalesce(p_device, device),
      country = coalesce(country, p_country),
      country_code = coalesce(country_code, p_country_code),
      city = coalesce(city, p_city)
    where id = v_visitor.id
    returning * into v_visitor;
  end if;

  if p_url is not null then
    insert into public.page_views (site_id, visitor_id, url, title)
    values (p_site_id, v_visitor.id, p_url, p_title);
  end if;

  select * into v_conversation from public.conversations
    where site_id = p_site_id and visitor_id = v_visitor.id;
  if not found then
    insert into public.conversations (site_id, visitor_id)
    values (p_site_id, v_visitor.id)
    returning * into v_conversation;
  end if;

  select coalesce(jsonb_agg(m order by m.created_at), '[]'::jsonb) into v_messages
  from (
    select id, sender_type, body, created_at
    from public.messages
    where conversation_id = v_conversation.id
    order by created_at desc
    limit 100
  ) m;

  return jsonb_build_object(
    'visitor_id', v_visitor.id,
    'conversation_id', v_conversation.id,
    'is_new_visitor', v_is_new,
    'settings', v_site.widget_settings,
    'site_name', v_site.name,
    'messages', v_messages
  );
end;
$$;

-- Visitor sends a chat message.
create or replace function public.widget_send_message(
  p_site_id uuid,
  p_visitor_key text,
  p_body text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_visitor public.visitors%rowtype;
  v_conversation public.conversations%rowtype;
  v_message public.messages%rowtype;
begin
  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 4000 then
    raise exception 'invalid message';
  end if;

  select * into v_visitor from public.visitors
    where site_id = p_site_id and visitor_key = p_visitor_key;
  if not found then
    raise exception 'unknown visitor';
  end if;

  select * into v_conversation from public.conversations
    where site_id = p_site_id and visitor_id = v_visitor.id;
  if not found then
    insert into public.conversations (site_id, visitor_id)
    values (p_site_id, v_visitor.id)
    returning * into v_conversation;
  end if;

  insert into public.messages (conversation_id, site_id, sender_type, body)
  values (v_conversation.id, p_site_id, 'visitor', trim(p_body))
  returning * into v_message;

  update public.conversations set
    last_message_at = now(),
    last_message_preview = left(trim(p_body), 140),
    agent_unread_count = agent_unread_count + 1,
    status = 'open'
  where id = v_conversation.id;

  update public.visitors set last_seen_at = now(), online = true
  where id = v_visitor.id;

  return jsonb_build_object(
    'id', v_message.id,
    'conversation_id', v_conversation.id,
    'created_at', v_message.created_at
  );
end;
$$;

-- Track a page change (SPA navigations and full page loads).
create or replace function public.widget_track_page(
  p_site_id uuid,
  p_visitor_key text,
  p_url text,
  p_title text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_visitor public.visitors%rowtype;
begin
  select * into v_visitor from public.visitors
    where site_id = p_site_id and visitor_key = p_visitor_key;
  if not found then
    return;
  end if;

  update public.visitors set
    current_page = p_url,
    current_page_title = p_title,
    last_seen_at = now(),
    online = true
  where id = v_visitor.id;

  insert into public.page_views (site_id, visitor_id, url, title)
  values (p_site_id, v_visitor.id, p_url, p_title);
end;
$$;

-- Heartbeat / presence. p_online=false marks the visitor as left.
create or replace function public.widget_heartbeat(
  p_site_id uuid,
  p_visitor_key text,
  p_online boolean default true
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.visitors set
    online = p_online,
    last_seen_at = now()
  where site_id = p_site_id and visitor_key = p_visitor_key;
end;
$$;

-- Visitor identifies themselves (pre-chat form: name / email).
create or replace function public.widget_identify(
  p_site_id uuid,
  p_visitor_key text,
  p_name text default null,
  p_email text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.visitors set
    name = coalesce(nullif(trim(p_name), ''), name),
    email = coalesce(nullif(trim(p_email), ''), email),
    last_seen_at = now()
  where site_id = p_site_id and visitor_key = p_visitor_key;
end;
$$;

-- Lock the functions down: only anon/authenticated may execute.
revoke all on function public.widget_init(uuid, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.widget_send_message(uuid, text, text) from public;
revoke all on function public.widget_track_page(uuid, text, text, text) from public;
revoke all on function public.widget_heartbeat(uuid, text, boolean) from public;
revoke all on function public.widget_identify(uuid, text, text, text) from public;
grant execute on function public.widget_init(uuid, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.widget_send_message(uuid, text, text) to anon, authenticated;
grant execute on function public.widget_track_page(uuid, text, text, text) to anon, authenticated;
grant execute on function public.widget_heartbeat(uuid, text, boolean) to anon, authenticated;
grant execute on function public.widget_identify(uuid, text, text, text) to anon, authenticated;

-- Agent reply helper: inserts the message and resets unread state.
create or replace function public.agent_send_message(
  p_conversation_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_message public.messages%rowtype;
begin
  select c.* into v_conversation
  from public.conversations c
  join public.sites s on s.id = c.site_id
  where c.id = p_conversation_id and s.owner_id = auth.uid();

  if not found then
    raise exception 'conversation not found';
  end if;

  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 4000 then
    raise exception 'invalid message';
  end if;

  insert into public.messages (conversation_id, site_id, sender_type, agent_id, body)
  values (v_conversation.id, v_conversation.site_id, 'agent', auth.uid(), trim(p_body))
  returning * into v_message;

  update public.conversations set
    last_message_at = now(),
    last_message_preview = left(trim(p_body), 140),
    agent_unread_count = 0
  where id = v_conversation.id;

  return jsonb_build_object('id', v_message.id, 'created_at', v_message.created_at);
end;
$$;

revoke all on function public.agent_send_message(uuid, text) from public;
grant execute on function public.agent_send_message(uuid, text) to authenticated;

-- Mark a conversation read by the agent.
create or replace function public.agent_mark_read(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.conversations c set agent_unread_count = 0
  from public.sites s
  where c.id = p_conversation_id and s.id = c.site_id and s.owner_id = auth.uid();
end;
$$;

revoke all on function public.agent_mark_read(uuid) from public;
grant execute on function public.agent_mark_read(uuid) to authenticated;

-- Sweep visitors with no heartbeat in the last 2 minutes to offline.
-- Called opportunistically by the dashboard.
create or replace function public.sweep_offline_visitors()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.visitors v set online = false
  from public.sites s
  where v.site_id = s.id
    and s.owner_id = auth.uid()
    and v.online = true
    and v.last_seen_at < now() - interval '2 minutes';
end;
$$;

revoke all on function public.sweep_offline_visitors() from public;
grant execute on function public.sweep_offline_visitors() to authenticated;
