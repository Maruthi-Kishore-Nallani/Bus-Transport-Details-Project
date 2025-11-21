-- Idempotent SQL to migrate AvailabilityLog table to include `contact` and `requested`
-- and to populate date/time columns from createdAt. Safe to run multiple times.

BEGIN;

-- Add contact column (text) if missing
ALTER TABLE "AvailabilityLog" ADD COLUMN IF NOT EXISTS contact text;

-- Copy existing email into contact when contact is null or empty
-- If email column exists, copy its values; otherwise skip.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='AvailabilityLog' AND column_name='email') THEN
    UPDATE "AvailabilityLog" SET contact = COALESCE(email, '') WHERE contact IS NULL OR contact = '';
  END IF;
END$$;

-- Add requested boolean column if missing
ALTER TABLE "AvailabilityLog" ADD COLUMN IF NOT EXISTS requested boolean DEFAULT false;

-- Migrate request flag stored as prefix in location: '__REQ__YES__||...'
-- Set requested=true where the prefix exists, and strip the prefix from location
UPDATE "AvailabilityLog"
SET requested = true
WHERE location LIKE '__REQ__YES__||%';

UPDATE "AvailabilityLog"
SET location = REPLACE(location, '__REQ__YES__||', '')
WHERE location LIKE '__REQ__YES__||%';

-- Add date and time columns if they don't exist, then populate from createdAt
ALTER TABLE "AvailabilityLog" ADD COLUMN IF NOT EXISTS log_date date;
ALTER TABLE "AvailabilityLog" ADD COLUMN IF NOT EXISTS log_time time;

UPDATE "AvailabilityLog" SET log_date = createdAt::date WHERE log_date IS NULL;
UPDATE "AvailabilityLog" SET log_time = createdAt::time WHERE log_time IS NULL;

COMMIT;

-- Note: This script leaves an existing `email` column intact (if present) for compatibility.
-- After running this, consider updating application code to use `contact` and `requested` fields.
