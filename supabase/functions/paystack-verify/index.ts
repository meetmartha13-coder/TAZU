import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!url || !anon || !service || !secret) return reply({ error: "Payment service is not configured." }, 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return reply({ error: "Sign in before checking payment." }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return reply({ error: "Please sign in again." }, 401);

    const body = await req.json();
    const rideId = String(body.ride_id || "");
    if (!rideId) return reply({ error: "ride_id is required." }, 400);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: ride, error } = await admin.from("rides")
      .select("id,passenger_id,estimated_fare_ngn,payment_method,payment_status,payment_reference,status")
      .eq("id", rideId).maybeSingle();
    if (error) throw error;
    if (!ride || ride.passenger_id !== user.id) return reply({ error: "Ride not found for this passenger." }, 404);
    if (ride.payment_status === "paid") return reply({ payment_status: "paid", ride_id: ride.id });
    if (!ride.payment_reference) return reply({ payment_status: ride.payment_status || "unpaid", ride_id: ride.id });
    if (!["card", "bank_transfer"].includes(String(ride.payment_method))) {
      return reply({ error: "The saved payment method is not supported." }, 409);
    }

    const res = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ride.payment_reference), {
      headers: { Authorization: "Bearer " + secret }
    });
    const verified = await res.json().catch(() => ({}));
    const p = verified?.data;

    // A missing reference can occur if the browser lost the initialize response.
    // The initializer will retry using this same reference, avoiding duplicate references.
    if (res.status === 404) {
      return reply({ payment_status: "failed", retry_safe: true, message: "No transaction exists for this reference yet; a safe retry will reuse the same reference." });
    }
    // Other missing/unavailable responses are not proof of failure.
    if (!res.ok || !verified?.status || !p) {
      return reply({ payment_status: ride.payment_status || "pending", message: "Paystack has not confirmed a final result yet." });
    }

    if (p.reference !== ride.payment_reference) return reply({ error: "Paystack reference mismatch. Do not pay again." }, 409);

    if (p.status === "success") {
      const fare = Number(ride.estimated_fare_ngn);
      const valid = p.currency === "NGN" &&
        Number.isInteger(fare) && fare > 0 &&
        Number(p.amount) === fare * 100 &&
        String(p.metadata?.ride_id || "") === String(ride.id) &&
        String(p.metadata?.passenger_id || "") === String(user.id) &&
        p.channel === ride.payment_method;
      if (!valid) return reply({ error: "The transaction does not match this ride. Do not pay again; contact support." }, 409);

      const { error: updateError } = await admin.from("rides").update({ payment_status: "paid" })
        .eq("id", ride.id).eq("payment_reference", ride.payment_reference);
      if (updateError) throw updateError;
      return reply({ payment_status: "paid", ride_id: ride.id, reference: ride.payment_reference });
    }

    if (["failed", "abandoned"].includes(String(p.status))) {
      const { data: failed, error: updateError } = await admin.from("rides").update({ payment_status: "failed" })
        .eq("id", ride.id).eq("payment_reference", ride.payment_reference).neq("payment_status", "paid")
        .select("payment_status").maybeSingle();
      if (updateError) throw updateError;
      if (!failed) {
        const { data: latest, error: latestError } = await admin.from("rides").select("payment_status")
          .eq("id", ride.id).eq("payment_reference", ride.payment_reference).maybeSingle();
        if (latestError) throw latestError;
        if (latest?.payment_status === "paid") return reply({ payment_status: "paid", ride_id: ride.id });
      }
      return reply({ payment_status: "failed", ride_id: ride.id, message: "Paystack confirmed this payment attempt did not complete. You can try again." });
    }

    if (["ongoing", "pending", "processing"].includes(String(p.status))) {
      if (ride.payment_status !== "paid" && ride.payment_status !== "pending") {
        const { error: pendingError } = await admin.from("rides").update({ payment_status: "pending" })
          .eq("id", ride.id).eq("payment_reference", ride.payment_reference).neq("payment_status", "paid");
        if (pendingError) throw pendingError;
      }
      return reply({ payment_status: "pending", ride_id: ride.id, message: "Payment is still pending. Do not start another attempt yet." });
    }

    return reply({ payment_status: "pending", ride_id: ride.id, message: "Paystack has not confirmed a final result. Do not start another attempt yet." });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "Unexpected verification error." }, 500);
  }
});
