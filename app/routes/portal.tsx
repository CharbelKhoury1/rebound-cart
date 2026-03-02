import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { json } from "@remix-run/node";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
    });
};

export default function PortalLayout() {
    const { apiKey } = useLoaderData<typeof loader>();

    return (
        <AppProvider isEmbeddedApp={false} apiKey={apiKey}>
            <div style={{ minHeight: "100vh", backgroundColor: "#f6f6f7" }}>
                <Outlet />
            </div>
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
