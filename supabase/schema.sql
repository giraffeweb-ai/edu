create table if not exists public.schools (
  code text primary key,
  name text not null,
  region text not null,
  folder_path text not null,
  assigned_to text,
  created_by text,
  status text not null default 'pending_assignment',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.uploads (
  id text primary key,
  school_code text not null references public.schools(code) on delete cascade,
  year text not null,
  category text not null,
  file_count integer not null default 0,
  total_bytes bigint not null default 0,
  created_by text not null,
  status text not null,
  analysis_status text not null,
  analysis_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.upload_files (
  id bigserial primary key,
  upload_id text not null references public.uploads(id) on delete cascade,
  original_name text not null,
  stored_path text not null,
  predicted_category text not null,
  file_year text not null default '待確認年度',
  size_bytes bigint not null default 0,
  sha256 text not null
);

create table if not exists public.analysis_results (
  upload_id text primary key references public.uploads(id) on delete cascade,
  school_code text not null references public.schools(code) on delete cascade,
  analysis jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.schools enable row level security;
alter table public.uploads enable row level security;
alter table public.upload_files enable row level security;
alter table public.analysis_results enable row level security;

create or replace view public.upload_dashboard as
select
  uploads.*,
  schools.name as school_name,
  schools.region as region
from public.uploads
join public.schools on schools.code = uploads.school_code;

insert into public.schools
  (code, name, region, folder_path, assigned_to, created_by, status, created_at, updated_at)
values
  (
    'GN26058',
    '新北八里分校',
    '北區',
    '分校資料/北區/GN26058_新北八里分校',
    'tracy',
    'system',
    'assigned',
    now(),
    now()
  )
on conflict (code) do update set
  name = excluded.name,
  region = excluded.region,
  folder_path = excluded.folder_path,
  assigned_to = coalesce(public.schools.assigned_to, excluded.assigned_to),
  status = case
    when public.schools.assigned_to is null then excluded.status
    else public.schools.status
  end,
  updated_at = now();
