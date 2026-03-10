export const SESSION_COOKIE_NAME = "naisys_session";

export function sessionCookieOptions(expiresAt: Date) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  };
}
