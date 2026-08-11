export interface EditorInfo {
  participant_id: string;
  participant_name: string;
}

export interface EditorRequest {
  participant_id: string;
  participant_name: string;
}

export interface Board {
  id: string;
  title: string;
  columns: Column[];
  is_blurred: boolean;
  is_anonymous: boolean;
  created_at: string;
  participant_count: number;
  hide_votes: boolean;
  vote_limit_per_column: number | null;
  timer_end: string | null;
  editors: EditorInfo[];
  editor_requests: EditorRequest[];
  labels: string[];
  /** The template the board started from, kept as a format tag. Null for a custom board. */
  template_id: string | null;
  /** Empty on every board that is not a Level 10 board. */
  scorecard: ScorecardMetric[];
  /** One mark per participant who rated the meeting. The average is worked out here. */
  meeting_ratings: MeetingRating[];
}

/**
 * Every board has a Previous Actions column and an Actions column. Only a Level 10 board has a
 * Rocks column. Every other column has no role.
 */
export type ColumnRole = "previous_actions" | "actions" | "rocks";

export interface Column {
  id: string;
  name: string;
  role: ColumnRole | null;
  tickets: Ticket[];
}

export interface Ticket {
  id: string;
  content: string;
  author_id: string;
  author_name: string;
  votes: string[];
  created_at: string;
  carried_from_board_id: string | null;
  carried_from_board_title: string | null;
  comments: TicketComment[];
  gif: Gif | null;
  /** Where the rock stands. Null on every card outside the Rocks column. */
  rock_status: RockStatus | null;
  /**
   * When the action was closed. Null on an open action and on every card outside the two
   * action columns. A finished action stays on the board: the mark is what closes it.
   */
  done_at: string | null;
}

/** Where a rock stands. Null until someone marks it. */
export type RockStatus = "on_track" | "off_track";

/** One line of the scorecard: a number the team reads each week, and how it stands. */
export interface ScorecardMetric {
  id: string;
  name: string;
  /** Free text, because an EOS goal reads ">= 95%" or "$120k". */
  goal: string;
  actual: string;
  /** Null until someone marks the line, then true or false. */
  on_track: boolean | null;
}

/** The mark that one participant gave the meeting, from 1 to 10. */
export interface MeetingRating {
  participant_id: string;
  rating: number;
}

/** A remark on one card. It changes neither the text of the card nor its votes. */
export interface TicketComment {
  id: string;
  content: string;
  author_id: string;
  author_name: string;
  created_at: string;
  gif: Gif | null;
}

/**
 * One GIF from GIPHY, attached to a card or to a comment. The board holds enough to draw the
 * picture on its own, so a card needs no call to GIPHY to appear.
 */
export interface Gif {
  id: string;
  /** The moving picture. */
  url: string;
  /** The first frame. A card rests on this until the reader asks for motion. */
  still_url: string;
  width: number;
  height: number;
  /** The GIPHY title, which becomes the alt text. */
  title: string;
}

/** The most characters that one comment can hold. The backend applies the same limit. */
export const MAX_COMMENT_LENGTH = 500;

/** The most characters that one field of a scorecard line can hold. Same limit on the backend. */
export const MAX_SCORECARD_FIELD_LENGTH = 200;

/** The template that turns the Level 10 parts on: the scorecard, the rock status, the rating. */
export const LEVEL10_TEMPLATE_ID = "level10";

/** True when the board runs an EOS Level 10 meeting and carries its extra parts. */
export function isLevel10(board: Board | null | undefined): boolean {
  return board?.template_id === LEVEL10_TEMPLATE_ID;
}

/** What the server tells the frontend at startup. */
export interface ClientConfig {
  /** Null when the deployment sets no key. The GIF controls then stay hidden. */
  giphy_api_key: string | null;
}

export interface CreateBoardRequest {
  title: string;
  columns: string[];
  is_anonymous?: boolean;
  labels?: string[];
  /** The template the board starts from. Absent for a custom board. */
  template_id?: string;
}

/** A board that can supply actions to the board in view. */
export interface ActionSourceBoard {
  id: string;
  title: string;
  created_at: string;
  action_count: number;
  labels: string[];
}

