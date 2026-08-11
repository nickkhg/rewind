import { create } from "zustand";
import type { Board, SortMode } from "../lib/types";

interface BoardState {
  board: Board | null;
  participantId: string | null;
  isFacilitator: boolean;
  isConnected: boolean;
  sortMode: SortMode;
  pendingUndo: boolean;
  facilitatorPeek: boolean;
  /** True after the server turned this reader away at the gate of a locked board. */
  passwordRequired: boolean;

  setBoard: (board: Board) => void;
  setAuth: (participantId: string, isFacilitator: boolean) => void;
  setConnected: (connected: boolean) => void;
  setPasswordRequired: (required: boolean) => void;
  setSortMode: (mode: SortMode) => void;
  setPendingUndo: () => void;
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
  pendingUndo: false,
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
  setPendingUndo: () => set({ pendingUndo: true }),
  clearPendingUndo: () => set({ pendingUndo: false }),
  toggleFacilitatorPeek: () => set((state) => ({ facilitatorPeek: !state.facilitatorPeek })),
  reset: () =>
    set({
      board: null,
      participantId: null,
      isFacilitator: false,
      isConnected: false,
      sortMode: "newest",
      pendingUndo: false,
      facilitatorPeek: false,
      passwordRequired: false,
    }),
}));
