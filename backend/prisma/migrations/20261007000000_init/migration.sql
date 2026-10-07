-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "public"."ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "public"."CategoryType" AS ENUM ('BILL', 'EVENT');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('MANUAL', 'AUTOPAY', 'SCHEDULED_AUTOPAY');

-- CreateEnum
CREATE TYPE "public"."RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "public"."BillOccurrenceStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."EventOccurrenceStatus" AS ENUM ('UPCOMING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TokenType" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "email_verified_at" TIMESTAMP(3),
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_settings" (
    "user_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "theme" "public"."ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "week_starts_on" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "time_format" TEXT NOT NULL DEFAULT '12h',
    "default_calendar_view" TEXT NOT NULL DEFAULT 'dayGridMonth',
    "default_bill_reminders" INTEGER[] DEFAULT ARRAY[1440]::INTEGER[],
    "default_event_reminders" INTEGER[] DEFAULT ARRAY[60]::INTEGER[],
    "all_day_reminder_time" TEXT NOT NULL DEFAULT '09:00',
    "auto_complete_autopay" BOOLEAN NOT NULL DEFAULT true,
    "in_app_notifications" BOOLEAN NOT NULL DEFAULT true,
    "email_notifications" BOOLEAN NOT NULL DEFAULT false,
    "push_notifications" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "public"."TokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."CategoryType" NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bills" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "public"."PaymentMethod" NOT NULL DEFAULT 'MANUAL',
    "scheduled_pay_days_before" INTEGER,
    "start_date" DATE NOT NULL,
    "due_time" TEXT,
    "recurrence_frequency" "public"."RecurrenceFrequency",
    "recurrence_interval" INTEGER NOT NULL DEFAULT 1,
    "recurrence_by_weekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "recurrence_end_date" DATE,
    "recurrence_count" INTEGER,
    "reminder_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "generated_until" DATE,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bill_occurrences" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "original_due_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "due_time" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "public"."BillOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "amount_paid" DECIMAL(12,2),
    "confirmation_number" TEXT,
    "notes" TEXT,
    "scheduled_pay_date" DATE,
    "autopay_at" TIMESTAMP(3),
    "is_modified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "location" TEXT,
    "start_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "recurrence_frequency" "public"."RecurrenceFrequency",
    "recurrence_interval" INTEGER NOT NULL DEFAULT 1,
    "recurrence_by_weekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "recurrence_end_date" DATE,
    "recurrence_count" INTEGER,
    "reminder_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "generated_until" DATE,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_occurrences" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "original_date" DATE NOT NULL,
    "event_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "status" "public"."EventOccurrenceStatus" NOT NULL DEFAULT 'UPCOMING',
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "notes" TEXT,
    "is_modified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "bill_occurrence_id" UUID,
    "event_occurrence_id" UUID,
    "offset_minutes" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "public"."sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "public"."sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "public"."sessions"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "public"."verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_type_idx" ON "public"."verification_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "categories_user_id_type_idx" ON "public"."categories"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_type_name_key" ON "public"."categories"("user_id", "type", "name");

-- CreateIndex
CREATE INDEX "bills_user_id_is_archived_idx" ON "public"."bills"("user_id", "is_archived");

-- CreateIndex
CREATE INDEX "bills_category_id_idx" ON "public"."bills"("category_id");

-- CreateIndex
CREATE INDEX "bill_occurrences_user_id_due_date_idx" ON "public"."bill_occurrences"("user_id", "due_date");

-- CreateIndex
CREATE INDEX "bill_occurrences_user_id_status_due_date_idx" ON "public"."bill_occurrences"("user_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "bill_occurrences_status_due_at_idx" ON "public"."bill_occurrences"("status", "due_at");

-- CreateIndex
CREATE INDEX "bill_occurrences_status_autopay_at_idx" ON "public"."bill_occurrences"("status", "autopay_at");

-- CreateIndex
CREATE UNIQUE INDEX "bill_occurrences_bill_id_original_due_date_key" ON "public"."bill_occurrences"("bill_id", "original_due_date");

-- CreateIndex
CREATE INDEX "events_user_id_is_archived_idx" ON "public"."events"("user_id", "is_archived");

-- CreateIndex
CREATE INDEX "events_category_id_idx" ON "public"."events"("category_id");

-- CreateIndex
CREATE INDEX "event_occurrences_user_id_event_date_idx" ON "public"."event_occurrences"("user_id", "event_date");

-- CreateIndex
CREATE INDEX "event_occurrences_user_id_status_event_date_idx" ON "public"."event_occurrences"("user_id", "status", "event_date");

-- CreateIndex
CREATE INDEX "event_occurrences_status_start_at_idx" ON "public"."event_occurrences"("status", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_occurrences_event_id_original_date_key" ON "public"."event_occurrences"("event_id", "original_date");

-- CreateIndex
CREATE INDEX "notifications_user_id_channel_read_at_idx" ON "public"."notifications"("user_id", "channel", "read_at");

-- CreateIndex
CREATE INDEX "notifications_status_channel_scheduled_for_idx" ON "public"."notifications"("status", "channel", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_bill_occurrence_id_offset_minutes_channel_key" ON "public"."notifications"("bill_occurrence_id", "offset_minutes", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_event_occurrence_id_offset_minutes_channel_key" ON "public"."notifications"("event_occurrence_id", "offset_minutes", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "public"."push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "public"."audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "public"."audit_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bills" ADD CONSTRAINT "bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bills" ADD CONSTRAINT "bills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bill_occurrences" ADD CONSTRAINT "bill_occurrences_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bill_occurrences" ADD CONSTRAINT "bill_occurrences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_occurrences" ADD CONSTRAINT "event_occurrences_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_occurrences" ADD CONSTRAINT "event_occurrences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_bill_occurrence_id_fkey" FOREIGN KEY ("bill_occurrence_id") REFERENCES "public"."bill_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_event_occurrence_id_fkey" FOREIGN KEY ("event_occurrence_id") REFERENCES "public"."event_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Integrity constraints not expressible in the Prisma schema ───────────

-- Money is never negative.
ALTER TABLE "public"."bills" ADD CONSTRAINT "bills_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "public"."bill_occurrences" ADD CONSTRAINT "bill_occurrences_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "public"."bill_occurrences" ADD CONSTRAINT "bill_occurrences_amount_paid_non_negative" CHECK ("amount_paid" IS NULL OR "amount_paid" >= 0);

-- A completed occurrence always records when it was completed.
ALTER TABLE "public"."bill_occurrences" ADD CONSTRAINT "bill_occurrences_completed_has_date" CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL);
ALTER TABLE "public"."event_occurrences" ADD CONSTRAINT "event_occurrences_completed_has_date" CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL);

-- A notification belongs to at most one occurrence.
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_single_target" CHECK (NOT ("bill_occurrence_id" IS NOT NULL AND "event_occurrence_id" IS NOT NULL));

-- Recurrence sanity.
ALTER TABLE "public"."bills" ADD CONSTRAINT "bills_recurrence_interval_positive" CHECK ("recurrence_interval" >= 1);
ALTER TABLE "public"."events" ADD CONSTRAINT "events_recurrence_interval_positive" CHECK ("recurrence_interval" >= 1);
