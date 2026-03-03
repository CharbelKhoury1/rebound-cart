import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { json } from "@remix-run/node";

export const links: LinksFunction = () => [
    { rel: "stylesheet", href: polarisStyles },
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
    return json({
        apiKey: (await import("../config.server")).appConfig.shopify.apiKey,
    });
};

export default function PortalLayout() {
    const { apiKey } = useLoaderData<typeof loader>();

    return (
        <AppProvider isEmbeddedApp={false} apiKey={apiKey}>
            <div style={{
                minHeight: "100vh",
                backgroundColor: "#f1f2f4",
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
            }}>
                <Outlet />
            </div>
            <style dangerouslySetInnerHTML={{
                __html: `
                :root {
                    --p-font-family-sans: 'Inter', -apple-system, sans-serif;
                }
                .Polaris-Header-Title { font-weight: 700; letter-spacing: -0.02em; }
                .Polaris-Card { border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.05); }
                .Polaris-Page { max-width: 1200px; }
            `}} />
        </AppProvider>
    );
}

export function ErrorBoundary() {
    return (
        <div>
            <h1>Portal Error</h1>
            <p>Something went wrong in the portal.</p>
        </div>
    );
}
