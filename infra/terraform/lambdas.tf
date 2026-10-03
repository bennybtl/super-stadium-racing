locals {
  origin_host = "origin.${var.domain_name}"
}

data "archive_file" "wake" {
  type        = "zip"
  source_file = "${path.module}/lambda/wake.mjs"
  output_path = "${path.module}/.build/wake.zip"
}

data "archive_file" "dns" {
  type        = "zip"
  source_file = "${path.module}/lambda/dns.mjs"
  output_path = "${path.module}/.build/dns.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ── wake ─────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "wake" {
  name               = "${var.name}-wake"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "wake_logs" {
  role       = aws_iam_role.wake.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "wake" {
  role = aws_iam_role.wake.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecs:UpdateService", Resource = aws_ecs_service.server.id },
      { Effect = "Allow", Action = "ecs:DescribeServices", Resource = "*" },
    ]
  })
}

resource "aws_lambda_function" "wake" {
  function_name    = "${var.name}-wake"
  role             = aws_iam_role.wake.arn
  runtime          = "nodejs22.x"
  handler          = "wake.handler"
  filename         = data.archive_file.wake.output_path
  source_code_hash = data.archive_file.wake.output_base64sha256
  timeout          = 10

  environment {
    variables = {
      CLUSTER = aws_ecs_cluster.main.name
      SERVICE = aws_ecs_service.server.name
    }
  }
}

# Public function URL, fronted by CloudFront at /wake. Worst case a stranger
# starts the (single-task) service, which scales itself back down when idle.
resource "aws_lambda_function_url" "wake" {
  function_name      = aws_lambda_function.wake.function_name
  authorization_type = "NONE"
}

# ── DNS updater ──────────────────────────────────────────────────────────────
resource "aws_iam_role" "dns" {
  name               = "${var.name}-dns-update"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "dns_logs" {
  role       = aws_iam_role.dns.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dns" {
  role = aws_iam_role.dns.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecs:DescribeTasks", "ec2:DescribeNetworkInterfaces"], Resource = "*" },
      { Effect = "Allow", Action = "route53:ChangeResourceRecordSets", Resource = "arn:aws:route53:::hostedzone/${var.hosted_zone_id}" },
    ]
  })
}

resource "aws_lambda_function" "dns" {
  function_name    = "${var.name}-dns-update"
  role             = aws_iam_role.dns.arn
  runtime          = "nodejs22.x"
  handler          = "dns.handler"
  filename         = data.archive_file.dns.output_path
  source_code_hash = data.archive_file.dns.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      ZONE_ID     = var.hosted_zone_id
      ORIGIN_HOST = local.origin_host
    }
  }
}

resource "aws_cloudwatch_event_rule" "task_running" {
  name = "${var.name}-task-running"
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["RUNNING"]
    }
  })
}

resource "aws_cloudwatch_event_target" "dns" {
  rule = aws_cloudwatch_event_rule.task_running.name
  arn  = aws_lambda_function.dns.arn
}

resource "aws_lambda_permission" "dns" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dns.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.task_running.arn
}
