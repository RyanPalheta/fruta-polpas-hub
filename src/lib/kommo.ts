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

  // Strip any non-ASCII characters that may have been introduced by copy-paste
  // (e.g. bullet points, smart quotes, zero-width spaces) before setting headers.
  const cleanToken = (config.kommoToken ?? "").replace(/[^\x20-\x7E]/g, "").trim();

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cleanToken}`,
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

/**
 * Normalize phone to digits only (strip +, spaces, dashes, parens).
 */
function normalizePhone(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

/**
 * Check if two phone numbers match. Handles Brazilian variations where
 * the 9th digit on mobile may or may not be present, and leading country
 * code may or may not be included. We compare by matching suffixes.
 */
function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Use the last 10 digits (DDD + number without 9th) as a stable suffix
  const suffix = (s: string) => s.slice(-10);
  return suffix(na) === suffix(nb);
}

interface KommoContactSearchResponse {
  _embedded?: {
    contacts?: Array<{
      id: number;
      name?: string;
      custom_fields_values?: Array<{
        field_code?: string;
        field_name?: string;
        values?: Array<{ value?: string }>;
      }> | null;
      _embedded?: {
        leads?: Array<{ id: number }>;
      };
    }>;
  };
}

/**
 * Search KOMMO contacts by phone. Returns the first contact whose PHONE
 * custom field matches the given phone (by digit suffix). If the contact
 * has any linked leads, returns the first leadId as well.
 */
export async function findKommoLeadByPhone(phone: string): Promise<{
  contactId: number;
  leadId: number | null;
} | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  // KOMMO query searches across phone/email/name — pass the raw digits.
  const params = new URLSearchParams({
    query: normalized,
    with: "leads",
    limit: "50",
  });

  let data: KommoContactSearchResponse;
  try {
    data = await kommoFetch(`/api/v4/contacts?${params}`);
  } catch (err) {
    // KOMMO returns 204 (empty) when no contacts match — kommoFetch throws on non-ok
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("204")) return null;
    throw err;
  }

  const contacts = data?._embedded?.contacts ?? [];
  if (contacts.length === 0) return null;

  for (const contact of contacts) {
    const fields = contact.custom_fields_values ?? [];
    const phoneField = fields.find((f) => f?.field_code === "PHONE");
    if (!phoneField?.values) continue;

    const hasMatch = phoneField.values.some((v) =>
      v?.value ? phonesMatch(v.value, phone) : false
    );
    if (!hasMatch) continue;

    const leadId = contact._embedded?.leads?.[0]?.id ?? null;
    return { contactId: contact.id, leadId };
  }

  return null;
}
