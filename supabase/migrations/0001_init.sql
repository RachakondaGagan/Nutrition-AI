-- NutritionX AI: initial schema. Run in the Supabase SQL editor or with `supabase db push`.
-- Nutrient columns are nullable on purpose: NULL means "unknown", never 0.

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  age int check (age between 1 and 120),
  height_cm numeric(5,1) check (height_cm > 0),
  weight_kg numeric(5,1) check (weight_kg > 0),
  target_weight_kg numeric(5,1) check (target_weight_kg > 0),
  activity_level text check (activity_level in ('sedentary','light','moderate','active','very_active')),
  diet text check (diet in ('vegetarian','vegetarian_eggs','vegan','other')),
  calorie_target int check (calorie_target between 800 and 10000),
  protein_target_g int check (protein_target_g >= 0),
  carb_target_g int check (carb_target_g >= 0),
  fat_target_g int check (fat_target_g >= 0),
  water_target_ml int not null default 2800 check (water_target_ml between 500 and 10000),
  units text not null default 'metric' check (units in ('metric','imperial')),
  theme text not null default 'dark' check (theme in ('dark','light')),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid,                      -- idempotency key: retries cannot double-insert
  name text not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit text not null check (unit in ('g','kg','ml','l','piece','slice','cup','tbsp','tsp','serving','plate','bowl')),
  weight_g numeric(8,1) check (weight_g > 0),
  volume_ml numeric(8,1) check (volume_ml > 0),
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  eaten_at timestamptz not null,
  local_date date not null,                    -- date in the user's timezone, computed by the server
  calories_kcal numeric(8,2) check (calories_kcal >= 0),
  protein_g numeric(8,2) check (protein_g >= 0),
  carbs_g numeric(8,2) check (carbs_g >= 0),
  sugar_g numeric(8,2) check (sugar_g >= 0),
  added_sugar_g numeric(8,2) check (added_sugar_g >= 0),
  fat_g numeric(8,2) check (fat_g >= 0),
  saturated_fat_g numeric(8,2) check (saturated_fat_g >= 0),
  fiber_g numeric(8,2) check (fiber_g >= 0),
  sodium_mg numeric(9,2) check (sodium_mg >= 0),
  source text not null check (source in ('ai_text','ai_image','manual','verified_db','saved_meal')),
  confidence numeric(3,2) check (confidence between 0 and 1),
  preparation text,
  assumptions text[] not null default '{}',
  image_path text,                             -- keep null for the MVP: do not store photos unless needed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);
create index food_entries_user_date_idx on public.food_entries (user_id, local_date);
create index food_entries_user_eaten_idx on public.food_entries (user_id, eaten_at desc);

create table public.saved_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit text not null,
  calories_kcal numeric(8,2) check (calories_kcal >= 0),
  protein_g numeric(8,2) check (protein_g >= 0),
  carbs_g numeric(8,2) check (carbs_g >= 0),
  fat_g numeric(8,2) check (fat_g >= 0),
  fiber_g numeric(8,2) check (fiber_g >= 0),
  sodium_mg numeric(9,2) check (sodium_mg >= 0),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_foods_user_idx on public.saved_foods (user_id);

create table public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  servings numeric(6,2) not null default 1 check (servings > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_meals_user_idx on public.saved_meals (user_id);

create table public.saved_meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.saved_meals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit text not null,
  calories_kcal numeric(8,2) check (calories_kcal >= 0),
  protein_g numeric(8,2) check (protein_g >= 0),
  carbs_g numeric(8,2) check (carbs_g >= 0),
  fat_g numeric(8,2) check (fat_g >= 0),
  fiber_g numeric(8,2) check (fiber_g >= 0),
  sodium_mg numeric(9,2) check (sodium_mg >= 0)
);
create index saved_meal_items_meal_idx on public.saved_meal_items (meal_id);

create table public.water_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid,
  amount_ml int not null check (amount_ml between 1 and 5000),
  drunk_at timestamptz not null,
  local_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);
create index water_entries_user_date_idx on public.water_entries (user_id, local_date);

-- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['profiles','food_entries','saved_foods','saved_meals'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- Row Level Security: every table is owner-only.
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$ declare t text; begin
  foreach t in array array['food_entries','saved_foods','saved_meals','water_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Items must belong to the user AND to a meal the user owns.
alter table public.saved_meal_items enable row level security;
create policy "own meal items" on public.saved_meal_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.saved_meals m where m.id = meal_id and m.user_id = (select auth.uid()))
  );

-- Create a profile row automatically on signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id) values (new.id) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
