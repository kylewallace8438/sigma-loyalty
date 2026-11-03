-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `excluded` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pointsEarned` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `shopifyUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `state` ENUM('DISABLED', 'INVITED', 'ENABLED', 'DECLINED') NOT NULL DEFAULT 'DISABLED';

-- CreateTable
CREATE TABLE `PointHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `type` ENUM('EARN', 'REDEEM', 'ADJUST', 'REFUND', 'RETURN_CODE', 'EXPIRED') NOT NULL,
    `points` INTEGER NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PointHistory_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `PointHistory_shopId_createdAt_idx`(`shopId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreSettings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `programEnabled` BOOLEAN NOT NULL DEFAULT false,
    `pointsName` VARCHAR(50) NULL,
    `includeTax` BOOLEAN NOT NULL DEFAULT false,
    `rewardFulfilled` BOOLEAN NOT NULL DEFAULT true,
    `rewardGuests` BOOLEAN NOT NULL DEFAULT true,
    `refundEnabled` BOOLEAN NOT NULL DEFAULT true,
    `returnPointsOnRefund` BOOLEAN NOT NULL DEFAULT true,
    `pointExpirationEnabled` BOOLEAN NOT NULL DEFAULT false,
    `pointExpirationMonths` INTEGER NULL,

    UNIQUE INDEX `StoreSettings_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PointHistory` ADD CONSTRAINT `PointHistory_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PointHistory` ADD CONSTRAINT `PointHistory_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreSettings` ADD CONSTRAINT `StoreSettings_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Balances from before the ledger: one opening row each, so a balance always equals its ledger sum,
-- and count them as earned so VIP tiers start from them.
INSERT INTO `PointHistory` (`shopId`, `customerId`, `type`, `points`, `reason`)
SELECT `shopId`, `id`, 'ADJUST', `points`, 'Opening balance' FROM `Customer` WHERE `points` <> 0;
UPDATE `Customer` SET `pointsEarned` = GREATEST(`points`, 0);
