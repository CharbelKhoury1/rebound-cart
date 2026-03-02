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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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

  try {
    await db.shopSettings.upsert({
      where: { shop },
      update: { 
        commissionRate: commissionRate ? Number(commissionRate) : undefined,
      },
      create: { 
        shop, 
        commissionRate: commissionRate ? Number(commissionRate) : 10.0,
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

  return (
    <Page>
      <TitleBar title="Store Settings" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Commission Settings</Text>
                <fetcher.Form method="POST">
                  <FormLayout>
                    <TextField
                      label="Commission Rate (%)"
                      name="commissionRate"
                      type="number"
                      value={settings?.commissionRate?.toString() || "10"}
                      autoComplete="off"
                      suffix="%"
                      helpText="Percentage of recovered order value paid to sales representatives"
                    />
                    <Button submit variant="primary">Save Settings</Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Store Information</Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    <strong>Shop Domain:</strong> {settings?.shop}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Current Commission Rate:</strong> {settings?.commissionRate}%
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Action Messages */}
      {actionData?.success && (
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text tone="success" as="p">
                Settings updated successfully
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      {actionData?.error && (
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text tone="critical" as="p">
                Error: Failed to update settings
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}
    </Page>
  );
}
