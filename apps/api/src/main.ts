import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadRuntimeConfig } from '@constack/config';
import { AppModule } from './app.module.js';

const config = loadRuntimeConfig();
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.getHttpAdapter().getInstance().set('trust proxy', 1);
app.use(cookieParser());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", 'blob:'],
      },
    },
  }),
);
app.useGlobalPipes(
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
);
app.setGlobalPrefix('api/v1');
app.enableShutdownHooks();

const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle('ConStack API')
    .setDescription('Versioned API for the ConStack Kubernetes digital twin')
    .setVersion('1.0')
    .addCookieAuth('constack_session')
    .build(),
);
SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });

await app.listen(config.PORT, '0.0.0.0');
