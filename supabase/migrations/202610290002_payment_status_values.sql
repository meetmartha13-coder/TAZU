-- Keep payment_status values aligned with the TAZU payment functions.
-- Only single-column CHECK constraints on payment_status are replaced; unrelated
-- ride constraints are left untouched. NOT VALID avoids blocking deployment on
-- legacy rows, while enforcing these values on new/updated rows.
DO $$
DECLARE
  status_att smallint;
  existing_constraint record;
BEGIN
  SELECT attnum
    INTO status_att
  FROM pg_attribute
  WHERE attrelid = 'public.rides'::regclass
    AND attname = 'payment_status'
    AND NOT attisdropped;

  IF status_att IS NULL THEN
    RAISE EXCEPTION 'public.rides.payment_status was not found; inspect the base schema before applying TAZU payment migrations.';
  END IF;

  FOR existing_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.rides'::regclass
      AND contype = 'c'
      AND conkey = ARRAY[status_att]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.rides DROP CONSTRAINT %I', existing_constraint.conname);
  END LOOP;

  ALTER TABLE public.rides
    DROP CONSTRAINT IF EXISTS rides_payment_status_values_check;

  ALTER TABLE public.rides
    ADD CONSTRAINT rides_payment_status_values_check
    CHECK (
      payment_status IS NULL
      OR payment_status::text IN ('unpaid', 'pending', 'paid', 'failed')
    ) NOT VALID;
END $$;
