-- Ensure a failed transaction can be represented when payment_status is a PostgreSQL enum.
-- This migration is separate from the constraint migration so the new enum value
-- is committed before a later migration uses it.
DO $$
DECLARE
  status_kind "char";
  status_schema text;
  status_type text;
BEGIN
  SELECT t.typtype, n.nspname, t.typname
    INTO status_kind, status_schema, status_type
  FROM pg_attribute a
  JOIN pg_type t ON t.oid = a.atttypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE a.attrelid = 'public.rides'::regclass
    AND a.attname = 'payment_status'
    AND NOT a.attisdropped;

  IF status_kind IS NULL THEN
    RAISE EXCEPTION 'public.rides.payment_status was not found; inspect the base schema before applying TAZU payment migrations.';
  END IF;

  IF status_kind = 'e' THEN
    EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', status_schema, status_type, 'failed');
  END IF;
END $$;
