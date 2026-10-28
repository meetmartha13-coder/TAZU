# TAZU

TAZU is an early-stage ride-hailing web prototype hosted on GitHub Pages with Supabase authentication and ride-request storage.

## Live prototype

- App: https://meetmartha13-coder.github.io/TAZU/
- Repository: https://github.com/meetmartha13-coder/TAZU
- Supabase project dashboard: https://supabase.com/dashboard/project/memypeagvjlwkxhtnzsg

## Current prototype features

- Passenger account creation and sign-in through Supabase Auth.
- Passenger ride requests saved in the Supabase `public.rides` table.
- Driver account sign-in and a list of unassigned ride requests, subject to the database's Row Level Security (RLS) policies.
- Driver accept, start-trip, and complete-trip controls for cloud rides, subject to RLS policies.
- Illustrative map and browser geolocation demonstration.
- A local-browser demo dispatch/earnings display that is separate from cloud rides.

## Before testing

1. In Supabase Auth URL Configuration, set the Site URL to `https://meetmartha13-coder.github.io/TAZU/` and add that URL to the allowed Redirect URLs.
2. Confirm the SQL schema and RLS policies in the Supabase project are installed.
3. Open the app and hard-refresh it (Ctrl+Shift+R on desktop) after GitHub Pages has deployed the latest commit.
4. Test with a passenger account first, submit a request, then sign in with a separate driver account and refresh live requests.
5. Try Accept, Start trip, and Complete trip. If an action fails, the message shown by the app may indicate a database permission or schema issue.

## Paystack integration setup (not yet live)

Payment integration source has been added under `supabase/functions/`. These files are **not deployed automatically by GitHub Pages**. Payment remains disabled until the following setup and end-to-end test are complete.

1. In the Supabase SQL Editor, run [the payment-reference migration](https://github.com/meetmartha13-coder/TAZU/blob/main/supabase/migrations/202610280001_paystack_payment_reference.sql).
2. In Supabase Edge Function Secrets, add `PAYSTACK_SECRET_KEY` using your Paystack **test secret key**. Never commit it to GitHub, put it in website JavaScript, or send it in chat.
3. Deploy `paystack-initialize` and `paystack-webhook` from the source in `supabase/functions/`. The webhook must be deployed without Supabase JWT verification because Paystack calls it; the function verifies Paystack's HMAC signature itself.
4. In Paystack dashboard, configure webhook URL: `https://memypeagvjlwkxhtnzsg.supabase.co/functions/v1/paystack-webhook`.
5. Verify the `rides.payment_status` check constraint permits `unpaid`, `pending`, `paid`, and `failed`. If not, update the constraint before testing.
6. Test card and bank transfer using Paystack test mode and confirm that the ride changes to `paid` only after the signed webhook and server-side transaction verification succeed.

The passenger screen now calls `paystack-initialize` and redirects to the returned Paystack checkout URL. This is not evidence that payment works until the functions, secret, schema, webhook, and callback are configured and tested.

### Deploying with Supabase CLI

From the repository root, after installing the Supabase CLI and linking the project:

```sh
supabase link --project-ref memypeagvjlwkxhtnzsg
supabase db push
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_REPLACE_WITH_YOUR_TEST_SECRET
supabase functions deploy paystack-initialize
supabase functions deploy paystack-webhook --no-verify-jwt
```

Replace the example secret locally with your real test secret; do not literally use the placeholder. Supabase's project URL and service-role environment variables must remain server-side.

## Security and launch limitations

**This is not production-ready and must not be used to transport real passengers or collect real payments yet.**

- A browser publishable key is expected in frontend code; never add a Supabase service-role/secret key to this repository.
- Database RLS is the security boundary. Do not assume that choosing “driver” in the UI verifies a driver. Driver identity/approval needs to be enforced server-side before public launch.
- The temporary ride-accept policy may allow any authenticated account to claim a request unless it is strengthened to verify an approved driver record. Review and tighten RLS before launch.
- Ride lifecycle changes must be protected by RLS or a database function; client-side checks alone are not security controls.
- Card/bank-transfer payment processing is not integrated. A selected payment method is stored as ride metadata only; no money is taken.
- Live driver GPS tracking, reliable matching, route/fare calculation, notifications, trip sharing, identity verification, refunds, and support workflows are not complete.
- The map route and demo earnings are illustrative. Local demo data is not the same as a real cloud transaction or payout.
- The app currently uses a non-caching service worker placeholder so it does not deliberately serve stale app files.

## Suggested next milestones

1. Confirm the accept/start/complete flow works with the intended RLS rules.
2. Add a trusted driver approval workflow and enforce it in the database.
3. Add passenger cloud ride history/status refresh.
4. Implement atomic ride acceptance with a database function and audit logging.
5. Add proper fare calculation, secure payment provider integration, and refunds.
6. Add location updates, proximity matching, notifications, support, privacy terms, and security testing before a public launch.
