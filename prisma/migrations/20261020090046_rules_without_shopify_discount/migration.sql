-- Discount rules no longer create Shopify discounts (discount codes do).

-- The (shopId, code) unique index currently backs the shopId foreign key, so add a plain index first.
CREATE INDEX `DiscountRule_shopId_idx` ON `DiscountRule`(`shopId`);

-- DropIndex
DROP INDEX `DiscountRule_shopId_code_key` ON `DiscountRule`;
DROP INDEX `DiscountRule_shopifyDiscountId_key` ON `DiscountRule`;

-- AlterTable
ALTER TABLE `DiscountRule` DROP COLUMN `code`,
    DROP COLUMN `startsAt`,
    DROP COLUMN `endsAt`,
    DROP COLUMN `shopifyDiscountId`,
    DROP COLUMN `syncedAt`;
