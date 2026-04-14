-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "UserOperationEvent" (
    "id" TEXT NOT NULL,
    "userOpHash" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "paymaster" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "actualGasCost" TEXT NOT NULL,
    "actualGasUsed" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockTimestamp" TIMESTAMP(3),

    CONSTRAINT "UserOperationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserOperationEvent_blockNumber_idx" ON "UserOperationEvent"("blockNumber");

-- CreateIndex
CREATE INDEX "UserOperationEvent_sender_idx" ON "UserOperationEvent"("sender");

-- CreateIndex
CREATE UNIQUE INDEX "UserOperationEvent_txHash_logIndex_key" ON "UserOperationEvent"("txHash", "logIndex");
