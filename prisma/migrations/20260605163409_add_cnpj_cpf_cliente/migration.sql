-- AlterTable
ALTER TABLE "clientes" ADD COLUMN "cnpj_cpf" TEXT;

-- CreateIndex
CREATE INDEX "clientes_cnpj_cpf_idx" ON "clientes"("cnpj_cpf");
