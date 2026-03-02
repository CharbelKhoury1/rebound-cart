import db from "./app/db.server";

async function check() {
    const sessions = await db.session.findMany();
    console.log("Sessions found:", sessions.map(s => ({ shop: s.shop, isOnline: s.isOnline })));
}

check();
