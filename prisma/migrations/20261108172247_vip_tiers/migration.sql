-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `tierAchievedAt` DATETIME(3) NULL,
    ADD COLUMN `tierExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `tierId` INTEGER NULL;

-- AlterTable
ALTER TABLE `EarningRule` MODIFY `type` ENUM('PLACE_ORDER', 'CREATE_ACCOUNT', 'NEWSLETTER', 'BIRTHDAY', 'COMPLETE_PROFILE', 'REFERRER', 'REFERRED_FRIEND', 'FOLLOW_INSTAGRAM', 'FOLLOW_X', 'SHARE_ON_X', 'RETWEET', 'LIKE_ON_FACEBOOK', 'SHARE_ON_FACEBOOK', 'JOIN_FACEBOOK_GROUP', 'FOLLOW_TIKTOK', 'FOLLOW_LINKEDIN', 'SHARE_ON_LINKEDIN', 'SUBSCRIBE_YOUTUBE', 'FOLLOW_PINTEREST', 'VIP_BONUS') NOT NULL;

-- AlterTable
ALTER TABLE `PointHistory` MODIFY `earningType` ENUM('PLACE_ORDER', 'CREATE_ACCOUNT', 'NEWSLETTER', 'BIRTHDAY', 'COMPLETE_PROFILE', 'REFERRER', 'REFERRED_FRIEND', 'FOLLOW_INSTAGRAM', 'FOLLOW_X', 'SHARE_ON_X', 'RETWEET', 'LIKE_ON_FACEBOOK', 'SHARE_ON_FACEBOOK', 'JOIN_FACEBOOK_GROUP', 'FOLLOW_TIKTOK', 'FOLLOW_LINKEDIN', 'SHARE_ON_LINKEDIN', 'SUBSCRIBE_YOUTUBE', 'FOLLOW_PINTEREST', 'VIP_BONUS') NULL;

-- CreateTable
CREATE TABLE `TierProgram` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `entryMethod` ENUM('POINTS_EARNED', 'MONEY_SPENT') NOT NULL DEFAULT 'POINTS_EARNED',
    `milestone` ENUM('LIFETIME', 'CALENDAR_YEAR') NOT NULL DEFAULT 'LIFETIME',
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TierProgram_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tier` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `icon` VARCHAR(30) NULL,
    `threshold` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `multiplier` DECIMAL(6, 2) NULL,
    `perks` JSON NULL,
    `tagEnabled` BOOLEAN NOT NULL DEFAULT false,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Tier_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TierReward` (
    `tierId` INTEGER NOT NULL,
    `discountRuleId` INTEGER NOT NULL,

    PRIMARY KEY (`tierId`, `discountRuleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TierHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `tierId` INTEGER NULL,
    `tierTitle` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TierHistory_customerId_tierId_createdAt_idx`(`customerId`, `tierId`, `createdAt`),
    INDEX `TierHistory_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TierCredit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `kind` ENUM('SPEND', 'MANUAL') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `sourceKey` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TierCredit_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `TierCredit_shopId_idx`(`shopId`),
    UNIQUE INDEX `TierCredit_customerId_sourceKey_key`(`customerId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_tierExpiresAt_idx` ON `Customer`(`tierExpiresAt`);

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_tierId_fkey` FOREIGN KEY (`tierId`) REFERENCES `Tier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierProgram` ADD CONSTRAINT `TierProgram_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tier` ADD CONSTRAINT `Tier_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierReward` ADD CONSTRAINT `TierReward_tierId_fkey` FOREIGN KEY (`tierId`) REFERENCES `Tier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierReward` ADD CONSTRAINT `TierReward_discountRuleId_fkey` FOREIGN KEY (`discountRuleId`) REFERENCES `DiscountRule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierHistory` ADD CONSTRAINT `TierHistory_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierHistory` ADD CONSTRAINT `TierHistory_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierHistory` ADD CONSTRAINT `TierHistory_tierId_fkey` FOREIGN KEY (`tierId`) REFERENCES `Tier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierCredit` ADD CONSTRAINT `TierCredit_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TierCredit` ADD CONSTRAINT `TierCredit_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

