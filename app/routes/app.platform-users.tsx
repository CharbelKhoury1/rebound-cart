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
  TextField,
  Select,
  FormLayout,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const platformUsers = await db.platformUser.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      claimedCheckouts: { select: { id: true } },
      commissions: { select: { commissionAmount: true } },
    },
  });

  const stats = {
    total: platformUsers.length,
    active: platformUsers.filter((u) => u.status === "ACTIVE").length,
    pending: platformUsers.filter((u) => u.status === "PENDING").length,
    suspended: platformUsers.filter((u) => u.status === "SUSPENDED").length,
  };

  return json({ platformUsers, stats });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
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
          status: "ACTIVE",
          commissionRate: commissionRate,
        },
      });
      return json({ success: true, message: "User created successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to create user — email may already exist" }, { status: 500 });
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
      return json({ success: true, message: `User ${status.toLowerCase()} successfully` });
    } catch (error) {
      return json({ success: false, error: "Failed to update user status" }, { status: 500 });
    }
  }

  if (intent === "updateTier") {
    const userId = formData.get("userId") as string;
    const tier = formData.get("tier") as string;
    const commissionRate = formData.get("commissionRate") ? Number(formData.get("commissionRate")) : null;

    try {
      await db.platformUser.update({
        where: { id: userId },
        data: { tier, commissionRate },
      });
      return json({ success: true, message: "Tier updated successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to update tier" }, { status: 500 });
    }
  }

  if (intent === "delete") {
    const userId = formData.get("userId") as string;

    try {
      await db.platformUser.delete({ where: { id: userId } });
      return json({ success: true, message: "User removed successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to remove user" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

const TIER_OPTIONS = [
  { label: "Bronze — 15% commission", value: "BRONZE" },
  { label: "Silver — 18% commission", value: "SILVER" },
  { label: "Gold — 20% commission", value: "GOLD" },
  { label: "Platinum — 25% commission", value: "PLATINUM" },
];

const ROLE_OPTIONS = [
  { label: "Sales Representative", value: "SALES_REP" },
  { label: "Platform Admin", value: "PLATFORM_ADMIN" },
];

export default function PlatformUsersPage() {
  const { platformUsers, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [addModalActive, setAddModalActive] = useState(false);
  const [editUser, setEditUser] = useState<any | null>(null);

  // Form state for adding a new user
  const [newUser, setNewUser] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "SALES_REP",
    tier: "BRONZE",
    commissionRate: "",
  });

  // Form state for editing a user's tier
  const [editTier, setEditTier] = useState("BRONZE");
  const [editCommissionRate, setEditCommissionRate] = useState("");

  const isSubmitting = fetcher.state === "submitting";

  const userRows = platformUsers.map((user: any) => {
    const totalCommission = user.commissions?.reduce(
      (sum: number, c: any) => sum + Number(c.commissionAmount),
      0
    ) ?? 0;

    return [
      `${user.firstName || ""} ${user.lastName || ""}`.trim() || "—",
      user.email,
      <Badge tone={user.role === "PLATFORM_ADMIN" ? "info" : "success"}>
        {user.role === "PLATFORM_ADMIN" ? "Admin" : "Sales Rep"}
      </Badge>,
      <Badge
        tone={
          user.tier === "PLATINUM" ? "magic" :
            user.tier === "GOLD" ? "warning" :
              user.tier === "SILVER" ? "attention" :
                "new"
        }
      >
        {user.tier || "BRONZE"}
      </Badge>,
      <Badge
        tone={
          user.status === "ACTIVE" ? "success" :
            user.status === "PENDING" ? "warning" :
              user.status === "SUSPENDED" ? "attention" :
                "critical"
        }
      >
        {user.status}
      </Badge>,
      user.claimedCheckouts?.length?.toString() ?? "0",
      `$${totalCommission.toFixed(2)}`,
      new Date(user.createdAt).toLocaleDateString(),
      <InlineStack gap="200">
        <Button
          size="slim"
          variant="plain"
          onClick={() => {
            setEditUser(user);
            setEditTier(user.tier || "BRONZE");
            setEditCommissionRate(user.commissionRate?.toString() || "");
          }}
        >
          Edit Tier
        </Button>
        {user.status === "ACTIVE" && (
          <Button
            size="slim"
            variant="plain"
            tone="critical"
            onClick={() =>
              fetcher.submit(
                { intent: "updateStatus", userId: user.id, status: "SUSPENDED" },
                { method: "POST" }
              )
            }
          >
            Suspend
          </Button>
        )}
        {user.status === "SUSPENDED" && (
          <Button
            size="slim"
            variant="plain"
            onClick={() =>
              fetcher.submit(
                { intent: "updateStatus", userId: user.id, status: "ACTIVE" },
                { method: "POST" }
              )
            }
          >
            Reactivate
          </Button>
        )}
        {user.status === "PENDING" && (
          <Button
            size="slim"
            variant="primary"
            onClick={() =>
              fetcher.submit(
                { intent: "updateStatus", userId: user.id, status: "ACTIVE" },
                { method: "POST" }
              )
            }
          >
            Approve
          </Button>
        )}
      </InlineStack>,
    ];
  });

  return (
    <Page>
      <TitleBar title="Platform Users" />

      <BlockStack gap="500">
        {/* Feedback */}
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

        {/* Stats */}
        <Layout>
          <Layout.Section>
            <InlineStack gap="400">
              {[
                { label: "Total Users", value: stats.total, tone: "base" },
                { label: "Active", value: stats.active, tone: "success" },
                { label: "Pending", value: stats.pending, tone: "warning" },
                { label: "Suspended", value: stats.suspended, tone: "critical" },
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

        {/* Users Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Platform Users</Text>
                  <Button variant="primary" onClick={() => setAddModalActive(true)}>
                    Add User
                  </Button>
                </InlineStack>

                {platformUsers.length === 0 ? (
                  <EmptyState heading="No platform users yet" image="">
                    <p>Add users manually or approve applications from the Applications page.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "numeric", "numeric", "text", "text"]}
                    headings={["Name", "Email", "Role", "Tier", "Status", "Checkouts", "Commissions", "Joined", "Actions"]}
                    rows={userRows}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Add User Modal */}
      <Modal
        open={addModalActive}
        onClose={() => setAddModalActive(false)}
        title="Add Platform User"
        primaryAction={{
          content: isSubmitting ? "Adding..." : "Add User",
          onAction: () => {
            fetcher.submit(
              { intent: "create", ...newUser },
              { method: "POST" }
            );
            setAddModalActive(false);
            setNewUser({ email: "", firstName: "", lastName: "", role: "SALES_REP", tier: "BRONZE", commissionRate: "" });
          },
          disabled: !newUser.email || isSubmitting,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAddModalActive(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Email"
              type="email"
              value={newUser.email}
              onChange={(v) => setNewUser({ ...newUser, email: v })}
              autoComplete="email"
              requiredIndicator
            />
            <FormLayout.Group>
              <TextField
                label="First Name"
                value={newUser.firstName}
                onChange={(v) => setNewUser({ ...newUser, firstName: v })}
                autoComplete="given-name"
              />
              <TextField
                label="Last Name"
                value={newUser.lastName}
                onChange={(v) => setNewUser({ ...newUser, lastName: v })}
                autoComplete="family-name"
              />
            </FormLayout.Group>
            <Select
              label="Role"
              options={ROLE_OPTIONS}
              value={newUser.role}
              onChange={(v) => setNewUser({ ...newUser, role: v })}
            />
            <Select
              label="Commission Tier"
              options={TIER_OPTIONS}
              value={newUser.tier}
              onChange={(v) => setNewUser({ ...newUser, tier: v })}
            />
            <TextField
              label="Custom Commission Rate (%)"
              type="number"
              value={newUser.commissionRate}
              onChange={(v) => setNewUser({ ...newUser, commissionRate: v })}
              autoComplete="off"
              helpText="Leave blank to use tier default rate"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Edit Tier Modal */}
      {editUser && (
        <Modal
          open={!!editUser}
          onClose={() => setEditUser(null)}
          title={`Edit Tier: ${editUser.firstName} ${editUser.lastName}`}
          primaryAction={{
            content: isSubmitting ? "Saving..." : "Save Changes",
            onAction: () => {
              fetcher.submit(
                { intent: "updateTier", userId: editUser.id, tier: editTier, commissionRate: editCommissionRate },
                { method: "POST" }
              );
              setEditUser(null);
            },
            disabled: isSubmitting,
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setEditUser(null) }]}
        >
          <Modal.Section>
            <FormLayout>
              <Select
                label="Commission Tier"
                options={TIER_OPTIONS}
                value={editTier}
                onChange={setEditTier}
              />
              <TextField
                label="Custom Commission Rate (%)"
                type="number"
                value={editCommissionRate}
                onChange={setEditCommissionRate}
                autoComplete="off"
                helpText="Leave blank to use the tier's default rate"
              />
            </FormLayout>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
