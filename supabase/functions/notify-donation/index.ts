// Triggered by a Supabase Database Webhook on INSERT to the donations table.
// Sends an email notification to the site owner via Resend.
//
// Required secrets (set in Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY     — from resend.com
//   NOTIFICATION_EMAIL — the address you want donation alerts sent to

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    // Supabase DB webhook wraps the row in `record`
    const donation = payload.record ?? payload;

    const amount = parseFloat(donation.amount ?? 0);
    const name = donation.payer_name || 'Anonymous';
    const email = donation.payer_email || '—';
    const provider = (donation.provider ?? 'stripe').toUpperCase();
    const fundraiserId = donation.fundraiser_id ?? null;
    const createdAt = donation.created_at
      ? new Date(donation.created_at).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC'
      : new Date().toUTCString();

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const TO_EMAIL = Deno.env.get('NOTIFICATION_EMAIL');

    if (!RESEND_API_KEY || !TO_EMAIL) {
      console.error('Missing RESEND_API_KEY or NOTIFICATION_EMAIL secrets.');
      return new Response(JSON.stringify({ error: 'Email secrets not configured.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const subject = `💛 New donation — $${amount.toFixed(2)} from ${name}`;

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;background:#f3ede2;padding:32px;border-radius:12px;">
        <h2 style="color:#2c5c3a;margin:0 0 4px;">New donation received 🐾</h2>
        <p style="color:#666;font-size:14px;margin:0 0 24px;">${createdAt}</p>

        <table style="width:100%;border-collapse:collapse;font-size:15px;">
          <tr>
            <td style="padding:10px 0;color:#888;width:40%;">Amount</td>
            <td style="padding:10px 0;font-weight:700;color:#131d11;">$${amount.toFixed(2)}</td>
          </tr>
          <tr style="border-top:1px solid #ddd;">
            <td style="padding:10px 0;color:#888;">Donor</td>
            <td style="padding:10px 0;color:#131d11;">${name}</td>
          </tr>
          <tr style="border-top:1px solid #ddd;">
            <td style="padding:10px 0;color:#888;">Email</td>
            <td style="padding:10px 0;color:#131d11;">${email}</td>
          </tr>
          <tr style="border-top:1px solid #ddd;">
            <td style="padding:10px 0;color:#888;">Method</td>
            <td style="padding:10px 0;color:#131d11;">${provider}</td>
          </tr>
          ${fundraiserId ? `<tr style="border-top:1px solid #ddd;"><td style="padding:10px 0;color:#888;">Fundraiser</td><td style="padding:10px 0;color:#131d11;">#${fundraiserId}</td></tr>` : ''}
        </table>

        <p style="margin:24px 0 0;font-size:13px;color:#aaa;text-align:center;">Hellena Animal Rescue · animalresc.netlify.app</p>
      </div>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hellena Donations <donations@hellenarescue.org>',
        to: [TO_EMAIL],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return new Response(JSON.stringify({ error: err }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-donation error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
