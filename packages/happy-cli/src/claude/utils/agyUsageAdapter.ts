import { z } from 'zod';

export const UsageWindowSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  status: z.enum(['ok', 'warning', 'rejected']).optional(),
  utilization: z.number().min(0).max(100).optional(),
  resetsAt: z.number().optional(),
});

export const UsageLimitsSchema = z.object({
  capturedAt: z.number(),
  windows: z.array(UsageWindowSchema),
});

export type UsageWindow = z.infer<typeof UsageWindowSchema>;
export type UsageLimits = z.infer<typeof UsageLimitsSchema>;

export function adaptAgyUsageLimits(
  rawEventOrResponse: any, 
  currentWindows: UsageWindow[] = []
): UsageLimits {
  const capturedAt = Date.now();
  const newWindows: UsageWindow[] = [];

  if (rawEventOrResponse?.agy_limits) {
    for (const limit of rawEventOrResponse.agy_limits) {
      const id = limit.type === 'weekly' ? 'agy_weekly' : 'agy_daily';
      const label = limit.type === 'weekly' ? 'agy 7d' : 'agy 24h';
      
      let utilization = limit.utilization;
      if (utilization !== undefined && utilization <= 1.0) {
        utilization = Math.round(utilization * 100);
      }

      let resetsAt = limit.reset_at_seconds;
      if (resetsAt) {
        resetsAt = resetsAt * 1000;
      }

      let status = limit.status;
      if (!status && utilization !== undefined) {
        if (utilization >= 100) status = 'rejected';
        else if (utilization >= 90) status = 'warning';
        else status = 'ok';
      }

      newWindows.push({ id, label, utilization, status, resetsAt });
    }
  }

  const mergedWindows = [...currentWindows];
  for (const win of newWindows) {
    const existingIdx = mergedWindows.findIndex(w => w.id === win.id);
    if (existingIdx >= 0) {
      mergedWindows[existingIdx] = { ...mergedWindows[existingIdx], ...win };
    } else {
      mergedWindows.push(win);
    }
  }

  return { capturedAt, windows: mergedWindows };
}
