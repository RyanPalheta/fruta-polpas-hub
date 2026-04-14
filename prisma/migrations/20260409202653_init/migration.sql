-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA');

-- CreateEnum
CREATE TYPE "Segmento" AS ENUM ('RESTAURANTE', 'HOTELARIA', 'ACADEMIA', 'DISTRIBUIDOR', 'FRANQUIA', 'EVENTOS', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusDisparo" AS ENUM ('AGUARDANDO', 'DISPARADO', 'RESPONDEU', 'PEDIDO_CONFIRMADO', 'PEDIDO_NAO_REALIZADO', 'NAO_RESPONDEU', 'SUPORTE_HUMANO');

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "contato_whatsapp" TEXT NOT NULL,
    "segmento" "Segmento" NOT NULL DEFAULT 'RESTAURANTE',
    "dia_disparo" "DiaSemana" NOT NULL,
    "cidade" TEXT,
    "uf" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kommo_lead_id" INTEGER,
    "kommo_contact_id" INTEGER,
    "ultimo_pedido_em" TIMESTAMP(3),
    "ultimo_pedido_valor" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disparos" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "semana_inicio" DATE NOT NULL,
    "status" "StatusDisparo" NOT NULL DEFAULT 'AGUARDANDO',
    "disparado_em" TIMESTAMP(3),
    "respondeu_em" TIMESTAMP(3),
    "pedido_em" TIMESTAMP(3),
    "valor_pedido" DOUBLE PRECISION,
    "kommo_lead_id" INTEGER,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disparos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ciclos_semanais" (
    "id" TEXT NOT NULL,
    "semana_inicio" DATE NOT NULL,
    "semana_fim" DATE NOT NULL,
    "total_disparados" INTEGER NOT NULL DEFAULT 0,
    "total_responderam" INTEGER NOT NULL DEFAULT 0,
    "total_pedidos" INTEGER NOT NULL DEFAULT 0,
    "total_nao_responderam" INTEGER NOT NULL DEFAULT 0,
    "total_valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marco_zero_executado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ciclos_semanais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "horario_disparo" TEXT NOT NULL DEFAULT '08:00',
    "horario_followup" TEXT NOT NULL DEFAULT '14:00',
    "kommo_pipeline_id" TEXT,
    "kommo_status_ids" JSONB,
    "kommo_token" TEXT,
    "kommo_subdomain" TEXT DEFAULT 'frutapolpas',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disparos_semana_inicio_idx" ON "disparos"("semana_inicio");

-- CreateIndex
CREATE INDEX "disparos_status_idx" ON "disparos"("status");

-- CreateIndex
CREATE UNIQUE INDEX "disparos_cliente_id_semana_inicio_key" ON "disparos"("cliente_id", "semana_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "ciclos_semanais_semana_inicio_key" ON "ciclos_semanais"("semana_inicio");

-- AddForeignKey
ALTER TABLE "disparos" ADD CONSTRAINT "disparos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
