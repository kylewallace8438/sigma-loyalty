-- AlterTable
ALTER TABLE `DiscountRule` ADD COLUMN `collections` JSON NULL,
    ADD COLUMN `combinesWithOrder` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `combinesWithProduct` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `combinesWithShipping` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `expiresInDays` INTEGER NULL,
    ADD COLUMN `maxPoints` INTEGER NULL,
    ADD COLUMN `maxShippingFee` DECIMAL(10, 2) NULL,
    ADD COLUMN `minPoints` INTEGER NULL,
    ADD COLUMN `perCustomerLimit` INTEGER NULL,
    ADD COLUMN `product` JSON NULL,
    ADD COLUMN `spendMode` ENUM('FIXED', 'INCREMENT') NOT NULL DEFAULT 'FIXED',
    MODIFY `discountType` ENUM('FIXED_AMOUNT', 'PERCENTAGE', 'FREE_SHIPPING', 'FREE_PRODUCT') NOT NULL;

-- AlterTable
ALTER TABLE `RedeemHistory` ADD COLUMN `code` VARCHAR(32) NULL,
    ADD COLUMN `discountRuleId` INTEGER NULL,
    ADD COLUMN `discountValue` DECIMAL(10, 2) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `title` VARCHAR(255) NULL,
    ADD COLUMN `usedAt` DATETIME(3) NULL,
    ADD COLUMN `usedOrderId` BIGINT NULL;

-- CreateIndex
CREATE INDEX `RedeemHistory_shopId_code_idx` ON `RedeemHistory`(`shopId`, `code`);

-- CreateIndex
CREATE INDEX `RedeemHistory_discountRuleId_idx` ON `RedeemHistory`(`discountRuleId`);

-- AddForeignKey
ALTER TABLE `RedeemHistory` ADD CONSTRAINT `RedeemHistory_discountRuleId_fkey` FOREIGN KEY (`discountRuleId`) REFERENCES `DiscountRule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

