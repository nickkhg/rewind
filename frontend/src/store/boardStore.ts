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

  setBoard: (board: Board) => void;
  setAuth: (participantId: string, isFacilitator: boolean) => void;
  setConnected: (connected: boolean) => void;
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

  setBoard: (board) => set((state) => ({
    board,
    // Turn off peek when cards are unblurred
    facilitatorPeek: board.is_blurred ? state.facilitatorPeek : false,
  })),
  setAuth: (participantId, isFacilitator) => set({ participantId, isFacilitator }),
  setConnected: (connected) => set({ isConnected: connected }),
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
    }),
}));
