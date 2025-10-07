import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { ExampleWorkflowsService } from './example-workflows.service';
import { ExampleWorkflowsController } from './example-workflows.controller';

/**
 * Module containing example implementations and demonstrations
 * of the workflow engine capabilities
 */
@Module({
  imports: [WorkflowModule],
  providers: [ExampleWorkflowsService],
  controllers: [ExampleWorkflowsController],
  exports: [ExampleWorkflowsService]
})
export class ExamplesModule {}