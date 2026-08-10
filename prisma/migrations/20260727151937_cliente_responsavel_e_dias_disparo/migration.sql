-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "dias_disparo" "DiaSemana"[] DEFAULT ARRAY[]::"DiaSemana"[],
ADD COLUMN     "responsavel" TEXT;

-- Backfill: o dia unico de cada cliente vira o primeiro item da nova lista de dias.
UPDATE "clientes" SET "dias_disparo" = ARRAY["dia_disparo"];

-- AlterTable
ALTER TABLE "clientes" DROP COLUMN "dia_disparo";

-- CreateIndex
CREATE INDEX "clientes_responsavel_idx" ON "clientes"("responsavel");
