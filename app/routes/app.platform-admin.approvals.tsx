import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Platform admin access control
  const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || "admin@reboundcart.com";
  if ((session as any).email !== PLATFORM_ADMIN_EMAIL) {
    throw new Response("Unauthorized: Platform admin access required", { status: 403 });
  }

  const pendingApplications = await db.platformUser.findMany({
    where: {
      status: "PENDING",
      role: "SALES_REP",
    },
    orderBy: { createdAt: "desc" },
  });

  const stats = {
    total: await db.platformUser.count({ where: { role: "SALES_REP" } }),
    pending: await db.platformUser.count({ where: { status: "PENDING", role: "SALES_REP" } }),
    active: await db.platformUser.count({ where: { status: "ACTIVE", role: "SALES_REP" } }),
    rejected: await db.platformUser.count({ where: { status: "REJECTED", role: "SALES_REP" } }),
  };

  return json({ pendingApplications, stats });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || "admin@reboundcart.com";
  if ((session as any).email !== PLATFORM_ADMIN_EMAIL) {
    throw new Response("Unauthorized", { status: 403 });
  }

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
          tier: tier || "BRONZE",
        },
      });
      return json({ success: true, message: "Application approved successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to approve application" }, { status: 500 });
    }
  }

  if (intent === "reject") {
    const userId = formData.get("userId") as string;

    try {
      await db.platformUser.update({
        where: { id: userId },
        data: { status: "REJECTED" },
      });
      return json({ success: true, message: "Application rejected" });
    } catch (error) {
      return json({ success: false, error: "Failed to reject application" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

const TIER_CHOICES = [
  { label: "Bronze — 15% commission", value: "BRONZE" },
  { label: "Silver — 18% commission", value: "SILVER" },
  { label: "Gold — 20% commission", value: "GOLD" },
  { label: "Platinum — 25% commission", value: "PLATINUM" },
];

export default function AdminApprovalsPage() {
  const { pendingApplications, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [selectedApplication, setSelectedApplication] = useState<{ id: string; name: string } | null>(null);
  const [modalActive, setModalActive] = useState(false);
  const [selectedTier, setSelectedTier] = useState("BRONZE");

  const isSubmitting = fetcher.state === "submitting";

  const handleApprove = () => {
    if (!selectedApplication) return;
    fetcher.submit(
      { intent: "approve", userId: selectedApplication.id, tier: selectedTier },
      { method: "POST" }
    );
    setModalActive(false);
    setSelectedApplication(null);
  };

  const handleReject = () => {
    if (!selectedApplication) return;
    fetcher.submit(
      { intent: "reject", userId: selectedApplication.id },
      { method: "POST" }
    );
    setModalActive(false);
    setSelectedApplication(null);
  };

  const applicationRows = pendingApplications.map((app: any) => [
    `${app.firstName || ""} ${app.lastName || ""}`.trim() || "—",
    app.email,
    <Badge tone="warning">PENDING</Badge>,
    <Badge
      tone={
        app.tier === "PLATINUM" ? "magic" :
          app.tier === "GOLD" ? "warning" :
            app.tier === "SILVER" ? "attention" :
              "new"
      }
    >
      {app.tier || "BRONZE"}
    </Badge>,
    new Date(app.createdAt).toLocaleDateString(),
    <InlineStack gap="200">
      <Button
        size="slim"
        variant="primary"
        onClick={() => {
          setSelectedApplication({ id: app.id, name: `${app.firstName} ${app.lastName}` });
          setSelectedTier(app.tier || "BRONZE");
          setModalActive(true);
        }}
      >
        Review
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page>
      <TitleBar title="Application Approvals" />

      <BlockStack gap="500">
        {/* Feedback banner */}
        {(fetcher.data as any)?.success === true && (
          <Banner tone="success" onDismiss={() => { }}>
            <p>{(fetcher.data as any)?.message}</p>
          </Banner>
        )}
        {(fetcher.data as any)?.success === false && (
          <Banner tone="critical" onDismiss={() => { }}>
            <p>{(fetcher.data as any)?.error}</p>
          </Banner>
        )}

        {/* Stats Row */}
        <Layout>
          <Layout.Section>
            <InlineStack gap="400">
              {[
                { label: "Total Reps", value: stats.total, tone: "base" },
                { label: "Pending Review", value: stats.pending, tone: "warning" },
                { label: "Active Reps", value: stats.active, tone: "success" },
                { label: "Rejected", value: stats.rejected, tone: "critical" },
              ].map(({ label, value, tone }) => (
                <Card key={label}>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                    <Text as="p" variant="headingLg" tone={tone as any} fontWeight="bold">{value}</Text>
                  </BlockStack>
                </Card>
              ))}
            </InlineStack>
          </Layout.Section>
        </Layout>

        {/* Applications Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Pending Applications</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Review and approve sales representatives wanting to join the ReboundCart marketplace.
                  </Text>
                </BlockStack>

                {pendingApplications.length === 0 ? (
                  <EmptyState
                    heading="No pending applications"
                    image=""
                  >
                    <p>All applications have been reviewed. New applications from the Public Signup page will appear here.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                    headings={["Name", "Email", "Status", "Requested Tier", "Applied", "Actions"]}
                    rows={applicationRows}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Review Modal */}
      {selectedApplication && (
        <Modal
          open={modalActive}
          onClose={() => {
            setModalActive(false);
            setSelectedApplication(null);
          }}
          title={`Review Application: ${selectedApplication.name}`}
          primaryAction={{
            content: isSubmitting ? "Processing..." : "Approve",
            onAction: handleApprove,
            disabled: isSubmitting,
          }}
          secondaryActions={[
            {
              content: "Reject Application",
              onAction: handleReject,
              destructive: true,
              disabled: isSubmitting,
            },
            {
              content: "Cancel",
              onAction: () => {
                setModalActive(false);
                setSelectedApplication(null);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Approve this application and assign an initial commission tier. The user will be notified and can start claiming abandoned checkouts.
              </Text>
              <Select
                label="Assign Commission Tier"
                options={TIER_CHOICES}
                value={selectedTier}
                onChange={setSelectedTier}
                helpText="Higher tiers offer better commission rates and premium features."
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
