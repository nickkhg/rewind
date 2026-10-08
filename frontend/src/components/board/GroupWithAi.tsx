import type { ReactNode } from "react";
import { useBoardStore, type GroupSuggestion } from "../../store/boardStore";
import { suggestGroups } from "../../lib/api";
import { GROUP_INKS } from "../../lib/types";
import type { ClientMessage, Ticket } from "../../lib/types";

/** A group as the column draws it: the cards still on the board, with the mark of the group. */
export interface LiveGroup {
  group: GroupSuggestion;
  ink: string;
  tickets: Ticket[];
}

/** The letter of the group at this place in the answer. It stays with the group to the end. */
function groupKey(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function inkOf(key: string): string {
  const index = key.length === 1 ? key.charCodeAt(0) - 65 : Number(key) - 1;
  return GROUP_INKS[index % GROUP_INKS.length];
}

/**
 * The groups of a review, held to the cards the column still has. Someone may delete or merge a
 * card while the facilitator reads, and a group with one card left is no group.
 */
export function liveGroups(groups: GroupSuggestion[], sorted: Ticket[]): LiveGroup[] {
  return groups.flatMap((group) => {
    const tickets = sorted.filter((t) => group.ticketIds.includes(t.id));
    return tickets.length >= 2 ? [{ group, ink: inkOf(group.key), tickets }] : [];
  });
}

/**
 * The column in reading order, with the cards of each group pulled together at the place of the
 * first of them. A group is read as one stack; its cards scattered down the column would not be.
 */
export function arrangeColumn(
  sorted: Ticket[],
  groups: LiveGroup[],
): Array<{ ticket: Ticket } | { group: LiveGroup }> {
  const groupOf = new Map<string, LiveGroup>();
  for (const g of groups) for (const t of g.tickets) groupOf.set(t.id, g);

  const placed = new Set<string>();
  const items: Array<{ ticket: Ticket } | { group: LiveGroup }> = [];
  for (const ticket of sorted) {
    if (placed.has(ticket.id)) continue;
    const group = groupOf.get(ticket.id);
    if (group) {
      group.tickets.forEach((t) => placed.add(t.id));
      items.push({ group });
    } else {
      items.push({ ticket });
    }
  }
  return items;
}

/** Two cards, one laid over the other: what a merge makes of them. */
function StackIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="4.5" width="9" height="9" rx="1.5" />
      <path d="M5 4.5V3.5A1.5 1.5 0 0 1 6.5 2H12.5A1.5 1.5 0 0 1 14 3.5V9.5A1.5 1.5 0 0 1 12.5 11H11" />
    </svg>
  );
}

/** Starts a review of one column. The answer goes to the store, where the column reads it. */
function useStartReview(boardId: string | undefined, columnId: string) {
  const setGroupReview = useBoardStore((s) => s.setGroupReview);

  return () => {
    if (!boardId) return;
    setGroupReview(columnId, { status: "loading" });
    // A review closed while the request was out stays closed.
    const stillWaiting = () =>
      useBoardStore.getState().groupReviews[columnId]?.status === "loading";

    suggestGroups(boardId, columnId)
      .then(({ groups }) => {
        if (!stillWaiting()) return;
        setGroupReview(columnId, {
          status: "ready",
          groups: groups.map((ticketIds, i) => ({ key: groupKey(i), ticketIds, accepted: false })),
        });
      })
      .catch((err: unknown) => {
        if (!stillWaiting()) return;
        setGroupReview(columnId, {
          status: "error",
          message: err instanceof Error && err.message ? err.message : "The model did not answer.",
        });
      });
  };
}

interface GroupWithAiButtonProps {
  columnId: string;
  isBlurred: boolean;
}

export function GroupWithAiButton({ columnId, isBlurred }: GroupWithAiButtonProps) {
  const boardId = useBoardStore((s) => s.board?.id);
  const start = useStartReview(boardId, columnId);

  return (
    <button
      type="button"
      onClick={start}
      disabled={isBlurred}
      title={
        isBlurred
          ? "Reveal the cards to group them"
          : "Find the cards that make the same point, and review them before they merge"
      }
      className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink px-1.5 py-0.5 rounded transition-colors hover:bg-ink/5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <StackIcon />
      Group with AI
    </button>
  );
}

interface GroupReviewBarProps {
  columnId: string;
  cardCount: number;
  groups: LiveGroup[];
  isBlurred: boolean;
  send: (msg: ClientMessage) => void;
}

