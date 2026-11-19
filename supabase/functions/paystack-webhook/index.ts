import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !service) return new Response("Server not configured", { status: 500 });

  // Verify the exact raw request body before trusting any event fields.
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature") || "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!constantTimeEqual(signature, expected)) return new Response("Invalid signature", { status: 401 });

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.event !== "charge.success" || !event.data?.reference) {
    return new Response("Ignored", { status: 200 });
  }

  try {
    const reference = String(event.data.reference);
    const verifyResponse = await fetch(
      "https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference),
      { headers: { Authorization: "Bearer " + secret } },
    );
    const verification = await verifyResponse.json();
    const payment = verification.data;

    // Never mark a ride paid based only on the webhook payload.
    if (!verifyResponse.ok || !verification.status || payment?.status !== "success") {
      return new Response("Payment not verified", { status: 400 });
    }
    if (String(payment.reference) !== reference || payment.currency !== "NGN") {
      return new Response("Reference or currency mismatch", { status: 400 });
    }

    const rideId = String(payment.metadata?.ride_id || "");
    const passengerId = String(payment.metadata?.passenger_id || "");
    if (!rideId || !passengerId) return new Response("Invalid payment metadata", { status: 400 });

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: ride, error } = await admin
      .from("rides")
      .select("id,passenger_id,estimated_fare_ngn,payment_reference,payment_status,status")
      .eq("id", rideId)
      .maybeSingle();
    if (error) throw error;

    if (
      !ride ||
      ride.passenger_id !== passengerId ||
      ride.payment_reference !== reference
    ) {
      return new Response("Ride/reference mismatch", { status: 400 });
    }
    if (ride.status === "cancelled") return new Response("Cancelled ride requires refund review", { status: 409 });
    if (Number(payment.amount) !== Math.round(Number(ride.estimated_fare_ngn) * 100)) {
      return new Response("Amount mismatch", { status: 400 });
    }

    // Idempotent: Paystack may retry the same successful webhook.
    if (ride.payment_status !== "paid") {
      const { data: updated, error: updateError } = await admin
        .from("rides")
        .update({ payment_status: "paid" })
        .eq("id", ride.id)
        .eq("payment_reference", reference)
        .neq("status", "cancelled")
        .neq("payment_status", "paid")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return new Response("Ride changed while payment was being confirmed", { status: 409 });
    }

    return new Response("Payment verified", { status: 200 });
  } catch (error) {
    console.error("TAZU Paystack webhook error:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
});

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
