import { useBoardStore } from "../store/boardStore";
import { isActionColumn } from "../lib/types";
import type { Column, ColumnRole, Ticket } from "../lib/types";

export interface TicketPermissions {
  /** The person reading this card wrote it. */
  isAuthor: boolean;
  /** The facilitator, or an editor the facilitator approved. */
  isPrivileged: boolean;
  /** The card sits in Previous Actions: a record of the last retro, not fresh input. */
  isCarried: boolean;
  /** The card sits in the Rocks column of a Level 10 board. */
  isRock: boolean;
  /** The card sits in one of the two action columns, so it can be marked done. */
  isAction: boolean;
  /** The board is hidden and this reader may not read this card yet. */
  isBlurred: boolean;
  /** The reader may edit this card: its author, the facilitator, or an editor. */
  canEdit: boolean;
  /** The reader may close and re-open the action: its author, the facilitator, or an editor. */
  canSetDone: boolean;
  /** The reader already voted for this card. */
  hasVoted: boolean;
  /** The Actions column of this board, where a carried action goes when it is still open. */
  actionsColumn: Column | undefined;
}

/**
 * What one reader may do with one card. The card and the modal ask the same question of the
 * same board, so the two never disagree about who can edit, vote, or close an action.
 */
export function useTicketPermissions(
  ticket: Ticket,
  columnRole?: ColumnRole | null,
): TicketPermissions {
  // Selectors, not the whole store: every card on the board runs this hook, and a whole-store
  // subscription would re-render all of them for state none of them read — the connection flag
  // on a socket drop first among it.
  const participantId = useBoardStore((s) => s.participantId);
  const isFacilitator = useBoardStore((s) => s.isFacilitator);
  const board = useBoardStore((s) => s.board);
  const facilitatorPeek = useBoardStore((s) => s.facilitatorPeek);

  const isAuthor = ticket.author_id === participantId;
  const isEditor = !!(
    board &&
    participantId &&
    board.editors.some((e) => e.participant_id === participantId)
  );
  const isPrivileged = isFacilitator || isEditor;

  // A carried action is a record of the last retro, not fresh input: it stays visible and it
  // takes no votes.
  const isCarried = columnRole === "previous_actions";
  // A rock stands for the quarter, so its card carries where it stands.
  const isRock = columnRole === "rocks";
  const isAction = isActionColumn(columnRole);
  // A card that came from another board is already public. It stays visible after a move too.
  const fromOtherBoard = isCarried || !!ticket.carried_from_board_title;
  const isBlurred = !!(
    board?.is_blurred &&
    !isAuthor &&
    !fromOtherBoard &&
    !(isPrivileged && facilitatorPeek)
  );

  return {
    isAuthor,
    isPrivileged,
    isCarried,
    isRock,
    isAction,
    isBlurred,
    canEdit: isAuthor || isPrivileged,
    canSetDone: isAction && (isAuthor || isPrivileged),
    hasVoted: participantId ? ticket.votes.includes(participantId) : false,
    actionsColumn: board?.columns.find((c) => c.role === "actions"),
  };
}
