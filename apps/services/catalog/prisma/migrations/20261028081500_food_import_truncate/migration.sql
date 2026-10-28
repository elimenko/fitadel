-- Hand-written: the import empties its staging table with TRUNCATE, which frees the space
-- at once (DELETE only marks rows dead until a vacuum). TRUNCATE isn't part of the
-- default privileges (tools/db/catalog.psql), so it's granted for this one table only;
-- the service still can't TRUNCATE food. The role is created by provisioning, which
-- runs before any migration.
GRANT TRUNCATE ON "food_import" TO catalog_app;
