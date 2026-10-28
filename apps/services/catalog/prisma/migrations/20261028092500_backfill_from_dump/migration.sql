-- Hand-written: every Open Food Facts food so far came from an export, so the import may
-- retire it when it disappears from one (see food.from_dump)
UPDATE "food" SET "from_dump" = true WHERE "source" = 'off';
