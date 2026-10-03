// Point origin.<domain> at the task's public IP when it reaches RUNNING.
//
// Triggered by the EventBridge "ECS Task State Change" rule. CloudFront's
// origin is that hostname, so the IP can change on every cold start.
import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { EC2Client, DescribeNetworkInterfacesCommand } from "@aws-sdk/client-ec2";
import { Route53Client, ChangeResourceRecordSetsCommand } from "@aws-sdk/client-route-53";

const ecs = new ECSClient({});
const ec2 = new EC2Client({});
const r53 = new Route53Client({});

export async function handler(event) {
  const { clusterArn, taskArn } = event.detail;
  const { tasks } = await ecs.send(new DescribeTasksCommand({ cluster: clusterArn, tasks: [taskArn] }));
  const eniId = tasks[0].attachments
    .find((a) => a.type === "ElasticNetworkInterface")
    .details.find((d) => d.name === "networkInterfaceId").value;
  const { NetworkInterfaces } = await ec2.send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }));
  const ip = NetworkInterfaces[0].Association.PublicIp;

  await r53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: process.env.ZONE_ID,
    ChangeBatch: {
      Changes: [{
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: process.env.ORIGIN_HOST,
          Type: "A",
          TTL: 5,
          ResourceRecords: [{ Value: ip }],
        },
      }],
    },
  }));
  return { ip };
}
