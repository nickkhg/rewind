export interface Board {
  id: string;
  title: string;
  columns: Column[];
  is_blurred: boolean;
  created_at: string;
  participant_count: number;
}

export interface Column {
  id: string;
  name: string;
  tickets: Ticket[];
}

export interface Ticket {
  id: string;
  content: string;
  author_id: string;
  author_name: string;
  votes: string[];
  created_at: string;
}

export interface CreateBoardRequest {
  title: string;
  columns: string[];
}

export interface CreateBoardResponse {
  board: Board;
  facilitator_token: string;
}

// WebSocket protocol
export type ClientMessage =
  | { type: "Join"; payload: { participant_name: string; facilitator_token?: string } }
  | { type: "AddTicket"; payload: { column_id: string; content: string } }
  | { type: "RemoveTicket"; payload: { ticket_id: string } }
  | { type: "EditTicket"; payload: { ticket_id: string; content: string } }
  | { type: "ToggleVote"; payload: { ticket_id: string } }
  | { type: "ToggleBlur" };

export type ServerMessage =
  | { type: "BoardState"; payload: { board: Board } }
  | { type: "Authenticated"; payload: { is_facilitator: boolean; participant_id: string } }
  | { type: "Error"; payload: { message: string } };

export type SortMode = "newest" | "most-votes";

export const COLUMN_COLORS = [
  "#d4edbc", // green
  "#fcd5ce", // rose
  "#fde68a", // amber
  "#bfdbfe", // blue
  "#e9d5ff", // purple
] as const;
