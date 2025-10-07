import { Module } from '@nestjs/common';
import { WorkflowModule } from './workflow/workflow.module';
import { ExamplesModule } from './examples/examples.module';

@Module({
  imports: [WorkflowModule, ExamplesModule],
})
export class AppModule {}