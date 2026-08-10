import type {
  ActionSourceBoard,
  Board,
  ClientConfig,
  CreateBoardRequest,
  CreateBoardResponse,
  ImportResult,
  LabelCount,
  MyBoardSummary,
  Template,
  Team,
  GlobalStats,
  AdminBoardSummary,
  AdminBoardDetail,
} from "./types";
import { getServerUrl } from "./serverUrl";

export async function createBoard(req: CreateBoardRequest): Promise<CreateBoardResponse> {
  const res = await fetch(`${getServerUrl()}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchBoard(id: string): Promise<Board> {
  const res = await fetch(`${getServerUrl()}/api/boards/${id}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Reads the settings the server holds, among them the GIPHY key from the Kubernetes secret. */
export async function fetchConfig(): Promise<ClientConfig> {
  const res = await fetch(`${getServerUrl()}/api/config`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTemplates(): Promise<Template[]> {
  const res = await fetch(`${getServerUrl()}/api/templates`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMyBoards(): Promise<MyBoardSummary[]> {
  const res = await fetch(`${getServerUrl()}/api/my-boards`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Actions carry-over and labels ---

/** Tells the server who asks. The board settings hold both values. */
function boardAuth(boardId: string) {
  return {
    facilitator_token: sessionStorage.getItem(`facilitator_token_${boardId}`) ?? undefined,
    participant_id: sessionStorage.getItem(`participant_id_${boardId}`) ?? undefined,
  };
}

export async function fetchActionSources(
  boardId: string,
  opts: { q?: string; labels?: string[] } = {},
): Promise<ActionSourceBoard[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.labels?.length) params.set("labels", opts.labels.join(","));
  const query = params.toString();
  const res = await fetch(
    `${getServerUrl()}/api/boards/${boardId}/action-sources${query ? `?${query}` : ""}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function importActions(
  boardId: string,
  sourceBoardId: string,
): Promise<ImportResult> {
  const res = await fetch(`${getServerUrl()}/api/boards/${boardId}/actions/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ source_board_id: sourceBoardId, ...boardAuth(boardId) }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchLabels(): Promise<LabelCount[]> {
  const res = await fetch(`${getServerUrl()}/api/labels`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateBoardLabels(
  boardId: string,
  labels: string[],
): Promise<string[]> {
  const res = await fetch(`${getServerUrl()}/api/boards/${boardId}/labels`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ labels, ...boardAuth(boardId) }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Admin API ---

function adminHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function verifyAdminToken(token: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/verify`, {
    method: "POST",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchAdminStats(token: string): Promise<GlobalStats> {
  const res = await fetch(`${getServerUrl()}/api/admin/stats`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAdminBoards(token: string): Promise<AdminBoardSummary[]> {
  const res = await fetch(`${getServerUrl()}/api/admin/boards`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAdminBoardDetail(
  token: string,
  id: string,
): Promise<AdminBoardDetail> {
  const res = await fetch(`${getServerUrl()}/api/admin/boards/${id}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteAdminBoard(token: string, id: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/boards/${id}`, {
    method: "DELETE",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

// --- Admin Templates ---

export async function fetchAdminTemplates(token: string): Promise<Template[]> {
  const res = await fetch(`${getServerUrl()}/api/admin/templates`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createAdminTemplate(
  token: string,
  template: { id: string; name: string; description: string; columns: string[]; position: number },
): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/templates`, {
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
  const res = await fetch(`${getServerUrl()}/api/admin/templates/${id}`, {
    method: "PUT",
    headers: { ...adminHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(template),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteAdminTemplate(token: string, id: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/templates/${id}`, {
    method: "DELETE",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

// --- Teams (public) ---

export async function fetchTeams(): Promise<Team[]> {
  const res = await fetch(`${getServerUrl()}/api/teams`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Admin Teams ---

export async function fetchAdminTeams(token: string): Promise<Team[]> {
  const res = await fetch(`${getServerUrl()}/api/admin/teams`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createAdminTeam(
  token: string,
  team: { name: string; members: string[] },
): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/teams`, {
    method: "POST",
    headers: { ...adminHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(team),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function updateAdminTeam(
  token: string,
  id: string,
  team: { name: string; members: string[] },
): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/teams/${id}`, {
    method: "PUT",
    headers: { ...adminHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(team),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteAdminTeam(token: string, id: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/teams/${id}`, {
    method: "DELETE",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}
