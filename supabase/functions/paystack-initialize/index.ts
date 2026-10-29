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
    if (!auth) return reply({ error: "Sign in before paying." }, 401);
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
    if (ride.status === "cancelled" || ride.payment_status === "paid") {
      return reply({ error: "This ride cannot start another payment in its current state.", payment_status: ride.payment_status }, 409);
    }
    if (!["requested", "accepted", "in_progress", "completed"].includes(String(ride.status))) {
      return reply({ error: "This ride is not in a payable state." }, 409);
    }
    if (!["card", "bank_transfer"].includes(String(ride.payment_method))) {
      return reply({ error: "Choose card or bank transfer before paying." }, 400);
    }

    const fare = Number(ride.estimated_fare_ngn);
    if (!Number.isInteger(fare) || fare <= 0) return reply({ error: "Invalid ride fare." }, 400);
    const expectedChannel = String(ride.payment_method);
    let retryReference = "";

    // Never replace a still-pending reference: a delayed card/bank-transfer success
    // could otherwise arrive for an older reference after the ride has a new one.
    if (["pending", "failed"].includes(String(ride.payment_status)) && ride.payment_reference) {
      const check = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ride.payment_reference), {
        headers: { Authorization: "Bearer " + secret }
      });
      const verified = await check.json().catch(() => ({}));
      const tx = verified?.data;

      if (check.ok && verified?.status && tx?.status === "success") {
        const valid = tx.reference === ride.payment_reference &&
          tx.currency === "NGN" &&
          Number(tx.amount) === fare * 100 &&
          String(tx.metadata?.ride_id || "") === String(ride.id) &&
          String(tx.metadata?.passenger_id || "") === String(user.id) &&
          tx.channel === expectedChannel;
        if (!valid) return reply({ error: "Paystack returned a transaction that does not match this ride. Do not pay again; contact support.", payment_status: "pending" }, 409);
        const { error: paidErr } = await admin.from("rides").update({ payment_status: "paid" })
          .eq("id", ride.id).eq("payment_reference", ride.payment_reference);
        if (paidErr) throw paidErr;
        return reply({ already_paid: true, payment_status: "paid", ride_id: ride.id, reference: ride.payment_reference });
      } else if (check.ok && verified?.status && ["failed", "abandoned"].includes(String(tx?.status))) {
        if (ride.payment_status === "pending") {
          const { data: failed, error: failedErr } = await admin.from("rides").update({ payment_status: "failed" })
            .eq("id", ride.id).eq("payment_reference", ride.payment_reference).eq("payment_status", "pending")
            .select("id").maybeSingle();
          if (failedErr) throw failedErr;
          if (!failed) return reply({ error: "Payment status changed while checking. Refresh the ride and try again.", payment_status: ride.payment_status }, 409);
        }
        ride.payment_status = "failed";
      } else if (check.status === 404 && ride.payment_status === "pending") {
        // The database reference may have been saved just before a network interruption.
        // Re-initialize only with that same reference, never a new one.
        retryReference = ride.payment_reference;
      } else if (check.status === 404 && ride.payment_status === "failed") {
        // The old failed reference has no transaction; a fresh reference is safe.
      } else if (["ongoing", "pending", "processing"].includes(String(tx?.status))) {
        // Paystack still has an active transaction even if a prior request recorded failed.
        if (ride.payment_status !== "pending") {
          const { error: pendingErr } = await admin.from("rides").update({ payment_status: "pending" })
            .eq("id", ride.id).eq("payment_reference", ride.payment_reference).neq("payment_status", "paid");
          if (pendingErr) throw pendingErr;
        }
        return reply({
          error: "A payment attempt is still pending with Paystack. Check its status before starting another payment.",
          payment_status: "pending"
        }, 409);
      } else {
        return reply({
          error: "A payment attempt is still pending with Paystack. Check its status before starting another payment.",
          payment_status: "pending"
        }, 409);
      }
    }

    const reference = retryReference || ("tazu-" + ride.id + "-" + crypto.randomUUID().replaceAll("-", ""));
    let claim = admin.from("rides").update({ payment_status: "pending", payment_reference: reference }).eq("id", ride.id);
    claim = ride.payment_status == null ? claim.is("payment_status", null) : claim.eq("payment_status", ride.payment_status);
    claim = ride.payment_reference ? claim.eq("payment_reference", ride.payment_reference) : claim.is("payment_reference", null);
    const { data: saved, error: saveErr } = await claim.select("id").maybeSingle();
    if (saveErr) throw saveErr;
    if (!saved) return reply({ error: "Another payment attempt may have started. Refresh and check payment status before retrying." }, 409);

    const pay = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        amount: fare * 100,
        currency: "NGN",
        reference,
        channels: [expectedChannel],
        callback_url: "https://meetmartha13-coder.github.io/TAZU/?payment=return",
        metadata: { ride_id: ride.id, passenger_id: user.id }
      })
    });
    const result = await pay.json().catch(() => ({}));
    if (!pay.ok || !result?.status || !result.data?.authorization_url) {
      if (retryReference) {
        // Reusing a saved reference can return a duplicate-reference response if Paystack
        // already has the transaction. Keep it pending until verification resolves it.
        return reply({ error: "Could not safely resume the existing payment. Its status remains pending; check again before retrying." }, 409);
      }
      const { data: failed, error: failErr } = await admin.from("rides").update({ payment_status: "failed" })
        .eq("id", ride.id).eq("payment_reference", reference).eq("payment_status", "pending")
        .select("id").maybeSingle();
      if (failErr) throw failErr;
      if (!failed) return reply({ error: "Paystack initialization failed and the payment state changed. Refresh before retrying." }, 409);
      return reply({ error: result?.message || "Paystack initialization failed." }, 502);
    }
    return reply({ authorization_url: result.data.authorization_url, reference, ride_id: ride.id });
  } catch (e) {
    // If the network outcome is uncertain, leave the reference pending so a retry
    // verifies the same transaction rather than risking a duplicate charge.
    return reply({ error: e instanceof Error ? e.message : "Unexpected payment error." }, 500);
  }
});
