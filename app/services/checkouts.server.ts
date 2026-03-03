import db from "../db.server";

export async function getPlatformAdminDashboardStats() {
  const [totalStores, totalReps, totalCheckouts, totalRecovered] = await Promise.all([
    db.shopSettings.count(),
    db.platformUser.count({ where: { role: "SALES_REP" } }),
    db.abandonedCheckout.count(),
    db.abandonedCheckout.count({ where: { status: "RECOVERED" } }),
  ]);

  const globalCommission = await db.commission.aggregate({
    _sum: { commissionAmount: true, platformFee: true },
  });

  return {
    totalStores,
    totalReps,
    totalCheckouts,
    totalRecovered,
    totalEarnings: Number(globalCommission._sum.commissionAmount || 0),
    platformFees: Number(globalCommission._sum.platformFee || 0),
    recoveryRate: totalCheckouts > 0 ? (totalRecovered / totalCheckouts) * 100 : 0,
  };
}

export async function getSalesRepDashboardStats(repId: string) {
  const [claimedCount, recoveredCount, commissionStats] = await Promise.all([
    db.abandonedCheckout.count({ where: { claimedById: repId } }),
    db.abandonedCheckout.count({
      where: { claimedById: repId, status: "RECOVERED" },
    }),
    db.commission.aggregate({
      where: { repId },
      _sum: { commissionAmount: true },
    }),
  ]);

  return {
    totalCheckouts: claimedCount,
    recoveredCheckouts: recoveredCount,
    recoveryRate: claimedCount > 0 ? (recoveredCount / claimedCount) * 100 : 0,
    totalEarnings: Number(commissionStats._sum.commissionAmount || 0),
  };
}

export async function getStoreOwnerDashboard(shop: string) {
  let settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await db.shopSettings.create({
      data: { shop, commissionRate: 10.0 },
    });
  }

  const [totalAbandoned, totalRecovered, commissions, recentCheckouts, topReps, pendingClaimsCount] =
    await Promise.all([
      db.abandonedCheckout.count({ where: { shop } }),
      db.abandonedCheckout.count({ where: { shop, status: "RECOVERED" } }),
      db.commission.findMany({
        where: { checkout: { shop } },
        select: { commissionAmount: true },
      }),
      db.abandonedCheckout.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { claimedBy: true },
      }),
      db.platformUser.findMany({
        where: { role: "SALES_REP", status: "ACTIVE" },
        take: 3,
        orderBy: { createdAt: "desc" },
        select: { firstName: true, lastName: true, tier: true, experience: true },
      }),
      db.abandonedCheckout.count({
        where: { shop, status: "ABANDONED", claimedById: null },
      }),
    ]);

  const totalCommissionPaid = commissions.reduce(
    (sum, c) => sum + Number(c.commissionAmount),
    0,
  );

  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const recoveredThisMonthCheckouts = await db.abandonedCheckout.findMany({
    where: { shop, status: "RECOVERED", updatedAt: { gte: firstDayOfMonth } },
    select: { totalPrice: true },
  });
  const revenueRecoveredMonth = recoveredThisMonthCheckouts.reduce(
    (sum, c) => sum + Number(c.totalPrice),
    0,
  );

  const setupComplete =
    settings.commissionRate.toNumber() !== 10.0 || totalAbandoned > 0;

  return {
    settings,
    stats: {
      totalAbandoned,
      totalRecovered,
      recoveryRate: totalAbandoned > 0 ? (totalRecovered / totalAbandoned) * 100 : 0,
      totalCommissionPaid,
      revenueRecoveredMonth,
      pendingClaimsCount,
    },
    recentCheckouts,
    topReps,
    setupComplete,
  };
}

export async function getStoreCheckoutsWithStats(params: {
  shop: string;
  status?: string;
  claimed?: string;
}) {
  const where: any = { shop: params.shop };

  if (params.status) {
    where.status = params.status;
  }

  if (params.claimed === "true") {
    where.claimedById = { not: null };
  } else if (params.claimed === "false") {
    where.claimedById = null;
  }

  const [checkouts, stats] = await Promise.all([
    db.abandonedCheckout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { claimedBy: true },
      take: 100,
    }),
    Promise.all([
      db.abandonedCheckout.count({ where: { shop: params.shop } }),
      db.abandonedCheckout.count({
        where: { shop: params.shop, status: "ABANDONED" },
      }),
      db.abandonedCheckout.count({
        where: { shop: params.shop, status: "RECOVERED" },
      }),
      db.abandonedCheckout.count({
        where: { shop: params.shop, claimedById: null },
      }),
    ]).then(([total, abandoned, recovered, unclaimed]) => ({
      total,
      abandoned,
      recovered,
      unclaimed,
    })),
  ]);

  return { checkouts, stats };
}

export async function getPlatformCheckoutsWithStats(params: {
  status?: string;
  claimed?: string;
}) {
  const where: any = {};

  if (params.status) {
    where.status = params.status;
  }

  if (params.claimed === "true") {
    where.claimedById = { not: null };
  } else if (params.claimed === "false") {
    where.claimedById = null;
  }

  const [checkouts, stats] = await Promise.all([
    db.abandonedCheckout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        claimedBy: true,
        communications: { orderBy: { createdAt: "desc" } },
      },
      take: 100,
    }),
    Promise.all([
      db.abandonedCheckout.count(),
      db.abandonedCheckout.count({ where: { status: "ABANDONED" } }),
      db.abandonedCheckout.count({ where: { status: "RECOVERED" } }),
      db.abandonedCheckout.count({ where: { claimedById: null } }),
    ]).then(([total, abandoned, recovered, unclaimed]) => ({
      total,
      abandoned,
      recovered,
      unclaimed,
    })),
  ]);

  const platformUsers = await db.platformUser.findMany({
    where: { status: "ACTIVE", role: "SALES_REP" },
  });

  return { checkouts, stats, platformUsers };
}

