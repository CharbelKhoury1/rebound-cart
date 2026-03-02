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
  DataTable,
  Badge,
  Modal,
  Select,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const pendingApplications = await db.platformUser.findMany({
    where: { 
      status: "PENDING",
      role: "SALES_REP"
    },
    orderBy: { createdAt: "desc" },
  });

  return json({ pendingApplications });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "approve") {
    const userId = formData.get("userId") as string;
    const tier = formData.get("tier") as string;

    try {
      await db.platformUser.update({
        where: { id: userId },
        data: { 
          status: "ACTIVE",
          tier: tier,
        },
      });
      return json({ success: true, message: "Application approved" });
    } catch (error) {
      return json({ success: false, error: "Failed to approve application" }, { status: 500 });
    }
  }

  if (intent === "reject") {
    const userId = formData.get("userId") as string;
    const reason = formData.get("reason") as string;

    try {
      await db.platformUser.update({
        where: { id: userId },
        data: { 
          status: "REJECTED",
        },
      });
      return json({ success: true, message: "Application rejected" });
    } catch (error) {
      return json({ success: false, error: "Failed to reject application" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function AdminApprovalsPage() {
  const { pendingApplications } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [selectedApplication, setSelectedApplication] = useState<string | null>(null);
  const [modalActive, setModalActive] = useState(false);
  const fetcher = useFetcher();

  const applicationRows = pendingApplications.map((app: any) => [
    `${app.firstName} ${app.lastName}`,
    app.email,
    <Badge tone="warning">PENDING</Badge>,
    app.tier || "BRONZE",
    new Date(app.createdAt).toLocaleDateString(),
    <InlineStack gap="200">
      <Button size="slim" variant="plain" onClick={() => setSelectedApplication(app.id)}>Review</Button>
      <Button size="slim" variant="plain" onClick={() => {
        setSelectedApplication(app.id);
        setModalActive(true);
      }}>Quick Action</Button>
    </InlineStack>,
  ]);

  const tierChoices = [
    { label: "Bronze (15% commission)", value: "BRONZE" },
    { label: "Silver (18% commission)", value: "SILVER" },
    { label: "Gold (20% commission)", value: "GOLD" },
    { label: "Platinum (25% commission)", value: "PLATINUM" },
  ];

  return (
    <Page>
      <TitleBar title="Application Approvals" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Pending Applications</Text>
                <Text as="p" variant="bodyMd">
                  Review and approve applications from sales representatives wanting to join the ReboundCart marketplace.
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={["Name", "Email", "Tier", "Applied", "Actions"]}
                  rows={applicationRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Quick Action Modal */}
      {selectedApplication && (
        <Modal
          open={modalActive}
          onClose={() => {
            setModalActive(false);
            setSelectedApplication(null);
          }}
          title="Quick Actions"
          primaryAction={{
            content: "Approve",
            onAction: () => {
              fetcher.submit(
                { 
                  intent: "approve", 
                  userId: selectedApplication,
                  tier: "BRONZE" // Default tier
                },
                { method: "POST" }
              );
              setModalActive(false);
              setSelectedApplication(null);
            },
          }}
          secondaryActions={[
            {
              content: "Reject",
              onAction: () => {
                fetcher.submit(
                  { 
                    intent: "reject", 
                    userId: selectedApplication,
                    reason: "Does not meet requirements"
                  },
                  { method: "POST" }
                );
                setModalActive(false);
                setSelectedApplication(null);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                <strong>Application:</strong> {selectedApplication}
              </Text>
              <Select
                label="Assign Tier"
                options={tierChoices}
                defaultValue="BRONZE"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Action Messages */}
      {actionData?.success && (
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text tone="success" as="p">
                {actionData.message}
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
                Error: {actionData.error}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}
    </Page>
  );
}
