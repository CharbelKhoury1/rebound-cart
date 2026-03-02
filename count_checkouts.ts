import db from "./app/db.server";

async function check() {
    const count = await db.abandonedCheckout.count();
    console.log(`Total Abandoned Checkouts in DB: ${count}`);
}

check();
