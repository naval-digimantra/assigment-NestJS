import { Module, OnModuleInit } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { 
  DependencyResolverService, 
  TaskExecutorService, 
  WorkflowEngineService,
  WorkflowEventLoggerService
} from './services';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 50, // increased for tests with many listeners
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
  ],
  providers: [
    DependencyResolverService,
    TaskExecutorService,
    WorkflowEngineService,
    WorkflowEventLoggerService,
  ],
  exports: [
    DependencyResolverService,
    TaskExecutorService,
    WorkflowEngineService,
    WorkflowEventLoggerService,
  ],
})
export class WorkflowModule implements OnModuleInit {
  constructor(private readonly eventLogger: WorkflowEventLoggerService) {}

  onModuleInit() {
    // This ensures the WorkflowEventLoggerService is instantiated and event listeners are registered
    // The service is injected in the constructor, which triggers its instantiation
  }
}