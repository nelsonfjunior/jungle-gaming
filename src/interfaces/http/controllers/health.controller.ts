import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import { EntityManager } from "@mikro-orm/postgresql";
import { ListQueuesCommand, SQSClient } from "@aws-sdk/client-sqs";

@Controller("health")
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly sqsClient: SQSClient,
  ) {}

  @Get("live")
  public getLiveness(@Res() res: Response) {
    return res.status(HttpStatus.OK).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  @Get("ready")
  public async getReadiness(@Res() res: Response) {
    let dbOk = false;
    let sqsOk = false;

    // 1. Checa PostgreSQL
    try {
      await this.em.getConnection().execute("SELECT 1;");
      dbOk = true;
    } catch (dbErr) {
      dbOk = false;
    }

    // 2. Checa LocalStack / AWS SQS
    try {
      await this.sqsClient.send(new ListQueuesCommand({ MaxResults: 1 }));
      sqsOk = true;
    } catch (sqsErr) {
      sqsOk = false;
    }

    const isReady = dbOk && sqsOk;
    const statusCode = isReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    return res.status(statusCode).json({
      status: isReady ? "ready" : "unhealthy",
      services: {
        database: dbOk ? "connected" : "disconnected",
        sqs: sqsOk ? "connected" : "disconnected",
      },
      timestamp: new Date().toISOString(),
    });
  }
}
