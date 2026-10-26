-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `shopifyCreatedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Customer_shopId_shopifyCreatedAt_idx` ON `Customer`(`shopId`, `shopifyCreatedAt`);

-- CreateIndex
CREATE INDEX `RedeemHistory_shopId_createdAt_idx` ON `RedeemHistory`(`shopId`, `createdAt`);
