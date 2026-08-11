/**
 * Signing in, when the server asks for it.
 *
 * The server runs the whole OIDC flow, so there is nothing here but three URLs and one check. A
 * browser that is not signed in never reaches this code: the request for the page itself is what
 * the server redirects, so the bundle only ever loads for somebody who is already through the door.
 * The one case left is a session that runs out while a board is open, which `redirectIfSignedOut`
 * answers.
 */

import { getServerUrl, isTauri } from "./serverUrl";

const LOGIN_PATH = "/api/auth/login";

/** Where to send the browser to sign in, coming back to where it is now. */
export function signInUrl(
  redirectTo: string = location.pathname + location.search,
): string {
  return `${getServerUrl()}${LOGIN_PATH}?redirect=${encodeURIComponent(redirectTo)}`;
}

/** Where to send the browser to sign out — here first, and then Entra. */
export function signOutUrl(): string {
  return `${getServerUrl()}/api/auth/logout`;
}

/**
 * Asks the server whether this browser is still signed in, and sends it to the door when it is not.
 *
 * Only a 401 means the session is gone. A server that asks nobody to sign in answers 404 here, and
 * a server that is simply down answers nothing — neither is a reason to leave the board.
 *
 * The desktop app is never sent anywhere: it cannot run a browser sign-in, and it is told so on the
 * way in rather than in the middle of a meeting.
 */
export async function redirectIfSignedOut(): Promise<boolean> {
  if (isTauri()) return false;

  try {
    const res = await fetch(`${getServerUrl()}/api/auth/me`, {
      credentials: "include",
    });
    if (res.status !== 401) return false;
  } catch {
    return false;
  }

  location.assign(signInUrl());
  return true;
}
