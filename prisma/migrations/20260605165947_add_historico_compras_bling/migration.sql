-- CreateTable
CREATE TABLE "historico_compras_bling" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "bling_pedido_id" TEXT,
    "numero_pedido" TEXT,
    "data" DATE NOT NULL,
    "valor_total" DOUBLE PRECISION NOT NULL,
    "situacao" TEXT,
    "itens" JSONB,
    "raw_payload" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_compras_bling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historico_compras_bling_cliente_id_bling_pedido_id_key" ON "historico_compras_bling"("cliente_id", "bling_pedido_id");

-- CreateIndex
CREATE INDEX "historico_compras_bling_cliente_id_data_idx" ON "historico_compras_bling"("cliente_id", "data");

-- CreateIndex
CREATE INDEX "historico_compras_bling_data_idx" ON "historico_compras_bling"("data");

-- AddForeignKey
ALTER TABLE "historico_compras_bling" ADD CONSTRAINT "historico_compras_bling_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
