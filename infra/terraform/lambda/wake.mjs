// GET /wake — start the server if it is stopped, and report its state.
//
// The client calls this (through CloudFront) before probing the API:
//   stopped  → desiredCount is set to 1, returns "starting"
//   starting → a task is pending
//   running  → at least one task is running (the DNS record may lag a few
//              seconds, so the client should still probe /race-tracks)
import { ECSClient, DescribeServicesCommand, UpdateServiceCommand } from "@aws-sdk/client-ecs";

const ecs = new ECSClient({});
const { CLUSTER: cluster, SERVICE: service } = process.env;

export async function handler() {
  const { services } = await ecs.send(new DescribeServicesCommand({ cluster, services: [service] }));
  const svc = services[0];
  let state = "running";
  if (svc.runningCount === 0) {
    state = "starting";
    if (svc.desiredCount === 0) {
      await ecs.send(new UpdateServiceCommand({ cluster, service, desiredCount: 1 }));
    }
  }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ state }),
  };
}
