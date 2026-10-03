output "ecr_repository" {
  description = "Set ECR_REPO to this name (scripts/deploy-server.sh)."
  value       = aws_ecr_repository.server.name
}

output "site_url" {
  value = "https://${var.domain_name}"
}

output "web_bucket" {
  description = "Set WEB_BUCKET to this (scripts/deploy-web.sh)."
  value       = aws_s3_bucket.web.bucket
}

output "cloudfront_distribution_id" {
  description = "Set DISTRIBUTION_ID to this (scripts/deploy-web.sh)."
  value       = aws_cloudfront_distribution.main.id
}
