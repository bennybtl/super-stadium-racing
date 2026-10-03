#!/usr/bin/env bash
# Build the client and publish it to the S3 bucket behind CloudFront.
#
#   WEB_BUCKET=... DISTRIBUTION_ID=... SITE_URL=https://race.example.com npm run deploy:web
#
# Values come from `terraform output` (infra/terraform). The client is built
# with VITE_SERVER_URL=SITE_URL: the API and race websockets share the site's
# origin through CloudFront.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${WEB_BUCKET:?set WEB_BUCKET (terraform output web_bucket)}"
: "${DISTRIBUTION_ID:?set DISTRIBUTION_ID (terraform output cloudfront_distribution_id)}"
: "${SITE_URL:?set SITE_URL (terraform output site_url)}"

VITE_SERVER_URL="$SITE_URL" npm run build

# assets/ is content-hashed, so it caches for a year; everything else (index.html,
# favicons) revalidates.
aws s3 sync dist/assets "s3://$WEB_BUCKET/assets" --delete \
  --cache-control "public,max-age=31536000,immutable"
aws s3 sync dist "s3://$WEB_BUCKET" --delete --exclude "assets/*" \
  --cache-control "no-cache"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null
echo "published to $SITE_URL"
