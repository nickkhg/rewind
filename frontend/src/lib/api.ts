import type {
  ActionSourceBoard,
  ApplyTemplateResult,
  Board,
  BoardAccess,
  ClientConfig,
  CreateBoardRequest,
  CreateBoardResponse,
  Health,
  ImportResult,
  LabelCount,
  MyBoardSummary,
  PasswordResponse,
  Template,
  Team,
  UnlockResponse,
  GlobalStats,
  AdminBoardSummary,
  AdminBoardDetail,
} from "./types";
import { getServerUrl } from "./serverUrl";
import { accessHeader, getAccessToken, setAccessToken } from "./boardAccess";

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
    headers: accessHeader(id),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- The gate of a locked board ---

/** Asks what this tab may learn about a board before it opens: the name, and whether it is shut. */
export async function fetchBoardAccess(id: string): Promise<BoardAccess> {
  const res = await fetch(`${getServerUrl()}/api/boards/${id}/access`, {
    credentials: "include",
    headers: accessHeader(id),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Trades the password for the key, and keeps the key for the rest of the session. */
export async function unlockBoard(id: string, password: string): Promise<string> {
  const res = await fetch(`${getServerUrl()}/api/boards/${id}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await res.text());
  const { access_token }: UnlockResponse = await res.json();
  setAccessToken(id, access_token);
  return access_token;
}

/**
 * Sets the password of a board, or takes it off with null. The facilitator alone.
 * The answer holds a new key, which this tab keeps so that the facilitator reads on.
 */
export async function setBoardPassword(
  id: string,
  password: string | null,
): Promise<PasswordResponse> {
  const res = await fetch(`${getServerUrl()}/api/boards/${id}/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password, ...boardAuth(id) }),
  });
  if (!res.ok) throw new Error(await res.text());
  const result: PasswordResponse = await res.json();
  setAccessToken(id, result.access_token);
  return result;
}

/**
 * Reads the settings the server holds, among them the GIPHY key from the Kubernetes secret.
 * The cookie goes with it, because the answer names who is signed in.
 */
export async function fetchConfig(): Promise<ClientConfig> {
  const res = await fetch(`${getServerUrl()}/api/config`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Asks whether the server is up, and whether it asks for a work account.
 *
 * The one route that answers whoever asks, signed in or not. The desktop app reads it to say why a
 * server will not open, and the Kubernetes probes read it for the same reason.
 */
export async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${getServerUrl()}/api/health`);
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
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

/**
 * Copies cards from a column of another board into a column of this one. Naming no column keeps
 * the carry-over this route was written for: the actions of the source into Previous Actions.
 */
export async function importActions(
  boardId: string,
  sourceBoardId: string,
  columns: { sourceColumnId?: string; targetColumnId?: string } = {},
): Promise<ImportResult> {
  const res = await fetch(`${getServerUrl()}/api/boards/${boardId}/actions/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      source_board_id: sourceBoardId,
      source_column_id: columns.sourceColumnId,
      target_column_id: columns.targetColumnId,
      // The key to the source board, when this tab has one. A locked source asks for its own
      // password, whoever runs the board the actions land on.
      source_access_token: getAccessToken(sourceBoardId) ?? undefined,
      ...boardAuth(boardId),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Renames a board. The facilitator and the editors alone. The saved name comes back to every
 * open client on the socket, so the caller has nothing to write into the store.
 */
export async function updateBoardTitle(boardId: string, title: string): Promise<string> {
  const res = await fetch(`${getServerUrl()}/api/boards/${boardId}/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ title, ...boardAuth(boardId) }),
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

/**
 * Stops the server, so that Kubernetes starts it again. The answer comes back before the server
 * goes, so a reply here means the restart started and not that it finished.
 */
export async function restartService(token: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/restart`, {
    method: "POST",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
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
  template: {
    id: string;
    name: string;
    description: string;
    columns: string[];
    position: number;
    default_blurred: boolean;
  },
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
  template: {
    name: string;
    description: string;
    columns: string[];
    position: number;
    default_blurred: boolean;
  },
): Promise<void> {
  const res = await fetch(`${getServerUrl()}/api/admin/templates/${id}`, {
    method: "PUT",
    headers: { ...adminHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(template),
  });
  if (!res.ok) throw new Error(await res.text());
}

/**
 * Brings the columns of a template across to the boards already made from it. A board is a copy
 * of its template, so this is the only thing that reaches back to one.
 */
export async function applyAdminTemplate(
  token: string,
  id: string,
): Promise<ApplyTemplateResult> {
  const res = await fetch(`${getServerUrl()}/api/admin/templates/${id}/apply`, {
    method: "POST",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
