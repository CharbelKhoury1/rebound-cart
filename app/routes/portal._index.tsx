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
            <div style={{
                minHeight: "80vh",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center"
            }}>
                <BlockStack gap="600">
                    <Box>
                        <BlockStack gap="300" align="center">
                            <Text as="h1" variant="heading2xl" alignment="center" tone="magic">ReboundCart</Text>
                            <Text as="p" variant="bodyLg" tone="subdued" alignment="center">
                                High-performance recovery workspace for platform representatives.
                            </Text>
                        </BlockStack>
                    </Box>

                    <Card>
                        <Box padding="500">
                            <Form method="post">
                                <BlockStack gap="500">
                                    <Text as="h2" variant="headingLg">Enterprise Sign In</Text>
                                    {actionData?.error && (
                                        <Banner tone="critical">
                                            <p>{actionData.error}</p>
                                        </Banner>
                                    )}
                                    <TextField
                                        label="Corporate Email"
                                        type="email"
                                        name="email"
                                        value={email}
                                        onChange={setEmail}
                                        autoComplete="email"
                                        placeholder="your.name@reboundcart.com"
                                        helpText="Enter your official platform credentials."
                                        labelHidden
                                    />
                                    <Button submit variant="primary" loading={isLoggingIn} fullWidth size="large">
                                        Access Workspace
                                    </Button>
                                </BlockStack>
                            </Form>
                        </Box>
                    </Card>

                    <InlineStack align="center">
                        <Text as="p" tone="subdued">
                            Need an account? <Button variant="plain" onClick={() => { }}>Apply as a Representative</Button>
                        </Text>
                    </InlineStack>
                </BlockStack>
            </div>
        </Page>
    );
}
