variable "region" {
  description = "Region for ECS, ECR, S3 and the Lambdas."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Prefix for resource names."
  type        = string
  default     = "offroad"
}

variable "domain_name" {
  description = "Public hostname of the game (e.g. race.example.com). Serves the client and the multiplayer API/websockets."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone that contains domain_name."
  type        = string
}

variable "image_tag" {
  description = "ECR image tag the task runs. Every cold start pulls it fresh."
  type        = string
  default     = "latest"
}

variable "cpu_architecture" {
  description = "ARM64 (cheaper) or X86_64. Must match PLATFORM in scripts/deploy-server.sh."
  type        = string
  default     = "ARM64"
}

variable "cpu" {
  description = "Fargate task CPU units. Each race is its own 60 Hz process, so leave headroom."
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 2048
}

variable "idle_shutdown_minutes" {
  description = "Minutes with no lobby or race before the server scales itself to zero."
  type        = number
  default     = 10
}
