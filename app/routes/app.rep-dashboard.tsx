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
  TextField,
  Select,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // For now, use a mock rep - in real implementation, this would use JWT auth
  const mockRepEmail = "rep@reboundcart.com";
  
  // Get sales rep data
  const salesRep = await db.platformUser.findUnique({
    where: { email: mockRepEmail },
    include: {
      claimedCheckouts: {
        where: { status: "ABANDONED" },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      commissions: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!salesRep) {
    throw new Response("Sales representative not found", { status: 404 });
  }

  // Calculate performance metrics
  const totalCheckouts = salesRep.claimedCheckouts?.length || 0;
  const recoveredCheckouts = salesRep.claimedCheckouts?.filter((c: any) => c.status === "RECOVERED").length || 0;
  const totalEarnings = salesRep.commissions?.reduce((sum: number, c: any) => sum + Number(c.commissionAmount), 0) || 0;
  const recoveryRate = totalCheckouts > 0 ? (recoveredCheckouts / totalCheckouts) * 100 : 0;

  return json({
    salesRep,
    stats: {
      totalCheckouts,
      recoveredCheckouts,
      recoveryRate,
      totalEarnings,
      tier: salesRep.tier || "BRONZE",
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "claimCheckout") {
    const checkoutId = formData.get("checkoutId") as string;
    const repEmail = "rep@reboundcart.com"; // Mock rep email

    try {
      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: { 
          claimedById: repEmail,
          claimedAt: new Date(),
        },
      });
      return json({ success: true, message: "Checkout claimed successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to claim checkout" }, { status: 500 });
    }
  }

  if (intent === "unclaimCheckout") {
    const checkoutId = formData.get("checkoutId") as string;

    try {
      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: { 
          claimedById: null,
          claimedAt: null,
        },
      });
      return json({ success: true, message: "Checkout unclaimed successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to unclaim checkout" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function RepDashboard() {
  const { salesRep, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [selectedCheckout, setSelectedCheckout] = useState<any>(null);
  const [modalActive, setModalActive] = useState(false);
  const fetcher = useFetcher();

  const checkoutRows = salesRep.claimedCheckouts?.map((checkout: any) => [
    checkout.checkoutId.slice(-8) + "...",
    checkout.email || "N/A",
    `${checkout.totalPrice} ${checkout.currency}`,
    <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    new Date(checkout.createdAt).toLocaleDateString(),
    <InlineStack gap="200">
      <Button size="slim" variant="plain" onClick={() => {
        setSelectedCheckout(checkout);
        setModalActive(true);
      }}>View</Button>
      {checkout.status === "ABANDONED" && (
        <Button size="slim" variant="plain" onClick={() => {
          fetcher.submit(
            { intent: "claimCheckout", checkoutId: checkout.id },
            { method: "POST" }
          );
        }}>Claim</Button>
      )}
    </InlineStack>,
  ]) || [];

  const commissionRows = salesRep.commissions?.map((commission: any) => [
    commission.orderNumber || commission.orderId.slice(-8) + "...",
    `$${commission.commissionAmount.toFixed(2)}`,
    <Badge tone={commission.status === "PAID" ? "success" : "warning"}>
      {commission.status}
    </Badge>,
    new Date(commission.createdAt).toLocaleDateString(),
  ]) || [];

  return (
    <Page>
      <TitleBar title="Sales Rep Dashboard" />
      
      <BlockStack gap="500">
        <Layout>
          {/* Rep Profile & Stats */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Profile</Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    <strong>Name:</strong> {salesRep.firstName} {salesRep.lastName}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Email:</strong> {salesRep.email}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Tier:</strong> {salesRep.tier || "BRONZE"}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Status:</strong> {salesRep.status}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Performance</Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    <strong>Total Checkouts:</strong> {stats.totalCheckouts}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Recovered:</strong> {stats.recoveredCheckouts}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Recovery Rate:</strong> {stats.recoveryRate.toFixed(1)}%
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Total Earnings:</strong> ${stats.totalEarnings.toFixed(2)}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* My Checkouts */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Assigned Checkouts</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned", "Actions"]}
                  rows={checkoutRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* My Commissions */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Commissions</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Order", "Amount", "Status", "Date"]}
                  rows={commissionRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Checkout Details Modal */}
      {selectedCheckout && (
        <Modal
          open={modalActive}
          onClose={() => {
            setModalActive(false);
            setSelectedCheckout(null);
          }}
          title="Checkout Details"
          primaryAction={{
            content: "Close",
            onAction: () => {
              setModalActive(false);
              setSelectedCheckout(null);
            },
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Checkout Information</Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  <strong>Checkout ID:</strong> {selectedCheckout.checkoutId}
                </Text>
                <Text as="p" variant="bodyMd">
                  <strong>Customer Email:</strong> {selectedCheckout.email || "N/A"}
                </Text>
                <Text as="p" variant="bodyMd">
                  <strong>Amount:</strong> {selectedCheckout.totalPrice} {selectedCheckout.currency}
                </Text>
                <Text as="p" variant="bodyMd">
                  <strong>Status:</strong> {selectedCheckout.status}
                </Text>
                <Text as="p" variant="bodyMd">
                  <strong>Created:</strong> {new Date(selectedCheckout.createdAt).toLocaleDateString()}
                </Text>
                {selectedCheckout.checkoutUrl && (
                  <Text as="p" variant="bodyMd">
                    <strong>Checkout URL:</strong> 
                    <Button variant="plain" url={selectedCheckout.checkoutUrl}>View Original Checkout</Button>
                  </Text>
                )}
              </BlockStack>
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
