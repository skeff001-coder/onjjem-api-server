import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const RC_BASE = "https://api.revenuecat.com/v2";
const RC_PROJECT_ID = process.env.REVENUECAT_PROJECT_ID;
const RC_SECRET_KEY = process.env.REVENUECAT_SECRET_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_ANALYTICS_TOKEN;

router.get("/analytics", async (req: Request, res: Response) => {
  if (ADMIN_TOKEN) {
    const provided = req.headers["x-admin-token"];
    if (!provided || provided !== ADMIN_TOKEN) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  if (!RC_SECRET_KEY || !RC_PROJECT_ID) {
    res.status(503).json({ error: "Analytics not configured" });
    return;
  }

  try {
    const headers = { Authorization: `Bearer ${RC_SECRET_KEY}` };
    const base = `${RC_BASE}/projects/${RC_PROJECT_ID}`;

    const [overviewResp, customersResp] = await Promise.all([
      fetch(`${base}/metrics/overview`, { headers }),
      fetch(`${base}/customers?limit=200`, { headers }),
    ]);

    const overview = await overviewResp.json() as {
      metrics?: Array<{ id: string; value: number }>;
    };
    const customers = await customersResp.json() as {
      items?: Array<{
        last_seen_country?: string;
        last_seen_app_version?: string;
        last_seen_platform?: string;
        active_entitlements?: Record<string, unknown>;
      }>;
    };

    const allCustomers = customers.items ?? [];

    const activeSubscribers = allCustomers.filter(
      (c) => c.active_entitlements && Object.keys(c.active_entitlements).length > 0,
    );

    const countryMap: Record<string, number> = {};
    const platformMap: Record<string, number> = {};

    for (const c of activeSubscribers) {
      const country = c.last_seen_country || "Unknown";
      countryMap[country] = (countryMap[country] ?? 0) + 1;

      const platform = c.last_seen_platform
        ? c.last_seen_platform.charAt(0).toUpperCase() + c.last_seen_platform.slice(1)
        : "Unknown";
      platformMap[platform] = (platformMap[platform] ?? 0) + 1;
    }

    const toSorted = (m: Record<string, number>) =>
      Object.entries(m)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    const metricMap: Record<string, number> = {};
    for (const m of overview.metrics ?? []) {
      metricMap[m.id] = m.value;
    }

    res.json({
      metrics: {
        active_subscriptions: metricMap["active_subscriptions"] ?? 0,
        mrr: metricMap["mrr"] ?? 0,
        revenue: metricMap["revenue"] ?? 0,
        new_customers: metricMap["new_customers"] ?? 0,
        active_users: metricMap["active_users"] ?? 0,
      },
      countries: toSorted(countryMap),
      platforms: toSorted(platformMap),
      totalSubscribers: activeSubscribers.length,
      totalCustomers: allCustomers.length,
    });
  } catch (err) {
    req.log.error({ err }, "analytics fetch failed");
    res.status(502).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