/** What the review stands at, and the controls that end it. It sits under the column name. */
export function GroupReviewBar({ columnId, cardCount, groups, isBlurred, send }: GroupReviewBarProps) {
  const review = useBoardStore((s) => s.groupReviews[columnId]);
  const boardId = useBoardStore((s) => s.board?.id);
  const endGroupReview = useBoardStore((s) => s.endGroupReview);
  const updateGroup = useBoardStore((s) => s.updateGroup);
  const setPendingUndo = useBoardStore((s) => s.setPendingUndo);
  const start = useStartReview(boardId, columnId);

  if (!review) return null;

  const close = () => endGroupReview(columnId);

  if (review.status === "loading") {
    return (
      <Bar>
        <p className="text-muted">Reading {cardCount} cards…</p>
        <div className="mt-2 h-0.5 rounded-full bg-border overflow-hidden" aria-hidden>
          <div className="h-full w-1/3 bg-accent/70 animate-group-read" />
        </div>
      </Bar>
    );
  }

  if (review.status === "error") {
    return (
      <Bar>
        <p>{review.message}</p>
        <div className="flex items-center gap-3 mt-2">
          <BarButton primary onClick={start}>
            Try again
          </BarButton>
          <BarButton onClick={close}>Close</BarButton>
        </div>
      </Bar>
    );
  }

  if (groups.length === 0) {
    return (
      <Bar>
        <p>No cards here make the same point.</p>
        <div className="mt-2">
          <BarButton onClick={close}>Close</BarButton>
        </div>
      </Bar>
    );
  }

  const accepted = groups.filter((g) => g.group.accepted);
  const cardsToMerge = accepted.reduce((n, g) => n + g.tickets.length, 0);

  function merge() {
    send({
      type: "MergeTicketGroups",
      payload: { groups: accepted.map((g) => g.tickets.map((t) => t.id)) },
    });
    setPendingUndo(
      `Merged ${cardsToMerge} cards into ${accepted.length} ${accepted.length === 1 ? "card" : "cards"}`,
    );
    close();
  }

  function acceptAll() {
    for (const g of groups) {
      updateGroup(columnId, g.group.key, (group) => ({ ...group, accepted: true }));
    }
  }

  return (
    <Bar>
      <p>
        {accepted.length} of {groups.length} {groups.length === 1 ? "group" : "groups"} accepted
      </p>
      {isBlurred && <p className="text-xs text-muted mt-0.5">Reveal the cards to merge them.</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
        <BarButton primary onClick={merge} disabled={accepted.length === 0 || isBlurred}>
          {accepted.length === 0
            ? "Merge"
            : `Merge ${accepted.length} ${accepted.length === 1 ? "group" : "groups"}`}
        </BarButton>
        {accepted.length < groups.length && <BarButton onClick={acceptAll}>Accept all</BarButton>}
        <BarButton onClick={close}>Cancel</BarButton>
      </div>
    </Bar>
  );
}

function Bar({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="mb-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm animate-fade-in"
    >
      {children}
    </div>
  );
}

function BarButton({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed ${
        primary
          ? "bg-accent text-white px-2.5 py-1 hover:bg-accent-hover disabled:hover:bg-accent"
          : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

interface SuggestedGroupProps {
  columnId: string;
  live: LiveGroup;
  /** Draws one card of the group. The column passes its own, so a card here is the same card. */
  renderTicket: (ticket: Ticket) => ReactNode;
}

/**
 * The cards of one suggestion, clipped together under the letter of the group. The outline is
 * dashed while the group is only suggested and solid once the reviewer accepts it.
 */
export function SuggestedGroup({ columnId, live, renderTicket }: SuggestedGroupProps) {
  const updateGroup = useBoardStore((s) => s.updateGroup);
  const { group, ink, tickets } = live;

  const toggleAccepted = () =>
    updateGroup(columnId, group.key, (g) => ({ ...g, accepted: !g.accepted }));
  const reject = () => updateGroup(columnId, group.key, () => null);
  const leaveOut = (ticketId: string) =>
    updateGroup(columnId, group.key, (g) => ({
      ...g,
      // The card leaves the group for good, so a later accept cannot pull it back in.
      ticketIds: g.ticketIds.filter((id) => id !== ticketId),
    }));

  return (
    <section aria-label={`Group ${group.key}: ${tickets.length} cards`} className="pt-3">
      <div
        className="relative rounded-xl px-2 pb-2 pt-4 transition-[border-color,background-color] duration-200 animate-group-gather"
        style={{
          border: `1.5px ${group.accepted ? "solid" : "dashed"} ${ink}`,
          backgroundColor: `color-mix(in oklab, ${ink} ${group.accepted ? 10 : 6}%, transparent)`,
        }}
      >
        {/* The clip: the letter of the group, sat on its edge. */}
        <div className="absolute -top-3 left-3 flex items-center gap-1.5 bg-canvas pr-2 rounded-full">
          <span
            className="w-6 h-6 rounded-full grid place-items-center font-display font-semibold text-xs text-white"
            style={{ backgroundColor: ink }}
            aria-hidden
          >
            {group.key}
          </span>
          <span className="text-xs font-medium" style={{ color: ink }}>
            {group.accepted
              ? `${tickets.length} cards will merge`
              : `${tickets.length} cards make the same point`}
          </span>
        </div>

        <div className="space-y-1.5">
          {tickets.map((ticket) => (
            <div key={ticket.id}>
              {renderTicket(ticket)}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => leaveOut(ticket.id)}
                  className="text-[11px] text-muted hover:text-ink px-1 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Leave out
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-1.5 px-1">
          <button
            type="button"
            onClick={toggleAccepted}
            aria-pressed={group.accepted}
            className="text-xs font-medium rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={
              group.accepted
                ? { backgroundColor: ink, color: "white", border: `1px solid ${ink}` }
                : { color: ink, border: `1px solid ${ink}` }
            }
          >
            {group.accepted ? "Accepted" : "Accept"}
          </button>
          <button
            type="button"
            onClick={reject}
            className="text-xs text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
          >
            Reject
          </button>
        </div>
      </div>
    </section>
  );
}
