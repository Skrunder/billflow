-- Sync support for the Android app (additive; see docs/API.md "Sync").
--   * sync_xid on every synced table, stamped by a trigger with the writing
--     transaction's id. Pulls return rows newer than the device's cursor and
--     use the snapshot xmin as the next cursor, so a slow transaction that
--     commits late is never skipped.
--   * sync_tombstones: an AFTER DELETE trigger records every deleted synced row.
--   * status_changed_at on occurrences (status conflicts are decided by it).

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "sync_xid" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "bill_occurrences" ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "sync_xid" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "sync_xid" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "sync_xid" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "event_occurrences" ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "sync_xid" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "sync_xid" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "sync_xid" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "session_family_id" UUID NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_tombstones" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "sync_xid" BIGINT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_batches" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_session_family_id_key" ON "devices"("session_family_id");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "sync_tombstones_user_id_sync_xid_idx" ON "sync_tombstones"("user_id", "sync_xid");

-- CreateIndex
CREATE INDEX "sync_tombstones_deleted_at_idx" ON "sync_tombstones"("deleted_at");

-- CreateIndex
CREATE INDEX "sync_batches_created_at_idx" ON "sync_batches"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_sync_xid_idx" ON "audit_logs"("user_id", "sync_xid");

-- CreateIndex
CREATE INDEX "bill_occurrences_user_id_sync_xid_idx" ON "bill_occurrences"("user_id", "sync_xid");

-- CreateIndex
CREATE INDEX "bills_user_id_sync_xid_idx" ON "bills"("user_id", "sync_xid");

-- CreateIndex
CREATE INDEX "categories_user_id_sync_xid_idx" ON "categories"("user_id", "sync_xid");

-- CreateIndex
CREATE INDEX "event_occurrences_user_id_sync_xid_idx" ON "event_occurrences"("user_id", "sync_xid");

-- CreateIndex
CREATE INDEX "events_user_id_sync_xid_idx" ON "events"("user_id", "sync_xid");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing finished occurrences: their status was set when they were completed / skipped / cancelled.
UPDATE "bill_occurrences" SET "status_changed_at" = COALESCE("completed_at", "updated_at") WHERE "status" <> 'PENDING';
UPDATE "event_occurrences" SET "status_changed_at" = COALESCE("completed_at", "cancelled_at", "updated_at") WHERE "status" <> 'UPCOMING';

-- Change tracking ---------------------------------------------------------

CREATE FUNCTION "skr_stamp_sync_xid"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."sync_xid" := pg_current_xact_id()::text::bigint;
  RETURN NEW;
END
$$;

CREATE FUNCTION "skr_record_tombstone"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "sync_tombstones" ("user_id", "entity_type", "entity_id", "sync_xid")
  VALUES (OLD."user_id", TG_ARGV[0], OLD."id"::text, pg_current_xact_id()::text::bigint);
  RETURN OLD;
END
$$;

CREATE TRIGGER "user_settings_sync_xid" BEFORE INSERT OR UPDATE ON "user_settings" FOR EACH ROW EXECUTE FUNCTION "skr_stamp_sync_xid"();
CREATE TRIGGER "categories_sync_xid" BEFORE INSERT OR UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION "skr_stamp_sync_xid"();
CREATE TRIGGER "bills_sync_xid" BEFORE INSERT OR UPDATE ON "bills" FOR EACH ROW EXECUTE FUNCTION "skr_stamp_sync_xid"();
CREATE TRIGGER "bill_occurrences_sync_xid" BEFORE INSERT OR UPDATE ON "bill_occurrences" FOR EACH ROW EXECUTE FUNCTION "skr_stamp_sync_xid"();
CREATE TRIGGER "events_sync_xid" BEFORE INSERT OR UPDATE ON "events" FOR EACH ROW EXECUTE FUNCTION "skr_stamp_sync_xid"();
CREATE TRIGGER "event_occurrences_sync_xid" BEFORE INSERT OR UPDATE ON "event_occurrences" FOR EACH ROW EXECUTE FUNCTION "skr_stamp_sync_xid"();
CREATE TRIGGER "audit_logs_sync_xid" BEFORE INSERT OR UPDATE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "skr_stamp_sync_xid"();

CREATE TRIGGER "categories_tombstone" AFTER DELETE ON "categories" FOR EACH ROW EXECUTE FUNCTION "skr_record_tombstone"('categories');
CREATE TRIGGER "bills_tombstone" AFTER DELETE ON "bills" FOR EACH ROW EXECUTE FUNCTION "skr_record_tombstone"('bills');
CREATE TRIGGER "bill_occurrences_tombstone" AFTER DELETE ON "bill_occurrences" FOR EACH ROW EXECUTE FUNCTION "skr_record_tombstone"('billOccurrences');
CREATE TRIGGER "events_tombstone" AFTER DELETE ON "events" FOR EACH ROW EXECUTE FUNCTION "skr_record_tombstone"('events');
CREATE TRIGGER "event_occurrences_tombstone" AFTER DELETE ON "event_occurrences" FOR EACH ROW EXECUTE FUNCTION "skr_record_tombstone"('eventOccurrences');