export interface LabelCount {
  label: string;
  board_count: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export interface CreateBoardResponse {
  board: Board;
  facilitator_token: string;
}

// WebSocket protocol
export type ClientMessage =
  | { type: "Join"; payload: { participant_name: string; facilitator_token?: string; participant_id?: string } }
  | { type: "AddTicket"; payload: { column_id: string; content: string; gif?: Gif | null } }
  | { type: "RemoveTicket"; payload: { ticket_id: string } }
  | { type: "EditTicket"; payload: { ticket_id: string; content: string; gif?: Gif | null } }
  | { type: "MoveTicket"; payload: { ticket_id: string; column_id: string } }
  | { type: "AddComment"; payload: { ticket_id: string; content: string; gif?: Gif | null } }
  | { type: "EditComment"; payload: { comment_id: string; content: string; gif?: Gif | null } }
  | { type: "RemoveComment"; payload: { comment_id: string } }
  | { type: "ToggleVote"; payload: { ticket_id: string } }
  | { type: "ToggleBlur" }
  | { type: "ToggleHideVotes" }
  | { type: "MergeTickets"; payload: { source_ticket_id: string; target_ticket_id: string } }
  | { type: "UndoMerge" }
  | { type: "SplitTicket"; payload: { ticket_id: string; segment_index: number } }
  | { type: "SetVoteLimit"; payload: { limit: number | null } }
  | { type: "StartTimer"; payload: { duration_secs: number } }
  | { type: "StopTimer" }
  | { type: "SetTicketDone"; payload: { ticket_id: string; done: boolean } }
  | { type: "SetRockStatus"; payload: { ticket_id: string; status?: RockStatus | null } }
  | { type: "RateMeeting"; payload: { rating: number } }
  | { type: "AddScorecardMetric"; payload: { name: string; goal: string } }
  | {
      type: "UpdateScorecardMetric";
      payload: {
        metric_id: string;
        name: string;
        goal: string;
        actual: string;
        on_track?: boolean | null;
      };
    }
  | { type: "RemoveScorecardMetric"; payload: { metric_id: string } }
  | { type: "RequestEditor"; payload: { name?: string } }
  | { type: "ApproveEditor"; payload: { participant_id: string } }
  | { type: "DeclineEditor"; payload: { participant_id: string } }
  | { type: "RemoveEditor"; payload: { participant_id: string } };

export type ServerMessage =
  | { type: "BoardState"; payload: { board: Board } }
  | { type: "Authenticated"; payload: { is_facilitator: boolean; participant_id: string } }
  | { type: "Error"; payload: { message: string } };

export interface MyBoardSummary {
  id: string;
  title: string;
  created_at: string;
  column_count: number;
  ticket_count: number;
  is_anonymous: boolean;
  labels: string[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  columns: string[];
}

export type SortMode = "newest" | "most-votes";

// --- Team types ---

export interface TeamMember {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
}

// --- Admin types ---

export interface GlobalStats {
  board_count: number;
  ticket_count: number;
  vote_count: number;
  online_participants: number;
}

export interface AdminBoardSummary {
  id: string;
  title: string;
  is_blurred: boolean;
  created_at: string;
  column_count: number;
  ticket_count: number;
  vote_count: number;
  online_participants: number;
}

export interface AdminBoardDetail {
  id: string;
  title: string;
  is_blurred: boolean;
  created_at: string;
  facilitator_token: string;
  columns: { id: string; name: string; ticket_count: number }[];
  online_participants: number;
}

export const COLUMN_COLORS = [
  "#d4edbc", // green
  "#fcd5ce", // rose
  "#fde68a", // amber
  "#bfdbfe", // blue
  "#e9d5ff", // purple
] as const;

/**
 * The role columns keep their own colors: paper grey for the archive, accent tint for output,
 * and a muted sage for the rocks, which stand for a whole quarter and not for one week.
 */
export const COLUMN_ROLE_COLORS: Record<ColumnRole, string> = {
  previous_actions: "#d9d4cd",
  actions: "#f6cabb",
  rocks: "#c7d6c0",
};

/**
 * The edge a finished action carries, in place of the color of its column. Both action columns
 * have a fixed color of their own, so nothing is lost by the swap, and a done card reads as
 * done from the far end of the room.
 */
export const DONE_EDGE_COLOR = "#5f9e6e";

/** The two columns whose cards can be marked done. The backend applies the same rule. */
export function isActionColumn(role: ColumnRole | null | undefined): boolean {
  return role === "actions" || role === "previous_actions";
}

export const COLUMN_ROLE_NAMES: Record<ColumnRole, string> = {
  previous_actions: "Previous Actions",
  actions: "Actions",
  rocks: "Rocks",
};
