// ─────────────────────────────────────────────────────────────
// config.js — centralised project settings
// ─────────────────────────────────────────────────────────────

// Supabase
const SUPABASE_URL = 'https://avotknggpqstmnegokfh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2b3RrbmdncHFzdG1uZWdva2ZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTUwOTgsImV4cCI6MjA4OTIzMTA5OH0.8SeT9EVITgZXSGzmqMvWZFWmwpzuTyWRQZHFKt7EO_M';
const SUPABASE_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// Donation goal (USD)
const DONATION_GOAL = 5000;

// ── Payment provider keys ─────────────────────────────────────
// PayPal (kept as fallback)
const PAYPAL_CLIENT_ID = 'ASDDaM6sFt5PS6ZkYFgOEq_GsUd4N0Mu3w5n7TweRcdmmN3F08R36nqEe0pn6hMfwjmsYRLjwacy2yt0';

// Stripe publishable key
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51T2oJDBh9Yv2bnbwZT3UZs536g4qE4VsYjUFagXJxAqxuoGlbWM9rZnjRiWDT27YhIgRjkgHrF3Hxfo6zjpGKVYf00JBkfIHEN';
