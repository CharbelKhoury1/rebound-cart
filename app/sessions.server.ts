import { createCookieSessionStorage } from "@remix-run/node";

export const sessionStorage = createCookieSessionStorage({
    cookie: {
        name: "__portal_session",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secrets: [process.env.SHOPIFY_API_SECRET || "secret"],
        secure: process.env.NODE_ENV === "production",
    },
});

export const { getSession, commitSession, destroySession } = sessionStorage;
