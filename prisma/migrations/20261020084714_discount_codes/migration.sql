-- CreateTable
CREATE TABLE `DiscountCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `ruleId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `discountType` ENUM('FIXED_AMOUNT', 'PERCENTAGE', 'FREE_SHIPPING') NOT NULL,
    `discountValue` DECIMAL(10, 2) NULL,
    `minimumSubtotal` DECIMAL(10, 2) NULL,
    `usageLimit` INTEGER NULL,
    `appliesOncePerCustomer` BOOLEAN NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `customers` JSON NOT NULL,
    `products` JSON NOT NULL,
    `shopifyDiscountId` VARCHAR(191) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DiscountCode_shopifyDiscountId_key`(`shopifyDiscountId`),
    INDEX `DiscountCode_ruleId_idx`(`ruleId`),
    UNIQUE INDEX `DiscountCode_shopId_code_key`(`shopId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DiscountCode` ADD CONSTRAINT `DiscountCode_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DiscountCode` ADD CONSTRAINT `DiscountCode_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `DiscountRule`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
