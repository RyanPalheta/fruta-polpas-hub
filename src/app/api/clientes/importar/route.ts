import { prisma } from "@/lib/prisma";
import { DiaSemana, Segmento } from "@/generated/prisma/client";
import * as XLSX from "xlsx";

const SEGMENTO_MAP: Record<string, Segmento> = {
  restaurante: Segmento.RESTAURANTE,
  hotelaria: Segmento.HOTELARIA,
  academia: Segmento.ACADEMIA,
  distribuidor: Segmento.DISTRIBUIDOR,
  franquia: Segmento.FRANQUIA,
  eventos: Segmento.EVENTOS,
  outro: Segmento.OUTRO,
};

const DIA_MAP: Record<string, DiaSemana> = {
  segunda: DiaSemana.SEGUNDA,
  terca: DiaSemana.TERCA,
  terça: DiaSemana.TERCA,
  quarta: DiaSemana.QUARTA,
  quinta: DiaSemana.QUINTA,
  sexta: DiaSemana.SEXTA,
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

    if (rows.length === 0) {
      return Response.json({ error: "Planilha vazia" }, { status: 400 });
    }

    const errors: string[] = [];
    const clientesData: {
      empresa: string;
      contatoWhatsapp: string;
      segmento: Segmento;
      diaDisparo: DiaSemana;
      cidade: string | null;
      uf: string | null;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 2; // +2 because row 1 is the header

      const empresa = (row.empresa || "").toString().trim();
      const contatoWhatsapp = (row.contato_whatsapp || "").toString().trim();
      const segmentoRaw = (row.segmento || "").toString().trim().toLowerCase();
      const diaRaw = (row.dia_disparo || "").toString().trim().toLowerCase();
      const cidade = (row.cidade || "").toString().trim() || null;
      const uf = (row.uf || "").toString().trim().toUpperCase() || null;

      if (!empresa) {
        errors.push(`Linha ${lineNum}: empresa vazia`);
        continue;
      }

      if (!contatoWhatsapp) {
        errors.push(`Linha ${lineNum}: contato_whatsapp vazio`);
        continue;
      }

      const segmento = SEGMENTO_MAP[segmentoRaw];
      if (!segmento) {
        errors.push(`Linha ${lineNum}: segmento invalido "${row.segmento}"`);
        continue;
      }

      const diaDisparo = DIA_MAP[diaRaw];
      if (!diaDisparo) {
        errors.push(`Linha ${lineNum}: dia_disparo invalido "${row.dia_disparo}"`);
        continue;
      }

      clientesData.push({
        empresa,
        contatoWhatsapp,
        segmento,
        diaDisparo,
        cidade,
        uf,
      });
    }

    let created = 0;
    if (clientesData.length > 0) {
      const result = await prisma.cliente.createMany({
        data: clientesData,
        skipDuplicates: true,
      });
      created = result.count;
    }

    return Response.json({
      created,
      errors,
    });
  } catch (error) {
    console.error("POST /api/clientes/importar error:", error);
    return Response.json({ error: "Erro ao importar clientes" }, { status: 500 });
  }
}
