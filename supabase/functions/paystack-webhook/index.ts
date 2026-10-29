import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !service) return new Response("Server not configured", { status: 500 });

  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") || "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  if (!constantTimeEqual(sig, expected)) return new Response("Invalid signature", { status: 401 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (event.event !== "charge.success" || !event.data?.reference) return new Response("Ignored", { status: 200 });

  try {
    const reference = String(event.data.reference);
    const res = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
      headers: { Authorization: "Bearer " + secret }
    });
    const verified = await res.json().catch(() => ({}));
    const p = verified?.data;
    if (!res.ok || !verified?.status || p?.status !== "success") return new Response("Payment not verified", { status: 400 });

    const rideId = String(p.metadata?.ride_id || "");
    const passengerId = String(p.metadata?.passenger_id || "");
    if (!rideId || !passengerId || p.currency !== "NGN" || p.reference !== reference) {
      return new Response("Invalid metadata/currency/reference", { status: 400 });
    }

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: ride, error } = await admin.from("rides")
      .select("id,passenger_id,estimated_fare_ngn,payment_reference,payment_status,payment_method")
      .eq("id", rideId).maybeSingle();
    if (error) throw error;
    if (!ride || ride.passenger_id !== passengerId || ride.payment_reference !== reference) {
      return new Response("Ride/reference mismatch", { status: 400 });
    }
    if (Number(p.amount) !== Math.round(Number(ride.estimated_fare_ngn) * 100)) {
      return new Response("Amount mismatch", { status: 400 });
    }
    if (!["card", "bank_transfer"].includes(String(ride.payment_method)) || p.channel !== ride.payment_method) {
      return new Response("Payment channel mismatch", { status: 400 });
    }

    // Payment and ride lifecycle are separate: a valid late payment for a cancelled
    // ride is still recorded as paid and must be reviewed for a refund.
    if (ride.payment_status !== "paid") {
      const { error: updateError } = await admin.from("rides").update({ payment_status: "paid" })
        .eq("id", ride.id).eq("payment_reference", reference);
      if (updateError) throw updateError;
    }
    return new Response("Payment verified", { status: 200 });
  } catch (e) {
    console.error("Paystack webhook processing failed", e);
    return new Response("Webhook processing failed", { status: 500 });
  }
});

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
