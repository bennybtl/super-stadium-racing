#!/usr/bin/env bash
# Build the multiplayer server image and push it to AWS ECR.
#
#   npm run deploy:server            # tags: git short sha + latest
#   TAG=v1 npm run deploy:server
#
# Env (all optional):
#   AWS_REGION / AWS_DEFAULT_REGION   default us-east-1
#   ECR_REPO                          default offroad-server (created if missing)
#   PLATFORM                          default linux/arm64 (Fargate ARM is cheaper;
#                                     use linux/amd64 if the task def is X86_64)
#   AWS_PROFILE                       standard AWS CLI profile selection
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
REPO="${ECR_REPO:-offroad-server}"
PLATFORM="${PLATFORM:-linux/arm64}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"

command -v aws >/dev/null || { echo "aws CLI not found (brew install awscli)"; exit 1; }
command -v docker >/dev/null || { echo "docker not found"; exit 1; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
IMAGE="$REGISTRY/$REPO"

aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 ||
  aws ecr create-repository --repository-name "$REPO" --region "$REGION" \
    --image-scanning-configuration scanOnPush=true >/dev/null

aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "$REGISTRY"

docker buildx build --platform "$PLATFORM" -f server/Dockerfile \
  -t "$IMAGE:$TAG" -t "$IMAGE:latest" --push .

echo "pushed $IMAGE:$TAG (and :latest)"
