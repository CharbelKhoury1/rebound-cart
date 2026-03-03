import { ApiVersion } from "@shopify/shopify-app-remix/server";

type RequiredEnvKey =
  | "SHOPIFY_API_KEY"
  | "SHOPIFY_API_SECRET"
  | "SHOPIFY_APP_URL"
  | "PLATFORM_ADMIN_EMAIL";

function readEnv(key: RequiredEnvKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. Please set it in your environment before starting the app.`
    );
  }
  return value;
}

export const appConfig = {
  shopify: {
    apiKey: readEnv("SHOPIFY_API_KEY"),
    apiSecretKey: readEnv("SHOPIFY_API_SECRET"),
    appUrl: readEnv("SHOPIFY_APP_URL"),
    apiVersion: ApiVersion.January25,
    scopes:
      (process.env.SCOPES ??
        "read_orders,read_checkouts,write_orders,write_checkouts,read_products,read_customers")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
  },
  platform: {
    adminEmail: readEnv("PLATFORM_ADMIN_EMAIL"),
  },
};

