import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, Form, useNavigation } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    TextField,
    Button,
    BlockStack,
    Text,
    Banner,
    InlineStack,
    Box,
} from "@shopify/polaris";
import db from "../db.server";
import { getSession, commitSession } from "../sessions.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const session = await getSession(request.headers.get("Cookie"));
    if (session.has("userId")) {
        const userRole = session.get("userRole");
        if (userRole === "PLATFORM_ADMIN") return redirect("/portal/admin");
        if (userRole === "SALES_REP") return redirect("/portal/rep");
    }
    return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const formData = await request.formData();
    const email = formData.get("email") as string;

    const user = await db.platformUser.findUnique({
        where: { email },
    });

    if (!user || user.status !== "ACTIVE") {
        return json({ error: "Invalid email or account is inactive." }, { status: 401 });
    }

    const session = await getSession(request.headers.get("Cookie"));
    session.set("userId", user.id);
    session.set("userEmail", user.email);
    session.set("userRole", user.role);

    const redirectUrl = user.role === "PLATFORM_ADMIN" ? "/portal/admin" : "/portal/rep";

    return redirect(redirectUrl, {
        headers: {
            "Set-Cookie": await commitSession(session),
        },
    });
};

export default function PortalLogin() {
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isLoggingIn = navigation.state === "submitting";
    const [email, setEmail] = useState("");

    return (
        <Page narrowWidth>
            <div style={{ marginTop: "100px" }}>
                <BlockStack gap="500">
                    <Box>
                        <BlockStack gap="200" align="center">
                            <Text as="h1" variant="headingXl" alignment="center">Rebound Portal</Text>
                            <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                                Access your recovery workspace and performance metrics.
                            </Text>
                        </BlockStack>
                    </Box>

                    <Card>
                        <Form method="post">
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Sign In</Text>
                                {actionData?.error && (
                                    <Banner tone="critical">
                                        <p>{actionData.error}</p>
                                    </Banner>
                                )}
                                <TextField
                                    label="Email Address"
                                    type="email"
                                    name="email"
                                    value={email}
                                    onChange={setEmail}
                                    autoComplete="email"
                                    placeholder="name@reboundcart.com"
                                    helpText="Use the email provided by your administrator."
                                />
                                <Button submit variant="primary" loading={isLoggingIn} fullWidth size="large">
                                    Enter Portal
                                </Button>
                            </BlockStack>
                        </Form>
                    </Card>

                    <Box padding="400">
                        <Text as="p" tone="subdued" alignment="center">
                            Lost access? Contact support@reboundcart.com
                        </Text>
                    </Box>
                </BlockStack>
            </div>
        </Page>
    );
}
