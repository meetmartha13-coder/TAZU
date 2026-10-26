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
