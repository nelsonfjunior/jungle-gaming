import { SQSClient } from "@aws-sdk/client-sqs";
import * as dotenv from "dotenv";

dotenv.config();

export function createSqsClient(): SQSClient {
  const isLocal = process.env.NODE_ENV !== "production" || process.env.AWS_ENDPOINT;

  return new SQSClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.AWS_ENDPOINT || undefined,
    credentials: isLocal
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
        }
      : undefined,
  });
}

