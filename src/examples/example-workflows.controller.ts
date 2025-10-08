import { Controller, Post, Get, Logger, HttpCode } from '@nestjs/common';
import { ExampleWorkflowsService } from './example-workflows.service';

/**
 * Controller providing HTTP endpoints to demonstrate workflow engine capabilities
 */
@Controller('examples')
export class ExampleWorkflowsController {
  private readonly logger = new Logger(ExampleWorkflowsController.name);

  constructor(private readonly exampleService: ExampleWorkflowsService) {}

  @Get()
  getAvailableExamples() {
    return {
      message: 'NestJS Workflow Engine Examples',
      availableEndpoints: [
        {
          method: 'POST',
          path: '/examples/data-processing',
          description: 'Run a simple linear workflow: fetchData -> processData -> saveResult'
        },
        {
          method: 'POST',
          path: '/examples/parallel-processing',
          description: 'Run a workflow with parallel task execution'
        },
        {
          method: 'POST',
          path: '/examples/error-handling',
          description: 'Demonstrate error handling, retries, and timeouts'
        }
      ],
      documentation: 'Check the console logs to see detailed workflow execution progress'
    };
  }

  @Post('data-processing')
  @HttpCode(200)
  async runDataProcessingExample() {
    this.logger.log('Starting data processing workflow via HTTP endpoint');
    
    try {
      await this.exampleService.runDataProcessingWorkflow();
      return {
        success: true,
        message: 'Data processing workflow completed successfully',
        note: 'Check console logs for detailed execution information'
      };
    } catch (error) {
      this.logger.error('Data processing workflow failed:', error);
      return {
        success: false,
        message: 'Data processing workflow failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  @Post('parallel-processing')
  @HttpCode(200)
  async runParallelProcessingExample() {
    this.logger.log('Starting parallel processing workflow via HTTP endpoint');
    
    try {
      await this.exampleService.runParallelProcessingWorkflow();
      return {
        success: true,
        message: 'Parallel processing workflow completed successfully',
        note: 'Check console logs for detailed execution information'
      };
    } catch (error) {
      this.logger.error('Parallel processing workflow failed:', error);
      return {
        success: false,
        message: 'Parallel processing workflow failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  @Post('error-handling')
  @HttpCode(200)
  async runErrorHandlingExample() {
    this.logger.log('Starting error handling workflow via HTTP endpoint');
    
    try {
      await this.exampleService.runErrorHandlingWorkflow();
      return {
        success: true,
        message: 'Error handling workflow completed (some tasks may have failed intentionally)',
        note: 'Check console logs for detailed execution information including errors and retries'
      };
    } catch (error) {
      this.logger.error('Error handling workflow failed:', error);
      return {
        success: false,
        message: 'Error handling workflow failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}