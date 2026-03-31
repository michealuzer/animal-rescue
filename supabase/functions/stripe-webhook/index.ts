// ─────────────────────────────────────────────────────────────
// stripe-webhook — handles Stripe webhook events
//
// Listens for payment_intent.succeeded to reliably record
// donations from redirect-based payment methods (bank transfer,
// Cash App, etc.) that may not return to the browser.
//
// Required secrets:
//   STRIPE_SECRET_KEY — your Stripe secret key
//   STRIPE_WEBHOOK_SECRET — webhook signing secret from Stripe dashboard
//   SUPABASE_URL — project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key for DB writes
// ─────────────────────────────────────────────────────────────

import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-04-10',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const sig = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;

    if (webhookSecret && sig) {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } else {
      // Fallback for testing (no signature verification)
      event = JSON.parse(body);
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const amount = pi.amount / 100; // cents to dollars
      const description = pi.description || '';

      // Extract metadata from description if available
      // Description format: "Donation: <title> — Hellena Animal Rescue" or
      //                     "Animal Rescue Donation – Hellena Animal Rescue"

      // Check if donation already recorded (idempotency via stripe payment intent id)
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/donations?provider=eq.stripe&payer_email=eq.stripe:${pi.id}&select=id`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        // Already recorded (e.g. by client-side recordDonation)
        return new Response(JSON.stringify({ received: true, skipped: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if already recorded by client-side (match by amount and recent timestamp)
      // We use a broader check: any donation with same amount in last 5 minutes
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recentRes = await fetch(
        `${SUPABASE_URL}/rest/v1/donations?provider=eq.stripe&amount=eq.${amount}&created_at=gte.${fiveMinAgo}&select=id`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      const recent = await recentRes.json();
      if (recent && recent.length > 0) {
        // Likely already recorded by client
        return new Response(JSON.stringify({ received: true, skipped: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Record the donation
      await fetch(`${SUPABASE_URL}/rest/v1/donations`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          amount,
          payer_name: pi.shipping?.name || null,
          payer_email: pi.receipt_email || null,
          provider: 'stripe',
          status: 'completed',
          fundraiser_id: null, // webhook doesn't have fundraiser context
        }),
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('stripe-webhook error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
