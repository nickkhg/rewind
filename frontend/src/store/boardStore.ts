import { create } from "zustand";
import type { Board, SortMode } from "../lib/types";

interface BoardState {
  board: Board | null;
  participantId: string | null;
  isFacilitator: boolean;
  isConnected: boolean;
  sortMode: SortMode;

  setBoard: (board: Board) => void;
  setAuth: (participantId: string, isFacilitator: boolean) => void;
  setConnected: (connected: boolean) => void;
  setSortMode: (mode: SortMode) => void;
  reset: () => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  board: null,
  participantId: null,
  isFacilitator: false,
  isConnected: false,
  sortMode: "newest",

  setBoard: (board) => set({ board }),
  setAuth: (participantId, isFacilitator) => set({ participantId, isFacilitator }),
  setConnected: (connected) => set({ isConnected: connected }),
  setSortMode: (mode) => set({ sortMode: mode }),
  reset: () =>
    set({
      board: null,
      participantId: null,
      isFacilitator: false,
      isConnected: false,
      sortMode: "newest",
    }),
}));
