import { userHasPassword } from "@naisys/supervisor-database";

export function isPasswordLoginAllowed(): boolean {
  return process.env.ALLOW_PASSWORD_LOGIN === "true";
}

/** True only when the optional password path is enabled AND the user has a password on file. */
export async function userHasEnabledPassword(userId: number): Promise<boolean> {
  if (!isPasswordLoginAllowed()) return false;
  return userHasPassword(userId);
}
