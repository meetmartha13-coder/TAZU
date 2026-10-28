alter table public.rides add column if not exists payment_reference text;
create unique index if not exists rides_payment_reference_unique on public.rides(payment_reference) where payment_reference is not null;
comment on column public.rides.payment_reference is 'Paystack transaction reference assigned server-side.';