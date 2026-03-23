// ─────────────────────────────────────────────────────────────
// payment.js — payment provider abstraction
//
// Active provider: PayPal
// To switch to Stripe: change ACTIVE_PROVIDER to 'stripe'
// ─────────────────────────────────────────────────────────────

const ACTIVE_PROVIDER = 'paypal'; // 'paypal' | 'stripe'

// ── Supabase helpers ──────────────────────────────────────────

async function recordDonation({ amount, fundraiserId = null, payerName = null, payerEmail = null, provider, isRecurring = false }) {
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
        is_recurring: isRecurring,
      }),
    });

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
  render(containerId, { getAmount, getIsRecurring = () => false, description, fundraiserId = null, onSuccess, onError }) {
    paypal.Buttons({
      style: {
        label: 'donate',
      },
      createOrder(data, actions) {
        const recurring = getIsRecurring();
        return actions.order.create({
          purchase_units: [{
            description: recurring ? description + ' (Monthly)' : description,
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
          const isRecurring = getIsRecurring();
          await recordDonation({ amount, fundraiserId, payerName, payerEmail, provider: 'paypal', isRecurring });
          onSuccess({ amount, payerName, payerEmail });
        });
      },
      onError,
    }).render('#' + containerId);
  },
};

// ── Stripe provider ───────────────────────────────────────────

const StripeProvider = {
  render(containerId, { getAmount, getIsRecurring = () => false, description, fundraiserId = null, onSuccess, onError }) {
    const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    const elements = stripe.elements();
    const card = elements.create('card', {
      style: {
        base: {
          fontFamily: "'Nunito', sans-serif",
          fontSize: '15px',
          color: '#3d2b1f',
          '::placeholder': { color: '#b0957a' },
        },
        invalid: { color: '#e53e3e' },
      },
    });

    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div style="border:2px solid var(--border-mid);border-radius:var(--radius);padding:12px 14px;background:white;margin-bottom:12px;transition:border-color 0.2s;" id="stripe-card-wrap-${containerId}">
        <div id="stripe-card-${containerId}"></div>
      </div>
      <div id="stripe-error-${containerId}" style="display:none;color:#e53e3e;font-size:0.82rem;margin-bottom:10px;"></div>
      <button id="stripe-submit-${containerId}" style="width:100%;padding:12px;background:var(--green);color:white;border:none;border-radius:var(--radius);font-family:var(--font);font-weight:800;font-size:0.95rem;cursor:pointer;transition:opacity 0.2s;">
        💛 Donate with Card
      </button>
      <div style="text-align:center;font-size:0.78rem;color:var(--text-muted);margin-top:8px;">🔒 Secured by Stripe</div>
    `;

    card.mount('#stripe-card-' + containerId);

    card.on('focus', () => {
      const wrap = document.getElementById('stripe-card-wrap-' + containerId);
      if (wrap) wrap.style.borderColor = 'var(--green)';
    });
    card.on('blur', () => {
      const wrap = document.getElementById('stripe-card-wrap-' + containerId);
      if (wrap) wrap.style.borderColor = 'var(--border-mid)';
    });

    const submitBtn = document.getElementById('stripe-submit-' + containerId);
    const errorDiv = document.getElementById('stripe-error-' + containerId);

    submitBtn.addEventListener('click', async () => {
      const amount = parseFloat(getAmount() || 25);
      if (isNaN(amount) || amount < 1) {
        errorDiv.textContent = 'Please enter a valid amount (minimum $1).';
        errorDiv.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.6';
      submitBtn.textContent = 'Processing…';
      errorDiv.style.display = 'none';

      try {
        const res = await fetch(SUPABASE_URL + '/functions/v1/create-payment-intent', {
          method: 'POST',
          headers: { ...SUPABASE_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'usd', description }),
        });

        if (!res.ok) throw new Error('Could not initialize payment. Please try again.');
        const { clientSecret, error: fnError } = await res.json();
        if (fnError) throw new Error(fnError);

        const result = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card },
        });

        if (result.error) {
          errorDiv.textContent = result.error.message;
          errorDiv.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.textContent = '💛 Donate with Card';
          onError(result.error);
        } else {
          const isRecurring = getIsRecurring();
          await recordDonation({ amount, fundraiserId, provider: 'stripe', isRecurring });
          onSuccess({ amount, payerName: null });
        }
      } catch (e) {
        errorDiv.textContent = e.message || 'Something went wrong. Please try again.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.textContent = '💛 Donate with Card';
        onError(e);
      }
    });
  },
};

// ── Public API ────────────────────────────────────────────────

const Payment = {
  render(containerId, options) {
    if (ACTIVE_PROVIDER === 'paypal') {
      PayPalProvider.render(containerId, options);
    } else if (ACTIVE_PROVIDER === 'stripe') {
      StripeProvider.render(containerId, options);
    }
  },
};
