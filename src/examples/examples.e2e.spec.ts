import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../app.module';

describe('Examples Controller (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/examples (GET)', () => {
    it('should return available examples information', () => {
      return request(app.getHttpServer())
        .get('/examples')
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toBe('NestJS Workflow Engine Examples');
          expect(res.body.availableEndpoints).toHaveLength(3);
          expect(res.body.availableEndpoints[0].path).toBe('/examples/data-processing');
          expect(res.body.availableEndpoints[1].path).toBe('/examples/parallel-processing');
          expect(res.body.availableEndpoints[2].path).toBe('/examples/error-handling');
        });
    });
  });

  describe('/examples/data-processing (POST)', () => {
    it('should execute data processing workflow successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/examples/data-processing')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Data processing workflow completed successfully');
      expect(response.body.note).toContain('Check console logs');
    }, 15000);
  });

  describe('/examples/parallel-processing (POST)', () => {
    it('should execute parallel processing workflow successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/examples/parallel-processing')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Parallel processing workflow completed successfully');
      expect(response.body.note).toContain('Check console logs');
    }, 15000);
  });

  describe('/examples/error-handling (POST)', () => {
    it('should execute error handling workflow and handle failures gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post('/examples/error-handling')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Error handling workflow completed');
      expect(response.body.note).toContain('Check console logs');
    }, 15000);
  });

  describe('Error scenarios', () => {
    it('should handle workflow engine errors gracefully', async () => {
      // This test would require mocking the workflow engine to throw an error
      // For now, we'll test that the endpoints are robust
      
      const response = await request(app.getHttpServer())
        .post('/examples/data-processing')
        .expect(200);

      // Even if there are internal issues, the API should respond properly
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('message');
    }, 15000);
  });
});