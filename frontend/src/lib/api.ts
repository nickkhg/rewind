import type {
  CreateBoardRequest,
  CreateBoardResponse,
  MyBoardSummary,
  Template,
  GlobalStats,
  AdminBoardSummary,
  AdminBoardDetail,
} from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "";

export async function createBoard(req: CreateBoardRequest): Promise<CreateBoardResponse> {
  const res = await fetch(`${BASE}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTemplates(): Promise<Template[]> {
  const res = await fetch(`${BASE}/api/templates`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMyBoards(): Promise<MyBoardSummary[]> {
  const res = await fetch(`${BASE}/api/my-boards`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Admin API ---

function adminHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function verifyAdminToken(token: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/verify`, {
    method: "POST",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchAdminStats(token: string): Promise<GlobalStats> {
  const res = await fetch(`${BASE}/api/admin/stats`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAdminBoards(token: string): Promise<AdminBoardSummary[]> {
  const res = await fetch(`${BASE}/api/admin/boards`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAdminBoardDetail(
  token: string,
  id: string,
): Promise<AdminBoardDetail> {
  const res = await fetch(`${BASE}/api/admin/boards/${id}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteAdminBoard(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/boards/${id}`, {
    method: "DELETE",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

// --- Admin Templates ---

export async function fetchAdminTemplates(token: string): Promise<Template[]> {
  const res = await fetch(`${BASE}/api/admin/templates`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createAdminTemplate(
  token: string,
  template: { id: string; name: string; description: string; columns: string[]; position: number },
): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/templates`, {
    method: "POST",
    headers: { ...adminHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(template),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function updateAdminTemplate(
  token: string,
  id: string,
  template: { name: string; description: string; columns: string[]; position: number },
): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/templates/${id}`, {
    method: "PUT",
    headers: { ...adminHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(template),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteAdminTemplate(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/templates/${id}`, {
    method: "DELETE",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}
