// ─────────────────────────────────────────────────────────────
// payment.js — payment provider abstraction
//
// Active provider: Stripe (Payment Element)
// Supports: Apple Pay · Google Pay · Cash App Pay · Cards · Link
// To switch to PayPal: change ACTIVE_PROVIDER to 'paypal'
// ─────────────────────────────────────────────────────────────

const ACTIVE_PROVIDER = 'stripe'; // 'paypal' | 'stripe'

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

// ── Stripe provider (Payment Element) ────────────────────────

const StripeProvider = {
  render(containerId, { getAmount, description, fundraiserId = null, onSuccess, onError }) {
    const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    let debounceTimer = null;

    const params = new URLSearchParams(window.location.search);
    const redirectSecret = params.get('payment_intent_client_secret');
    if (redirectSecret) {
      stripe.retrievePaymentIntent(redirectSecret).then(async ({ paymentIntent }) => {
        if (paymentIntent && paymentIntent.status === 'succeeded') {
          const amount = paymentIntent.amount / 100;
          await recordDonation({ amount, fundraiserId, provider: 'stripe' });
          onSuccess({ amount });
          window.history.replaceState({}, '', window.location.pathname);
        }
      });
      return;
    }

    async function initialize() {
      const amount = parseFloat(getAmount() || 25);
      if (isNaN(amount) || amount < 1) return;

      const container = document.getElementById(containerId);
      if (!container) return;

      container.innerHTML = `
        <div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:0.85rem;">
          Loading payment options…
        </div>`;

      try {
        const res = await fetch(SUPABASE_URL + '/functions/v1/create-payment-intent', {
          method: 'POST',
          headers: { ...SUPABASE_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'usd', description }),
        });

        // Read the body regardless of status so we can show the real error
        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data?.error || `Server error ${res.status}`);
        }

        const { clientSecret } = data;

        const elements = stripe.elements({
          clientSecret,
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#4a7c59',
              colorBackground: '#ffffff',
              colorText: '#3d2b1f',
              colorTextSecondary: '#7a5c44',
              colorDanger: '#e53e3e',
              fontFamily: "'Nunito', sans-serif",
              borderRadius: '8px',
              spacingUnit: '4px',
            },
            rules: {
              '.Input': { border: '2px solid #e0cfc0', boxShadow: 'none' },
              '.Input:focus': { border: '2px solid #4a7c59', boxShadow: 'none' },
              '.Tab': { border: '2px solid #e0cfc0' },
              '.Tab--selected': { border: '2px solid #4a7c59', boxShadow: 'none' },
            },
          },
        });

        const paymentEl = elements.create('payment', {
          layout: { type: 'tabs', defaultCollapsed: false },
          wallets: { applePay: 'auto', googlePay: 'auto' },
        });

        container.innerHTML = `
          <div id="stripe-pe-${containerId}" style="margin-bottom:14px;"></div>
          <div id="stripe-err-${containerId}" style="display:none;color:#e53e3e;font-size:0.82rem;margin-bottom:10px;padding:8px 12px;background:#fff5f5;border-radius:6px;"></div>
          <button id="stripe-btn-${containerId}" style="width:100%;padding:13px;background:var(--green);color:white;border:none;border-radius:var(--radius);font-family:var(--font);font-weight:800;font-size:1rem;cursor:pointer;transition:opacity 0.2s;letter-spacing:0.01em;">
            Donate $${amount.toFixed(2)}
          </button>
          <div style="text-align:center;font-size:0.76rem;color:var(--text-muted);margin-top:8px;">
            🔒 Secured by Stripe &nbsp;·&nbsp; Apple Pay &nbsp;·&nbsp; Google Pay &nbsp;·&nbsp; Cards
          </div>`;

        paymentEl.mount('#stripe-pe-' + containerId);

        const btn = document.getElementById('stripe-btn-' + containerId);
        const errDiv = document.getElementById('stripe-err-' + containerId);

        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.style.opacity = '0.6';
          btn.textContent = 'Processing…';
          errDiv.style.display = 'none';

          const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: window.location.href },
            redirect: 'if_required',
          });

          if (error) {
            errDiv.textContent = error.message;
            errDiv.style.display = 'block';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.textContent = `Donate $${amount.toFixed(2)}`;
            onError(error);
          } else {
            await recordDonation({ amount, fundraiserId, provider: 'stripe' });
            onSuccess({ amount });
          }
        });

      } catch (e) {
        const c = document.getElementById(containerId);
        if (c) c.innerHTML = `
          <div style="color:#e53e3e;font-size:0.85rem;padding:12px 0;">
            ${e.message || 'Payment unavailable. Please try again.'}
          </div>`;
        onError(e);
      }
    }

    initialize();

    const amountInput = document.getElementById('donate-amount');
    if (amountInput) {
      amountInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(initialize, 700);
      });
    }

    document.querySelectorAll('.amount-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(initialize, 100);
      });
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
