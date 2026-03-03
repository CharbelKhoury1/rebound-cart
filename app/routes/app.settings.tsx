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
  Banner,
  Badge,
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
  const recoveryTone = formData.get("recoveryTone");
  const customInstructions = formData.get("customInstructions");

  try {
    const sDb = db.shopSettings as any;
    await sDb.upsert({
      where: { shop },
      update: {
        commissionRate: commissionRate ? Number(commissionRate) : undefined,
        isMarketplaceEnabled,
        recoveryTone: recoveryTone as string,
        customInstructions: customInstructions as string,
      },
      create: {
        shop,
        commissionRate: commissionRate ? Number(commissionRate) : 10.0,
        isMarketplaceEnabled,
        recoveryTone: (recoveryTone as string) || "FRIENDLY",
        customInstructions: customInstructions as string,
      },
    });
    return json({ success: true, message: "Settings updated successfully" });
  } catch (error) {
    console.error("Settings Update Error:", error);
    return json({ success: false, error: "Failed to update settings" }, { status: 500 });
  }
};

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();

  const [commissionRate, setCommissionRate] = useState(settings?.commissionRate?.toString() || "10");
  const [marketplaceEnabled, setMarketplaceEnabled] = useState(settings ? (settings as any).isMarketplaceEnabled : true);
  const [tone, setTone] = useState(settings?.recoveryTone || "FRIENDLY");
  const [instructions, setInstructions] = useState(settings?.customInstructions || "");

  return (
    <Page>
      <TitleBar title="Store Settings" />

      <BlockStack gap="500">
        <Layout>
          {actionData && (
            <Layout.Section>
              <Banner
                title={(actionData as any).success ? "Settings Saved" : "Save Failed"}
                tone={(actionData as any).success ? "success" : "critical"}
              >
                <p>{(actionData as any).success ? (actionData as any).message : (actionData as any).error}</p>
              </Banner>
            </Layout.Section>
          )}

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

                    <Select
                      label="Preferred Communication Tone"
                      name="recoveryTone"
                      options={[
                        { label: "Friendly (Warm & Helpful)", value: "FRIENDLY" },
                        { label: "Professional (Direct & Official)", value: "PROFESSIONAL" },
                        { label: "Urgent (High Priority)", value: "URGENT" },
                      ]}
                      value={tone}
                      onChange={setTone}
                    />

                    <TextField
                      label="Instructions for Representatives"
                      name="customInstructions"
                      value={instructions}
                      onChange={setInstructions}
                      multiline={4}
                      autoComplete="off"
                      placeholder="e.g. Please mention our current 20% sale or ask them if they had trouble with checkout."
                      helpText="Tell representatives what language or strategies to use when contacting your customers."
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
                  Active in Marketplace: <Badge tone={marketplaceEnabled ? "success" : "attention"}>{marketplaceEnabled ? "YES" : "NO"}</Badge>
                </Text>
                <Text as="p" tone="subdued">
                  Disabling marketplace access will hide your checkouts from all external representatives except those you manually assign.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
