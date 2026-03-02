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
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const platformUsers = await db.platformUser.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      claimedCheckouts: {
        select: { id: true },
      },
      commissions: {
        select: { commissionAmount: true },
      },
    },
  });

  return json({ platformUsers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const email = formData.get("email") as string;
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const role = formData.get("role") as string;
    const tier = formData.get("tier") as string;
    const commissionRate = formData.get("commissionRate") ? Number(formData.get("commissionRate")) : null;

    if (!email) {
      return json({ success: false, error: "Email is required" }, { status: 400 });
    }

    try {
      await db.platformUser.create({
        data: {
          email,
          firstName: firstName || null,
          lastName: lastName || null,
          role: role || "SALES_REP",
          tier: tier || "BRONZE",
          commissionRate: commissionRate,
        },
      });
      return json({ success: true });
    } catch (error) {
      return json({ success: false, error: "Failed to create platform user" }, { status: 500 });
    }
  }

  if (intent === "updateStatus") {
    const userId = formData.get("userId") as string;
    const status = formData.get("status") as string;

    try {
      await db.platformUser.update({
        where: { id: userId },
        data: { status },
      });
      return json({ success: true });
    } catch (error) {
      return json({ success: false, error: "Failed to update user status" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function PlatformUsersPage() {
  const { platformUsers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [modalActive, setModalActive] = useState(false);
  const fetcher = useFetcher();

  const userRows = platformUsers.map((user: any) => [
    `${user.firstName} ${user.lastName}`,
    user.email,
    <Badge tone={user.role === "PLATFORM_ADMIN" ? "info" as const : "success" as const}>
      {user.role}
    </Badge>,
    <Badge tone={
      user.tier === "PLATINUM" ? "magic" as const :
      user.tier === "GOLD" ? "warning" as const :
      user.tier === "SILVER" ? "attention" as const :
      "new" as const
    }>
      {user.tier || "BRONZE"}
    </Badge>,
    <Badge tone={user.status === "ACTIVE" ? "success" as const : user.status === "SUSPENDED" ? "warning" as const : "critical" as const}>
      {user.status}
    </Badge>,
    user.claimedCheckouts?.length.toString() || "0",
    user.commissions?.reduce((sum: number, c: any) => sum + Number(c.commissionAmount), 0).toFixed(2) || "0.00",
    new Date(user.createdAt).toLocaleDateString(),
    <InlineStack gap="200">
      <Button size="slim" variant="plain">Edit</Button>
      <Button size="slim" variant="plain" tone="critical">Suspend</Button>
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
      <TitleBar title="Platform Users" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Platform Users</Text>
                  <Button onClick={() => setModalActive(true)}>Add User</Button>
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text", "text"]}
                  headings={["Name", "Email", "Role", "Tier", "Status", "Checkouts", "Commissions", "Joined", "Actions"]}
                  rows={userRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Add User Modal */}
      <Modal
        open={modalActive}
        onClose={() => setModalActive(false)}
        title="Add Platform User"
        primaryAction={{
          content: "Add User",
          onAction: () => {
            const form = document.getElementById("user-form") as HTMLFormElement;
            if (form) form.requestSubmit();
            setModalActive(false);
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setModalActive(false),
          },
        ]}
      >
        <Modal.Section>
          <fetcher.Form method="POST" id="user-form">
            <input type="hidden" name="intent" value="create" />
            <FormLayout>
              <TextField
                name="email"
                label="Email"
                type="email"
              />
              <TextField
                name="firstName"
                label="First Name"
              />
              <TextField
                name="lastName"
                label="Last Name"
              />
              <Select
                name="role"
                label="Role"
                options={[
                  { label: "Sales Representative", value: "SALES_REP" },
                  { label: "Platform Admin", value: "PLATFORM_ADMIN" },
                ]}
              />
              <Select
                name="tier"
                label="Tier"
                options={tierChoices}
              />
              <TextField
                name="commissionRate"
                label="Commission Rate (%)"
                type="number"
              />
            </FormLayout>
          </fetcher.Form>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
