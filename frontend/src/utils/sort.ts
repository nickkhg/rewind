import type { Ticket, SortMode } from "../lib/types";

export function sortTickets(tickets: Ticket[], mode: SortMode): Ticket[] {
  const sorted = [...tickets];
  if (mode === "most-votes") {
    sorted.sort((a, b) => b.votes.length - a.votes.length || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else {
    sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
  return sorted;
}
