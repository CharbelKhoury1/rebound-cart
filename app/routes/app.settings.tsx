import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  FormLayout,
  Checkbox,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get shop settings
  const settings = await db.shopSettings.findUnique({
    where: { shop }
  });

  return json({ settings });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const commissionRate = formData.get("commissionRate");
  const isMarketplaceEnabled = formData.get("isMarketplaceEnabled") === "true";

  try {
    await db.shopSettings.upsert({
      where: { shop },
      update: {
        commissionRate: commissionRate ? Number(commissionRate) : undefined,
        isMarketplaceEnabled,
      },
      create: {
        shop,
        commissionRate: commissionRate ? Number(commissionRate) : 10.0,
        isMarketplaceEnabled,
      },
    });
    return json({ success: true, message: "Settings updated successfully" });
  } catch (error) {
    return json({ success: false, error: "Failed to update settings" }, { status: 500 });
  }
};

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();

  const [commissionRate, setCommissionRate] = useState(settings?.commissionRate?.toString() || "10");
  const [marketplaceEnabled, setMarketplaceEnabled] = useState(settings ? (settings as any).isMarketplaceEnabled : true);

  return (
    <Page>
      <TitleBar title="Store Settings" />

      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Platform Configuration</Text>
                <fetcher.Form method="POST">
                  <FormLayout>
                    <TextField
                      label="Default Representative Commission (%)"
                      name="commissionRate"
                      type="number"
                      value={commissionRate}
                      onChange={setCommissionRate}
                      autoComplete="off"
                      suffix="%"
                      helpText="The base rate paid to reps for successful recoveries."
                    />

                    <Box paddingBlockStart="200">
                      <Checkbox
                        label="Enable Marketplace Access"
                        checked={marketplaceEnabled}
                        onChange={setMarketplaceEnabled}
                        helpText="When enabled, your abandoned checkouts will be visible to our marketplace of sales representatives."
                      />
                      <input type="hidden" name="isMarketplaceEnabled" value={marketplaceEnabled.toString()} />
                    </Box>

                    <Button submit variant="primary" loading={fetcher.state === "submitting"}>
                      Save Configuration
                    </Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Marketplace Summary</Text>
                <Text as="p">
                  Active in Marketplace: <strong>{marketplaceEnabled ? "YES" : "NO"}</strong>
                </Text>
                <Text as="p" tone="subdued">
                  Disabling marketplace access will hide your checkouts from all external representatives except those you manually assign.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Action Messages */}
        {actionData && (
          <Layout.Section>
            {actionData.success ? (
              <Box padding="400">
                <Text tone="success" as="p">Settings updated successfully</Text>
              </Box>
            ) : (
              <Box padding="400">
                <Text tone="critical" as="p">{actionData.error || "Failed to update settings"}</Text>
              </Box>
            )}
          </Layout.Section>
        )}
      </BlockStack>
    </Page>
  );
}
