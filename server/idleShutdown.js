/**
 * Scale-to-zero: when no lobby or race has existed for `minutes`, set this ECS
 * service's desiredCount to 0 (the task role allows exactly that). The wake
 * Lambda (infra/terraform) sets it back to 1 when someone wants to play.
 *
 * Off unless IDLE_SHUTDOWN_MINUTES, ECS_CLUSTER and ECS_SERVICE are set, so
 * local runs and docker-compose never touch AWS.
 */

const CHECK_MS = 30_000;

export function startIdleShutdown({ isIdle, minutes, cluster, service }) {
  if (!(minutes > 0) || !cluster || !service) return null;
  let idleSince = Date.now();
  let stopping = false;
  console.log(`[idle-shutdown] scaling ${cluster}/${service} to 0 after ${minutes} idle min`);

  const timer = setInterval(async () => {
    if (!isIdle()) {
      idleSince = Date.now();
      return;
    }
    if (stopping || Date.now() - idleSince < minutes * 60_000) return;
    stopping = true;
    try {
      const { ECSClient, UpdateServiceCommand } = await import("@aws-sdk/client-ecs");
      await new ECSClient({}).send(new UpdateServiceCommand({ cluster, service, desiredCount: 0 }));
      console.log("[idle-shutdown] desiredCount → 0");
    } catch (err) {
      console.error("[idle-shutdown] could not scale down:", err);
      stopping = false;
      idleSince = Date.now(); // retry after another full idle period
    }
  }, CHECK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
