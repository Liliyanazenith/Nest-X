create table if not exists users(
  id text primary key,
  name text not null unique,
  email text not null unique,
  salt text not null,
  hash text not null,
  display text,
  bio text default '',
  avatar text,
  banner jsonb,
  verified_until bigint not null default 0,
  role text not null default 'user',
  banned int not null default 0,
  joined bigint not null,
  viol int not null default 0,
  s jsonb not null default '{}'
);
create table if not exists sessions(
  id text primary key,
  user_id text not null,
  created bigint not null
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists posts(
  id text primary key,
  user_id text not null,
  body text not null default '',
  media jsonb,
  created bigint not null,
  likes jsonb not null default '[]',
  comments jsonb not null default '[]'
);
create index if not exists posts_created on posts(created desc);
create table if not exists rooms(
  id text primary key,
  type text not null,
  name text not null,
  descr text default '',
  owner text not null,
  members jsonb not null default '[]',
  created bigint not null
);
create table if not exists messages(
  id text primary key,
  room text not null,
  user_id text not null,
  body text not null,
  created bigint not null,
  announce boolean not null default false
);
create index if not exists messages_room on messages(room, created);
create table if not exists site(
  id text primary key,
  data jsonb not null
);
-- Supabase: blokir akses lewat API publik (server memakai koneksi langsung)
alter table users enable row level security;
alter table sessions enable row level security;
alter table posts enable row level security;
alter table rooms enable row level security;
alter table messages enable row level security;
alter table site enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on all tables in schema public to service_role;
  end if;
end $$;
