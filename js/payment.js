// ─────────────────────────────────────────────────────────────
// payment.js — payment provider abstraction
//
// Active provider: PayPal
// To switch to Stripe: change ACTIVE_PROVIDER to 'stripe'
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

    // Email notification via Formspree
    fetch('https://formspree.io/f/xeerwzod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        name: payerName || 'Anonymous',
        email: payerEmail || 'not provided',
        _subject: `💛 New donation — $${parseFloat(amount).toFixed(2)} via ${provider.toUpperCase()}`,
        message: [
          `Amount: $${parseFloat(amount).toFixed(2)}`,
          `Donor: ${payerName || 'Anonymous'}`,
          `Email: ${payerEmail || '—'}`,
          `Method: ${provider.toUpperCase()}`,
          fundraiserId ? `Fundraiser ID: ${fundraiserId}` : 'General donation',
        ].join('\n'),
      }),
    }).catch(() => {}); // fire-and-forget, don't block the donation flow

    // Stats (fundraiser raised/donor_count and donation_stats) are updated
    // automatically by a Supabase database trigger on donations insert.
  } catch (e) {
    console.error('recordDonation error', e);
  }
}

// ── PayPal provider ───────────────────────────────────────────

const PayPalProvider = {
  render(containerId, { getAmount, description, fundraiserId = null, onSuccess, onError }) {
    paypal.Buttons({
      style: {
        label: 'donate',
      },
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

// ── Stripe provider ───────────────────────────────────────────
// Uses Stripe Payment Element — automatically shows the right payment methods
// for the customer's region: cards, Cash App Pay (US), ACH bank transfer (US),
// iDEAL (NL), SEPA (EU), Bancontact (BE), and more.

const StripeProvider = {
  render(containerId, { getAmount, description, fundraiserId = null, onSuccess, onError }) {
    const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    const getAmountCents = () => Math.round(parseFloat(getAmount() || 25) * 100);

    const elements = stripe.elements({
      mode: 'payment',
      amount: getAmountCents(),
      currency: 'usd',
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#2c5c3a',
          colorBackground: '#ffffff',
          colorText: '#131d11',
          colorDanger: '#e53e3e',
          fontFamily: "'DM Sans', sans-serif",
          borderRadius: '8px',
          spacingUnit: '4px',
        },
      },
    });

    const paymentElement = elements.create('payment');

    const container = document.getElementById(containerId);
    container.innerHTML = `
      <input id="stripe-name-${containerId}" type="text" placeholder="Your name (optional)" autocomplete="name"
        style="width:100%;padding:11px 13px;border:1.5px solid var(--border-mid);border-radius:var(--radius);font-family:var(--font);font-size:0.95rem;color:var(--text);background:white;box-sizing:border-box;margin-bottom:12px;outline:none;transition:border-color 0.2s;"
        onfocus="this.style.borderColor='var(--forest)'" onblur="this.style.borderColor='var(--border-mid)'">
      <div id="stripe-payment-${containerId}" style="margin-bottom:14px;"></div>
      <div id="stripe-error-${containerId}" style="display:none;color:#e53e3e;font-size:0.82rem;margin-bottom:10px;"></div>
      <button id="stripe-submit-${containerId}" style="width:100%;padding:13px;background:var(--forest);color:white;border:none;border-radius:var(--radius);font-family:var(--font);font-weight:700;font-size:0.95rem;cursor:pointer;transition:opacity 0.2s;letter-spacing:0.01em;">
        Donate Now
      </button>
    `;

    paymentElement.mount('#stripe-payment-' + containerId);

    // Keep amount in sync when the user changes it
    const amountInput = document.getElementById('donate-amount');
    if (amountInput) {
      amountInput.addEventListener('input', () => {
        const cents = getAmountCents();
        if (cents >= 100) elements.update({ amount: cents });
      });
    }

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
        const cents = Math.round(amount * 100);

        // Sync final amount, then validate the Payment Element
        await elements.update({ amount: cents });
        const { error: submitError } = await elements.submit();
        if (submitError) {
          errorDiv.textContent = submitError.message;
          errorDiv.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.textContent = 'Donate Now';
          return;
        }

        // Create payment intent on the server
        const res = await fetch(SUPABASE_URL + '/functions/v1/create-payment-intent', {
          method: 'POST',
          headers: { ...SUPABASE_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: cents, currency: 'usd', description }),
        });
        if (!res.ok) throw new Error('Could not initialize payment. Please try again.');
        const { clientSecret, error: fnError } = await res.json();
        if (fnError) throw new Error(fnError);

        // Build return URL for redirect-based methods (bank transfer, Cash App, etc.)
        const payerName = document.getElementById('stripe-name-' + containerId)?.value.trim() || null;
        const returnUrl = window.location.href.split('?')[0]
          + '?donated=1&amount=' + amount
          + (payerName ? '&name=' + encodeURIComponent(payerName) : '')
          + (fundraiserId ? '&fid=' + fundraiserId : '');

        const { error } = await stripe.confirmPayment({
          elements,
          clientSecret,
          confirmParams: { return_url: returnUrl },
          redirect: 'if_required', // only redirect when the method requires it
        });

        if (error) {
          errorDiv.textContent = error.message;
          errorDiv.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.textContent = 'Donate Now';
          onError(error);
        } else {
          // Completed without redirect (e.g. card, Cash App when already authorised)
          const payerName = document.getElementById('stripe-name-' + containerId)?.value.trim() || null;
          await recordDonation({ amount, fundraiserId, payerName, provider: 'stripe' });
          onSuccess({ amount, payerName });
        }
      } catch (e) {
        errorDiv.textContent = e.message || 'Something went wrong. Please try again.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.textContent = 'Donate Now';
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
