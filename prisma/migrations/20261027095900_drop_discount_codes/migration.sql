-- DropForeignKey
ALTER TABLE `DiscountCode` DROP FOREIGN KEY `DiscountCode_ruleId_fkey`;

-- DropForeignKey
ALTER TABLE `DiscountCode` DROP FOREIGN KEY `DiscountCode_shopId_fkey`;

-- DropTable
DROP TABLE `DiscountCode`;

