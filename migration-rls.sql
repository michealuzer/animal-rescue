-- ============================================================
-- Migration: Tighten RLS policies + add donation stats trigger
-- Run this in the Supabase SQL editor to update existing policies.
-- ============================================================

-- ── Drop old permissive policies ──────────────────────────────
drop policy if exists "Allow insert animals" on animals;
drop policy if exists "Allow update animals" on animals;
drop policy if exists "Allow delete animals" on animals;
drop policy if exists "Allow insert fundraisers" on fundraisers;
drop policy if exists "Allow update fundraisers" on fundraisers;
drop policy if exists "Allow delete fundraisers" on fundraisers;
drop policy if exists "Allow read applications" on adoption_applications;
drop policy if exists "Allow update applications" on adoption_applications;
drop policy if exists "Allow delete applications" on adoption_applications;
drop policy if exists "Allow update donation stats" on donation_stats;

-- ── Animals: staff only for mutations ─────────────────────────
create policy "Staff can insert animals"
  on animals for insert with check (auth.role() = 'authenticated');

create policy "Staff can update animals"
  on animals for update using (auth.role() = 'authenticated');

create policy "Staff can delete animals"
  on animals for delete using (auth.role() = 'authenticated');

-- ── Fundraisers: staff only for mutations ─────────────────────
create policy "Staff can insert fundraisers"
  on fundraisers for insert with check (auth.role() = 'authenticated');

create policy "Staff can update fundraisers"
  on fundraisers for update using (auth.role() = 'authenticated');

create policy "Staff can delete fundraisers"
  on fundraisers for delete using (auth.role() = 'authenticated');

-- ── Applications: staff only for read/update/delete ───────────
create policy "Staff can read applications"
  on adoption_applications for select using (auth.role() = 'authenticated');

create policy "Staff can update applications"
  on adoption_applications for update using (auth.role() = 'authenticated');

create policy "Staff can delete applications"
  on adoption_applications for delete using (auth.role() = 'authenticated');

-- ── Donation stats: staff only for manual updates ─────────────
create policy "Staff can update donation stats"
  on donation_stats for update using (auth.role() = 'authenticated');

-- ── Donations: allow public read ──────────────────────────────
create policy "Anyone can read donations"
  on donations for select using (true);

-- ── Auto-update stats trigger ─────────────────────────────────
-- Replaces the manual PATCH calls in payment.js
create or replace function update_donation_stats()
returns trigger as $$
begin
  if NEW.fundraiser_id is not null then
    update fundraisers
    set raised = raised + NEW.amount,
        donor_count = donor_count + 1
    where id = NEW.fundraiser_id;
  else
    update donation_stats
    set total_raised = total_raised + NEW.amount,
        donor_count = donor_count + 1
    where id = 1;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists on_donation_inserted on donations;
create trigger on_donation_inserted
  after insert on donations
  for each row execute function update_donation_stats();
