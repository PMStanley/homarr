import { z } from "zod/v4";

import { integrationKinds, integrationDefs } from "@homarr/definitions";
import { getStatsMetrics } from "@homarr/integrations/stats";
import { getStatsSnapshotAsync, refreshStatsAsync } from "@homarr/request-handler/stats";
import { statsCacheDurationSecondsSchema } from "@homarr/validation/stats";

import { createOneIntegrationMiddleware } from "../../middlewares/integration";
import { createTRPCRouter, publicProcedure } from "../../trpc";

const access = createOneIntegrationMiddleware("query", ...integrationKinds);

export const statsRouter = createTRPCRouter({
  catalog: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        description:
          "List available statistics fields for an integration. Obtain integrationId from integration_all. Requires query access to that integration.",
      },
    })
    .concat(access)
    .query(({ ctx: context }) => ({
      name: context.integration.name,
      iconUrl: integrationDefs[context.integration.kind].iconUrl,
      metrics: getStatsMetrics(context.integration.kind),
    })),
  snapshot: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        description:
          "Read cached integration statistics and their age without contacting the service. Requires integrationId from integration_all and query access. cacheTtlSeconds sets the freshness window (5–86400 seconds); 0 uses the integration default.",
      },
    })
    .concat(access)
    .input(z.object({ cacheTtlSeconds: statsCacheDurationSecondsSchema.default(0) }))
    .query(async ({ ctx: context, input }) => await getStatsSnapshotAsync(context.integration, input.cacheTtlSeconds)),
  refresh: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        effect: "additive",
        description:
          "Refresh read-only integration statistics through a bounded queue. Requires integrationId from integration_all and query access. cacheTtlSeconds sets the freshness window (5–86400 seconds); 0 uses one minute for Jellyfin and one hour otherwise. force bypasses freshness and retry backoff.",
      },
    })
    .concat(access)
    .input(z.object({ force: z.boolean().default(false), cacheTtlSeconds: statsCacheDurationSecondsSchema.default(0) }))
    .mutation(async ({ ctx: context, input }) => {
      await refreshStatsAsync(context.integration, input.force, input.cacheTtlSeconds);
      return await getStatsSnapshotAsync(context.integration, input.cacheTtlSeconds);
    }),
});
