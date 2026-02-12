import type { CreateBoardRequest, CreateBoardResponse } from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "";

export async function createBoard(req: CreateBoardRequest): Promise<CreateBoardResponse> {
  const res = await fetch(`${BASE}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
