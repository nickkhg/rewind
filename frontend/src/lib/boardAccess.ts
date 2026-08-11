/**
 * The key to a locked board, kept per board for as long as the tab is open.
 *
 * The password itself is never stored. It buys a key at the gate, and the key is what every
 * later request carries — the REST calls in a header, the socket in its Join. A new password on
 * the board makes a new key, so the one here stops working and the gate comes back.
 */

const KEY_PREFIX = "board_access_";

export function getAccessToken(boardId: string): string | null {
  return sessionStorage.getItem(`${KEY_PREFIX}${boardId}`);
}

export function setAccessToken(boardId: string, token: string): void {
  sessionStorage.setItem(`${KEY_PREFIX}${boardId}`, token);
}

export function clearAccessToken(boardId: string): void {
  sessionStorage.removeItem(`${KEY_PREFIX}${boardId}`);
}

/** The header that carries the key. A GET has no body to put it in. */
export const ACCESS_TOKEN_HEADER = "X-Board-Access";

/** The header for a board, or nothing when this tab holds no key to it. */
export function accessHeader(boardId: string): Record<string, string> {
  const token = getAccessToken(boardId);
  return token ? { [ACCESS_TOKEN_HEADER]: token } : {};
}
