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
  Select,
  Modal,
  Banner,
  EmptyState,
  Filters,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const claimed = url.searchParams.get("claimed") || undefined;

  let whereClause: any = { shop };

  if (status) {
    whereClause.status = status;
  }

  if (claimed === "true") {
    whereClause.claimedById = { not: null };
  } else if (claimed === "false") {
    whereClause.claimedById = null;
  }

  const checkouts = await db.abandonedCheckout.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: { claimedBy: true },
    take: 100,
  });

  // Use PlatformUsers (active Sales Reps) for assignment
  const platformUsers = await db.platformUser.findMany({
    where: { status: "ACTIVE", role: "SALES_REP" },
    orderBy: { firstName: "asc" },
  });

  const stats = {
    total: await db.abandonedCheckout.count({ where: { shop } }),
    abandoned: await db.abandonedCheckout.count({ where: { shop, status: "ABANDONED" } }),
    recovered: await db.abandonedCheckout.count({ where: { shop, status: "RECOVERED" } }),
    unclaimed: await db.abandonedCheckout.count({ where: { shop, claimedById: null } }),
  };

  return json({ checkouts, platformUsers, stats });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const checkoutId = formData.get("checkoutId") as string;

  if (intent === "claim") {
    const repId = formData.get("repId") as string;
    if (!checkoutId || !repId) {
      return json({ success: false, error: "Missing checkout or rep ID" }, { status: 400 });
    }
    try {
      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: { claimedById: repId, claimedAt: new Date() },
      });
      return json({ success: true });
    } catch (error) {
      return json({ success: false, error: "Failed to claim checkout" }, { status: 500 });
    }
  }

  if (intent === "unclaim") {
    if (!checkoutId) {
      return json({ success: false, error: "Missing checkout ID" }, { status: 400 });
    }
    try {
      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: { claimedById: null, claimedAt: null },
      });
      return json({ success: true });
    } catch (error) {
      return json({ success: false, error: "Failed to unclaim checkout" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function CheckoutsPage() {
  const { checkouts, platformUsers, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [selectedCheckout, setSelectedCheckout] = useState<string | null>(null);
  const [selectedRep, setSelectedRep] = useState<string>("");
  const [modalActive, setModalActive] = useState(false);

  const repChoices = [
    { label: "— Select a representative —", value: "" },
    ...platformUsers.map((rep: any) => ({
      label: `${rep.firstName || ""} ${rep.lastName || ""}`.trim() + ` (${rep.tier})`,
      value: rep.id,
    })),
  ];

  const checkoutRows = checkouts.map((checkout) => [
    checkout.checkoutId.slice(-8) + "…",
    checkout.email || "N/A",
    `${Number(checkout.totalPrice).toFixed(2)} ${checkout.currency}`,
    <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy
      ? `${checkout.claimedBy.firstName || ""} ${checkout.claimedBy.lastName || ""}`.trim()
      : <Badge tone="new">Unclaimed</Badge>,
    new Date(checkout.createdAt).toLocaleDateString(),
    <InlineStack gap="200">
      {!checkout.claimedBy && (
        <Button
          size="slim"
          variant="primary"
          onClick={() => {
            setSelectedCheckout(checkout.id);
            setSelectedRep("");
            setModalActive(true);
          }}
        >
          Assign
        </Button>
      )}
      {checkout.claimedBy && (
        <Button
          size="slim"
          variant="plain"
          tone="critical"
          onClick={() => {
            fetcher.submit(
              { intent: "unclaim", checkoutId: checkout.id },
              { method: "POST" }
            );
          }}
        >
          Unassign
        </Button>
      )}
    </InlineStack>,
  ]);

  return (
    <Page>
      <TitleBar title="Abandoned Checkouts" />

      <BlockStack gap="500">
        {/* Feedback */}
        {(fetcher.data as any)?.success === false && (
          <Banner tone="critical">
            <p>{(fetcher.data as any)?.error}</p>
          </Banner>
        )}

        {/* Stats */}
        <Layout>
          <Layout.Section>
            <InlineStack gap="400">
              {[
                { label: "Total Checkouts", value: stats.total, tone: "base" },
                { label: "Abandoned", value: stats.abandoned, tone: "warning" },
                { label: "Recovered", value: stats.recovered, tone: "success" },
                { label: "Unassigned", value: stats.unclaimed, tone: "critical" },
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

        {/* Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">All Abandoned Checkouts</Text>

                {checkouts.length === 0 ? (
                  <EmptyState heading="No checkouts yet" image="">
                    <p>Abandoned checkouts from your Shopify store will appear here when customers leave without completing their purchase.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
                    headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned To", "Created", "Actions"]}
                    rows={checkoutRows}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Claim/Assign Modal */}
      {selectedCheckout && (
        <Modal
          open={modalActive}
          onClose={() => {
            setModalActive(false);
            setSelectedCheckout(null);
            setSelectedRep("");
          }}
          title="Assign Checkout to Sales Rep"
          primaryAction={{
            content: "Assign",
            onAction: () => {
              if (selectedRep) {
                fetcher.submit(
                  { intent: "claim", checkoutId: selectedCheckout, repId: selectedRep },
                  { method: "POST" }
                );
                setModalActive(false);
                setSelectedCheckout(null);
                setSelectedRep("");
              }
            },
            disabled: !selectedRep,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => {
                setModalActive(false);
                setSelectedCheckout(null);
                setSelectedRep("");
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Select an active sales representative to handle this abandoned checkout.
              </Text>
              {platformUsers.length === 0 ? (
                <Banner tone="warning">
                  <p>No active platform users found. Approve applications from the <strong>Applications</strong> page first.</p>
                </Banner>
              ) : (
                <Select
                  label="Sales Representative"
                  options={repChoices}
                  value={selectedRep}
                  onChange={setSelectedRep}
                />
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
