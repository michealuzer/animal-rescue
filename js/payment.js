// ─────────────────────────────────────────────────────────────
// payment.js — payment provider abstraction
//
// To switch to Stripe later:
//   1. Uncomment STRIPE_PUBLISHABLE_KEY in config.js and add your key
//   2. Add <script src="https://js.stripe.com/v3/"></script> to your HTML
//   3. Implement your server endpoint to create a PaymentIntent
//   4. Change ACTIVE_PROVIDER below to 'stripe'
//   Everything else stays the same.
// ─────────────────────────────────────────────────────────────

const ACTIVE_PROVIDER = 'paypal'; // 'paypal' | 'stripe'

// ── Supabase helpers ──────────────────────────────────────────

async function recordDonation({ amount, fundraiserId = null, payerName = null, payerEmail = null, provider }) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/donations', {
      method: 'POST',
      headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        amount: parseFloat(amount),
        fundraiser_id: fundraiserId,
        payer_name: payerName,
        payer_email: payerEmail,
        provider,
        status: 'completed',
      }),
    });

    // Update aggregate totals on the fundraiser or the global stats row
    if (fundraiserId) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/fundraisers?id=eq.${fundraiserId}`, { headers: SUPABASE_HEADERS });
      const [f] = await res.json();
      if (f) {
        await fetch(`${SUPABASE_URL}/rest/v1/fundraisers?id=eq.${fundraiserId}`, {
          method: 'PATCH',
          headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ raised: parseFloat(f.raised || 0) + parseFloat(amount), donor_count: (f.donor_count || 0) + 1 }),
        });
      }
    } else {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/donation_stats?id=eq.1`, { headers: SUPABASE_HEADERS });
      const [s] = await res.json();
      if (s) {
        await fetch(`${SUPABASE_URL}/rest/v1/donation_stats?id=eq.1`, {
          method: 'PATCH',
          headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ total_raised: parseFloat(s.total_raised || 0) + parseFloat(amount), donor_count: (s.donor_count || 0) + 1 }),
        });
      }
    }
  } catch (e) {
    console.error('recordDonation error', e);
  }
}

// ── PayPal provider ───────────────────────────────────────────

const PayPalProvider = {
  /**
   * @param {string} containerId  - DOM id to render the button into (without #)
   * @param {object} opts
   *   getAmount()      → string/number  current donation amount
   *   description      → string         order description shown to payer
   *   fundraiserId     → string|null    Supabase fundraiser id (null for general donation)
   *   onSuccess(info)  → void           called after payment captured
   *   onError(err)     → void           called on failure
   */
  render(containerId, { getAmount, description, fundraiserId = null, onSuccess, onError }) {
    paypal.Buttons({
      createOrder(data, actions) {
        return actions.order.create({
          purchase_units: [{
            description,
            amount: { value: parseFloat(getAmount() || 25).toFixed(2) },
          }],
        });
      },
      onApprove(data, actions) {
        return actions.order.capture().then(async details => {
          const amount = details.purchase_units[0].amount.value;
          const payerName = details.payer?.name
            ? `${details.payer.name.given_name} ${details.payer.name.surname}`
            : null;
          const payerEmail = details.payer?.email_address || null;
          await recordDonation({ amount, fundraiserId, payerName, payerEmail, provider: 'paypal' });
          onSuccess({ amount, payerName, payerEmail });
        });
      },
      onError,
    }).render('#' + containerId);
  },
};

// ── Stripe provider (stub — ready for when you add Stripe) ────

// const StripeProvider = {
//   render(containerId, { getAmount, description, fundraiserId, onSuccess, onError }) {
//     const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
//     const elements = stripe.elements();
//     const card = elements.create('card');
//     card.mount('#' + containerId);
//
//     document.getElementById(containerId).closest('form')?.addEventListener('submit', async e => {
//       e.preventDefault();
//       // 1. Call YOUR backend: POST /api/create-payment-intent { amount, currency: 'usd' }
//       // 2. const { clientSecret } = await response.json()
//       // 3. const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } })
//       // 4. if (result.error) { onError(result.error); return; }
//       // 5. await recordDonation({ amount: getAmount(), fundraiserId, provider: 'stripe' })
//       // 6. onSuccess({ amount: getAmount() })
//     });
//   },
// };

// ── Public API ────────────────────────────────────────────────

const Payment = {
  /**
   * Render a payment button into the given container.
   * Same signature as PayPalProvider.render / StripeProvider.render above.
   */
  render(containerId, options) {
    if (ACTIVE_PROVIDER === 'paypal') {
      PayPalProvider.render(containerId, options);
    }
    // else if (ACTIVE_PROVIDER === 'stripe') {
    //   StripeProvider.render(containerId, options);
    // }
  },
};
