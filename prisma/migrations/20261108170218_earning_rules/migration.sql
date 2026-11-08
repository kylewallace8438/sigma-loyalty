-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `birthday` DATE NULL,
    ADD COLUMN `birthdayRewardAt` DATETIME(3) NULL,
    ADD COLUMN `pointsExpireAt` DATETIME(3) NULL,
    ADD COLUMN `referralCode` VARCHAR(20) NULL,
    ADD COLUMN `referredById` INTEGER NULL;

-- AlterTable
ALTER TABLE `PointHistory` ADD COLUMN `dedupeKey` VARCHAR(100) NULL,
    ADD COLUMN `earningType` ENUM('PLACE_ORDER', 'CREATE_ACCOUNT', 'NEWSLETTER', 'BIRTHDAY', 'COMPLETE_PROFILE', 'REFERRER', 'REFERRED_FRIEND', 'FOLLOW_INSTAGRAM', 'FOLLOW_X', 'SHARE_ON_X', 'RETWEET', 'LIKE_ON_FACEBOOK', 'SHARE_ON_FACEBOOK', 'JOIN_FACEBOOK_GROUP', 'FOLLOW_TIKTOK', 'FOLLOW_LINKEDIN', 'SHARE_ON_LINKEDIN', 'SUBSCRIBE_YOUTUBE', 'FOLLOW_PINTEREST') NULL,
    ADD COLUMN `shopifyOrderId` BIGINT NULL;

-- CreateTable
CREATE TABLE `EarningRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `type` ENUM('PLACE_ORDER', 'CREATE_ACCOUNT', 'NEWSLETTER', 'BIRTHDAY', 'COMPLETE_PROFILE', 'REFERRER', 'REFERRED_FRIEND', 'FOLLOW_INSTAGRAM', 'FOLLOW_X', 'SHARE_ON_X', 'RETWEET', 'LIKE_ON_FACEBOOK', 'SHARE_ON_FACEBOOK', 'JOIN_FACEBOOK_GROUP', 'FOLLOW_TIKTOK', 'FOLLOW_LINKEDIN', 'SHARE_ON_LINKEDIN', 'SUBSCRIBE_YOUTUBE', 'FOLLOW_PINTEREST') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `points` INTEGER NOT NULL DEFAULT 10,
    `config` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EarningRule_shopId_type_key`(`shopId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_birthdayRewardAt_idx` ON `Customer`(`birthdayRewardAt`);

-- CreateIndex
CREATE INDEX `Customer_pointsExpireAt_idx` ON `Customer`(`pointsExpireAt`);

-- CreateIndex
CREATE UNIQUE INDEX `Customer_shopId_referralCode_key` ON `Customer`(`shopId`, `referralCode`);

-- CreateIndex
CREATE INDEX `PointHistory_shopId_shopifyOrderId_idx` ON `PointHistory`(`shopId`, `shopifyOrderId`);

-- CreateIndex
CREATE UNIQUE INDEX `PointHistory_customerId_dedupeKey_key` ON `PointHistory`(`customerId`, `dedupeKey`);

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_referredById_fkey` FOREIGN KEY (`referredById`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EarningRule` ADD CONSTRAINT `EarningRule_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

