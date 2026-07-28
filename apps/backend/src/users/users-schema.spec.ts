import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';
import { UsersService } from './users.service';

describe('Users API Schema Snapshot', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {}, // Mock service, not used for schema generation
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // We don't need to call app.init() to generate Swagger schemas
  });

  it('should match the OpenAPI snapshot for Users API', () => {
    const config = new DocumentBuilder()
      .setTitle('Users API')
      .setVersion('1.0')
      .build();

    // Create the document using the isolated app instance
    const document = SwaggerModule.createDocument(app, config);

    // Snapshot the paths and schemas generated to catch unexpected breaking changes
    expect(document.paths).toMatchSnapshot('Users API Paths');
    expect(document.components?.schemas).toMatchSnapshot('Users API Schemas');
  });
});
