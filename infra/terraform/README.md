# Fargate deployment (scale-to-zero)

```
browser ──https/wss──▶ CloudFront ─┬─ /                 → S3 (client)
                                   ├─ /race-*, /races*  → Fargate task :2567
                                   └─ /wake             → Lambda (starts the task)
```

One hostname serves the client, the lobby API and the race websockets, so
there's no CORS and no mixed content, and CloudFront adds the COOP/COEP headers
Havok's WASM needs.

**Scale to zero.** The ECS service sits at `desiredCount = 0`.
- `GET /wake` (Lambda) sets it to 1 and reports `stopped | starting | running`.
- When the task reaches RUNNING, an EventBridge rule runs the DNS Lambda, which
  points `origin.<domain>` at the task's public IP (the CloudFront origin).
- With no lobby or race for `idle_shutdown_minutes`, the server sets its own
  service back to 0 (`server/idleShutdown.js`; the task role may only do that).

The security group admits only CloudFront's origin-facing addresses on 2567.
CloudFront → task is plain HTTP over the public internet.

## Setup

Needs Terraform ≥ 1.6, the AWS CLI with credentials, Docker, and a Route 53
hosted zone for your domain.

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # domain_name, hosted_zone_id
terraform init && terraform apply              # CloudFront takes ~10 min
cd ../..

npm run deploy:server                          # image → ECR (the service starts at 0 tasks, so no rush)

cd infra/terraform
export WEB_BUCKET=$(terraform output -raw web_bucket) \
       DISTRIBUTION_ID=$(terraform output -raw cloudfront_distribution_id) \
       SITE_URL=$(terraform output -raw site_url)
cd ../.. && npm run deploy:web
```

Redeploying the server is just `npm run deploy:server`: every cold start pulls
`:latest` (an already-running task keeps its old image until it scales down).

## Not done yet

- **Client wake-up.** The client doesn't call `/wake` yet, so while the server
  is stopped `probeServer()` fails and the Online button stays hidden. It needs
  to call `/wake`, show "starting server…", and poll until the probe succeeds.
- **Race results** are written to the task's ephemeral disk and vanish on
  scale-down (EFS or S3 if they matter).
- Default VPC, public subnets, no NAT/ALB: cheapest, not hardened.
