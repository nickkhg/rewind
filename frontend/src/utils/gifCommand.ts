/**
 * The slash command that opens the GIF pane.
 *
 * It has to sit at the end of the draft, because the words after it are the search: the composer
 * itself is the search field, and the pane is a window onto what the writer is already typing.
 * A newline closes the command, so a card can hold the word "/gif" in a later line without the
 * pane opening again.
 */
const GIF_COMMAND = /(?:^|\s)\/(?:gif|giphy)(?:[ \t]+([^\n]*))?$/i;

export interface GifCommand {
  /** What to search GIPHY for. Empty asks for what is trending. */
  query: string;
  /** Where the slash sits, so that picking a GIF can take the command back out of the draft. */
  start: number;
}

/** Reads the GIF command off the end of a draft. Gives null when there is none. */
export function parseGifCommand(text: string): GifCommand | null {
  const match = GIF_COMMAND.exec(text);
  if (!match) return null;

  // The pattern may have taken the space in front of the slash. The command starts at the slash.
  const slash = match.index + match[0].indexOf("/");

  return { query: (match[1] ?? "").trim(), start: slash };
}

/**
 * Takes the command back out of a draft once the writer has picked a GIF.
 * The words they typed to find it were the search, not the card, so they go too.
 */
export function removeGifCommand(text: string, command: GifCommand): string {
  return text.slice(0, command.start).replace(/[ \t]+$/, "");
}
