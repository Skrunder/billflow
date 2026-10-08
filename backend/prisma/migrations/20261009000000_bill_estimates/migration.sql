-- Estimated bill amounts (additive). A bill's amount can be marked as an
-- estimate; occurrences copy the flag like they copy the amount, and the
-- actual figure is recorded as amount_paid when the occurrence is completed.

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "amount_is_estimate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bill_occurrences" ADD COLUMN     "amount_is_estimate" BOOLEAN NOT NULL DEFAULT false;
