import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { GlobalHttpExceptionFilter } from "./interfaces/http/filters/http-exception.filter";
import { StructuredLoggerInterceptor } from "./interfaces/http/interceptors/structured-logger.interceptor";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalInterceptors(new StructuredLoggerInterceptor());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`[DistributedWageringProcessor] Server running on port ${port}`);
}

bootstrap();

