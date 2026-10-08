import { create } from "zustand";
import type { Board, SortMode } from "../lib/types";

/** One group the model suggested: cards that make the same point. */
export interface GroupSuggestion {
  /** Stays the same while the cards in it change, so React keeps the group in place. */
  key: string;
  ticketIds: string[];
  /** Accepted groups merge when the reviewer presses Merge. The others are dropped then. */
  accepted: boolean;
}

/**
 * The review of one column. It lives in this tab alone: the suggestion is for the person who
 * asked, and only the merge they accept reaches the rest of the room.
 */
export type GroupReview =
  | { status: "loading" }
  | { status: "ready"; groups: GroupSuggestion[] }
  | { status: "error"; message: string };

interface BoardState {
  board: Board | null;
  participantId: string | null;
  isFacilitator: boolean;
  isConnected: boolean;
  sortMode: SortMode;
  /** What the undo toast says, or null when there is nothing to undo. */
  pendingUndo: string | null;
  /** The grouping reviews that are open, by column id. */
  groupReviews: Record<string, GroupReview>;
  facilitatorPeek: boolean;
  /** True after the server turned this reader away at the gate of a locked board. */
  passwordRequired: boolean;

  setBoard: (board: Board) => void;
  setAuth: (participantId: string, isFacilitator: boolean) => void;
  setConnected: (connected: boolean) => void;
  setPasswordRequired: (required: boolean) => void;
  setSortMode: (mode: SortMode) => void;
  setPendingUndo: (message?: string) => void;
  setGroupReview: (columnId: string, review: GroupReview) => void;
  /** Changes one group of a ready review. A group left with fewer than two cards goes. */
  updateGroup: (
    columnId: string,
    key: string,
    change: (group: GroupSuggestion) => GroupSuggestion | null,
  ) => void;
  endGroupReview: (columnId: string) => void;
  clearPendingUndo: () => void;
  toggleFacilitatorPeek: () => void;
  reset: () => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  board: null,
  participantId: null,
  isFacilitator: false,
  isConnected: false,
  sortMode: "newest",
  pendingUndo: null,
  groupReviews: {},
  facilitatorPeek: false,
  passwordRequired: false,

  setBoard: (board) => set((state) => ({
    board,
    // Turn off peek when cards are unblurred
    facilitatorPeek: board.is_blurred ? state.facilitatorPeek : false,
  })),
  setAuth: (participantId, isFacilitator) => set({ participantId, isFacilitator }),
  setConnected: (connected) => set({ isConnected: connected }),
  // The board goes with it: what the gate shuts, the reader must not keep on screen.
  setPasswordRequired: (required) =>
    set(required ? { passwordRequired: true, board: null } : { passwordRequired: false }),
  setSortMode: (mode) => set({ sortMode: mode }),
  setPendingUndo: (message = "Tickets merged") => set({ pendingUndo: message }),
  clearPendingUndo: () => set({ pendingUndo: null }),
  setGroupReview: (columnId, review) =>
    set((state) => ({ groupReviews: { ...state.groupReviews, [columnId]: review } })),
  updateGroup: (columnId, key, change) =>
    set((state) => {
      const review = state.groupReviews[columnId];
      if (review?.status !== "ready") return state;
      const groups = review.groups.flatMap((g) => {
        if (g.key !== key) return [g];
        const next = change(g);
        return next && next.ticketIds.length >= 2 ? [next] : [];
      });
      return { groupReviews: { ...state.groupReviews, [columnId]: { status: "ready", groups } } };
    }),
  endGroupReview: (columnId) =>
    set((state) => {
      const { [columnId]: _ended, ...rest } = state.groupReviews;
      return { groupReviews: rest };
    }),
  toggleFacilitatorPeek: () => set((state) => ({ facilitatorPeek: !state.facilitatorPeek })),
  reset: () =>
    set({
      board: null,
      participantId: null,
      isFacilitator: false,
      isConnected: false,
      sortMode: "newest",
      pendingUndo: null,
      groupReviews: {},
      facilitatorPeek: false,
      passwordRequired: false,
    }),
}));
