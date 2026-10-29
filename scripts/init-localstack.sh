#!/usr/bin/env bash
set -eo pipefail

echo "Initializing LocalStack SQS FIFO queues..."

# Create DLQ FIFO Queue
awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

echo "DLQ created with ARN: ${DLQ_ARN}"

# Create Main FIFO Queue with RedrivePolicy pointing to DLQ (maxReceiveCount: 3)
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"3\"}"

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false,RedrivePolicy="${REDRIVE_POLICY}"

echo "Main FIFO queue wager-transactions.fifo created successfully!"

