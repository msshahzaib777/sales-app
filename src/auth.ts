import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authenticate } from "@/server/auth/credentials";

// Auth.js v5 with email + password (credentials) and JWT sessions. The token only carries the
// user id and session version; role, tenant and active status are re-read from the database on
// every request (src/server/auth/session.ts), so changes take effect immediately.

declare module "next-auth" {
  interface User {
    sessionVersion?: number;
  }
  interface Session {
    sessionVersion: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    sessionVersion?: number;
  }
}

/**
 * SPEC §13 session timeout. The session cookie is renewed at most every 15 minutes while the user
 * is active, so a session ends after 8 hours without activity (about one office day).
 */
const SESSION_IDLE_TIMEOUT = 8 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_IDLE_TIMEOUT, updateAge: 15 * 60 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      authorize: (credentials) => authenticate(credentials?.email, credentials?.password),
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.sessionVersion = token.sessionVersion ?? 0;
      return session;
    },
  },
});
