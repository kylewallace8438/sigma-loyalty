-- CreateTable
CREATE TABLE `Order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `shopifyOrderId` BIGINT NOT NULL,
    `shopifyCustomerId` BIGINT NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `subtotalPrice` DECIMAL(12, 2) NOT NULL,
    `totalDiscounts` DECIMAL(12, 2) NOT NULL,
    `totalPrice` DECIMAL(12, 2) NOT NULL,
    `financialStatus` VARCHAR(191) NULL,
    `fulfillmentStatus` VARCHAR(191) NULL,
    `discountCodes` JSON NOT NULL,
    `lineItems` JSON NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `fulfilledAt` DATETIME(3) NULL,
    `shopifyCreatedAt` DATETIME(3) NOT NULL,
    `shopifyUpdatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Order_shopifyCreatedAt_idx`(`shopifyCreatedAt`),
    UNIQUE INDEX `Order_shopId_shopifyOrderId_key`(`shopId`, `shopifyOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
