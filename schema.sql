-- ============================================================
-- Hellena Animal Rescue — Supabase Schema
-- Run this in your Supabase SQL editor:
--   https://supabase.com/dashboard/project/avotknggpqstmnegokfh/editor
-- ============================================================

-- Animals table
create table if not exists animals (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  species text default 'dog',
  breed text,
  age text,
  size text check (size in ('small', 'medium', 'large', 'extra-large')),
  gender text check (gender in ('male', 'female')),
  description text,
  photo_url text,
  status text default 'available' check (status in ('available', 'pending', 'adopted')),
  special_needs boolean default false,
  vaccinated boolean default false,
  neutered boolean default false,
  good_with_kids boolean default true,
  good_with_dogs boolean default true,
  good_with_cats boolean default true,
  posted_by text,
  created_at timestamptz default now()
);

-- Adoption applications
create table if not exists adoption_applications (
  id uuid default gen_random_uuid() primary key,
  animal_id uuid references animals(id) on delete set null,
  animal_name text,
  applicant_name text not null,
  email text not null,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  housing_type text,
  has_yard boolean default false,
  has_pets boolean default false,
  pet_details text,
  has_children boolean default false,
  children_ages text,
  reason text,
  experience text,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz default now()
);

-- Fundraisers
create table if not exists fundraisers (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  goal numeric default 1000,
  raised numeric default 0,
  donor_count integer default 0,
  organizer_name text,
  image_url text,
  status text default 'active' check (status in ('active', 'completed', 'paused')),
  created_at timestamptz default now()
);

-- ── Individual donation records ──────────────────────────────
-- Every completed payment is stored here regardless of provider.
-- When you add Stripe, payment.js already writes to this table.
create table if not exists donations (
  id uuid default gen_random_uuid() primary key,
  fundraiser_id uuid references fundraisers(id) on delete set null,  -- null = general donation
  amount numeric not null,
  payer_name text,
  payer_email text,
  provider text default 'paypal' check (provider in ('paypal', 'stripe')),
  status text default 'completed' check (status in ('completed', 'refunded', 'failed')),
  is_recurring boolean default false,
  created_at timestamptz default now()
);

-- ── Global donation stats (single-row aggregate) ──────────────
-- Keeps the donate.html progress bar fast without summing donations every time.
create table if not exists donation_stats (
  id integer primary key default 1 check (id = 1),  -- enforces single row
  total_raised numeric default 0,
  donor_count integer default 0
);
-- Seed the single stats row
insert into donation_stats (id) values (1) on conflict do nothing;

-- ── Row Level Security ────────────────────────────────────────
alter table animals enable row level security;
alter table adoption_applications enable row level security;
alter table fundraisers enable row level security;

-- Public can read animals and fundraisers
create policy "Animals viewable by everyone"
  on animals for select using (true);

create policy "Fundraisers viewable by everyone"
  on fundraisers for select using (true);

-- Public can submit adoption applications
create policy "Anyone can submit application"
  on adoption_applications for insert with check (true);

-- Anon key allowed to insert/update animals, fundraisers (admin protected at app level)
create policy "Allow insert animals"
  on animals for insert with check (true);

create policy "Allow update animals"
  on animals for update using (true);

create policy "Allow delete animals"
  on animals for delete using (true);

create policy "Allow insert fundraisers"
  on fundraisers for insert with check (true);

create policy "Allow update fundraisers"
  on fundraisers for update using (true);

create policy "Allow delete fundraisers"
  on fundraisers for delete using (true);

create policy "Allow read applications"
  on adoption_applications for select using (true);

create policy "Allow update applications"
  on adoption_applications for update using (true);

create policy "Allow delete applications"
  on adoption_applications for delete using (true);

alter table donations enable row level security;
alter table donation_stats enable row level security;

-- Anyone can record a completed donation (payment already verified by provider)
create policy "Allow insert donations"
  on donations for insert with check (true);

-- Public can read aggregate stats (for progress bars)
create policy "Anyone can read donation stats"
  on donation_stats for select using (true);

-- Only allow updating stats via service-role or anon (payment.js updates aggregate)
create policy "Allow update donation stats"
  on donation_stats for update using (true);
