# The default VPC is enough: one task with a public IP, reachable only from
# CloudFront (security group below).
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "server" {
  name_prefix = "${var.name}-server-"
  description = "Multiplayer server: 2567 from CloudFront only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "CloudFront origin-facing"
    from_port       = 2567
    to_port         = 2567
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}
