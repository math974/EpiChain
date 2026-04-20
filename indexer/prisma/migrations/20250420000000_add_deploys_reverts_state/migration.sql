-- CreateTable
CREATE TABLE "AccountDeployed" (
    "id" TEXT NOT NULL,
    "userOpHash" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "factory" TEXT NOT NULL,
    "paymaster" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockTimestamp" TIMESTAMP(3),

    CONSTRAINT "AccountDeployed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOperationRevertReason" (
    "id" TEXT NOT NULL,
    "userOpHash" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "revertReason" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockTimestamp" TIMESTAMP(3),

    CONSTRAINT "UserOperationRevertReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastIndexedBlock" BIGINT NOT NULL,

    CONSTRAINT "IndexerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeployed_blockNumber_idx" ON "AccountDeployed"("blockNumber");
CREATE INDEX "AccountDeployed_sender_idx" ON "AccountDeployed"("sender");
CREATE UNIQUE INDEX "AccountDeployed_txHash_logIndex_key" ON "AccountDeployed"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "UserOperationRevertReason_blockNumber_idx" ON "UserOperationRevertReason"("blockNumber");
CREATE INDEX "UserOperationRevertReason_sender_idx" ON "UserOperationRevertReason"("sender");
CREATE UNIQUE INDEX "UserOperationRevertReason_txHash_logIndex_key" ON "UserOperationRevertReason"("txHash", "logIndex");
