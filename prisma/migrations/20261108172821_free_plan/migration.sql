-- CreateTable
CREATE TABLE `Plan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(255) NULL,
    `price` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `interval` VARCHAR(20) NULL,
    `trialDays` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Plan_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanFeature` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planId` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `value` VARCHAR(32) NOT NULL,

    UNIQUE INDEX `PlanFeature_planId_code_key`(`planId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopFeature` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `value` VARCHAR(32) NOT NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,

    INDEX `ShopFeature_shopId_code_idx`(`shopId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `planId` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `shopifySubscriptionId` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Subscription_shopId_status_idx`(`shopId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionUsage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subscriptionId` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,
    `validUntil` DATETIME(3) NULL,

    UNIQUE INDEX `SubscriptionUsage_subscriptionId_code_key`(`subscriptionId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlanFeature` ADD CONSTRAINT `PlanFeature_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopFeature` ADD CONSTRAINT `ShopFeature_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionUsage` ADD CONSTRAINT `SubscriptionUsage_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the Free plan: every feature on, no order limit (see app/services/billing/features.js).
INSERT INTO `Plan` (`name`, `description`, `price`, `trialDays`, `active`, `createdAt`)
VALUES ('Free', 'Every feature, no limits.', 0, 0, true, CURRENT_TIMESTAMP(3));

INSERT INTO `PlanFeature` (`planId`, `code`, `value`)
SELECT `id`, f.`code`, f.`value` FROM `Plan`
CROSS JOIN (
  SELECT 'orders.monthly_limit' AS `code`, 'UNLIMITED' AS `value`
  UNION ALL SELECT 'earning.newsletter', 'Y'
  UNION ALL SELECT 'earning.birthday', 'Y'
  UNION ALL SELECT 'earning.referral', 'Y'
  UNION ALL SELECT 'earning.social', 'Y'
  UNION ALL SELECT 'earning.complete_profile', 'Y'
  UNION ALL SELECT 'redeem.free_product', 'Y'
  UNION ALL SELECT 'tier.vip_tiers', 'Y'
  UNION ALL SELECT 'tier.manual_change', 'Y'
  UNION ALL SELECT 'points.expiration', 'Y'
) AS f
WHERE `Plan`.`name` = 'Free';

-- Every installed shop starts on the Free plan.
INSERT INTO `Subscription` (`shopId`, `planId`, `status`, `startsAt`, `createdAt`)
SELECT s.`id`, p.`id`, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Shop` s CROSS JOIN `Plan` p
WHERE p.`name` = 'Free';
