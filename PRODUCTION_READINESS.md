# TAZU production launch readiness

This checklist is the release gate for moving TAZU from its current hosted prototype to a safe public pilot. Do not represent the service as production-ready until every launch blocker below is verified.

## Release blockers

- [ ] **Supabase environment:** verify the project URL, publishable key, Auth redirect URLs, RLS policies, and database schema in the existing project.
- [ ] **Payment deployment:** confirm both Edge Functions are deployed from the repository's current source. Confirm `PAYSTACK_SECRET_KEY` exists in Supabase Function Secrets without exposing its value.
- [ ] **Webhook delivery:** deploy `paystack-webhook` with JWT verification disabled; Paystack webhook URL must be `https://memypeagvjlwkxhtnzsg.supabase.co/functions/v1/paystack-webhook`. Confirm a signed Paystack event reaches the function and updates only the matching ride/reference after server-side transaction verification.
- [ ] **Payment retry safety:** ensure a retry cannot invalidate a still-pending Paystack reference or allow an old transaction to mark a newer attempt paid. Handle duplicate webhook deliveries idempotently.
- [ ] **Driver approval:** enforce driver approval in the database/server, not by trusting a role or button in browser code. Unapproved accounts must not see or accept passenger requests.
- [ ] **Atomic ride assignment:** move acceptance to a database function/transaction that assigns a requested ride to at most one approved driver.
- [ ] **Ride state authorization:** enforce allowed transitions server-side: requested → accepted → in_progress → completed, with permitted cancellation rules. Only the assigned approved driver and authorized passenger/admin actions may change relevant fields.
- [ ] **Fare integrity:** calculate and validate fare and commission on a trusted server/database path. Never trust a fare or commission supplied by the browser for payment settlement.
- [ ] **Real operations:** replace illustrative route, driver presence, location, matching, earnings, and payout displays with verified live data before presenting them as operational features.
- [ ] **Privacy and safety:** publish privacy/terms, define location retention and consent, add support and incident handling, and document driver identity/vehicle checks.
- [ ] **End-to-end testing:** test passenger and approved driver accounts separately, card and bank transfer in Paystack test mode, webhook retries, failed/cancelled payments, concurrent driver acceptance, and all ride transitions.
- [ ] **Production release:** only after the above checks pass, configure production payment credentials securely, verify provider requirements, deploy, and monitor.

## Known current limitations from source review

- The current web app labels itself as a prototype.
- The map route and some driver earnings/online indicators are illustrative/local-browser demonstrations.
- The browser client contains direct ride updates; database policies are therefore critical.
- Paystack Edge Function source exists in the repository, but GitHub Pages does not deploy Supabase functions.
- The webhook source verifies Paystack's signature, verifies the transaction server-side, and matches ride, passenger, reference, currency, and amount. Deployment and actual delivery still need independent confirmation.
- The payment initializer currently writes a new pending reference before contacting Paystack. Retry behavior must be reviewed so an older in-flight payment cannot become detached from the ride.

## Safe release rule

Do not remove prototype/test warnings, accept real passenger bookings, or collect live money until every release blocker has been tested and signed off. Existing user data and the current `main` branch must be preserved during hardening.
