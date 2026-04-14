import { prisma } from "./prisma";

async function getConfig() {
  const config = await prisma.configuracao.findUnique({ where: { id: "default" } });
  if (!config?.kommoToken || !config?.kommoSubdomain) {
    throw new Error("KOMMO not configured. Go to Configurações to set up.");
  }
  return config;
}

async function kommoFetch(path: string, options: RequestInit = {}) {
  const config = await getConfig();
  const baseUrl = `https://${config.kommoSubdomain}.kommo.com`;
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.kommoToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KOMMO API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getKommoLeads(pipelineId?: string) {
  const params = new URLSearchParams({ limit: "250" });
  if (pipelineId) params.set("filter[pipeline_id]", pipelineId);
  return kommoFetch(`/api/v4/leads?${params}`);
}

export async function moveLeadToStatus(leadId: number, statusId: number, pipelineId: number) {
  return kommoFetch(`/api/v4/leads`, {
    method: "PATCH",
    body: JSON.stringify([{ id: leadId, pipeline_id: pipelineId, status_id: statusId }]),
  });
}

export async function createLeadComplex(data: {
  name: string;
  phone: string;
  pipelineId: number;
  statusId: number;
  tags?: string[];
}) {
  return kommoFetch(`/api/v4/leads/complex`, {
    method: "POST",
    body: JSON.stringify([
      {
        name: data.name,
        pipeline_id: data.pipelineId,
        status_id: data.statusId,
        _embedded: {
          tags: data.tags?.map((t) => ({ name: t })) || [],
          contacts: [
            {
              name: data.name,
              custom_fields_values: [
                {
                  field_code: "PHONE",
                  values: [{ value: data.phone, enum_code: "WORK" }],
                },
              ],
            },
          ],
        },
      },
    ]),
  });
}

export async function getKommoPipelines() {
  return kommoFetch(`/api/v4/leads/pipelines`);
}
