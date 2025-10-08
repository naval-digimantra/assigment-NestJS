import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowModule } from './workflow.module';
import { WorkflowEngineService } from './services/workflow-engine.service';
import { TaskExecutorService } from './services/task-executor.service';
import { DependencyResolverService } from './services/dependency-resolver.service';
import { WorkflowEventLoggerService } from './services/workflow-event-logger.service';

describe('WorkflowModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [WorkflowModule],
    }).compile();

    await module.init();
  });

  afterEach(async () => {
    await module.close();
  });

  describe('Module Configuration', () => {
    it('should be defined', () => {
      expect(module).toBeDefined();
    });

    it('should provide WorkflowEngineService', () => {
      const workflowEngineService = module.get<WorkflowEngineService>(WorkflowEngineService);
      expect(workflowEngineService).toBeDefined();
      expect(workflowEngineService).toBeInstanceOf(WorkflowEngineService);
    });

    it('should provide TaskExecutorService', () => {
      const taskExecutorService = module.get<TaskExecutorService>(TaskExecutorService);
      expect(taskExecutorService).toBeDefined();
      expect(taskExecutorService).toBeInstanceOf(TaskExecutorService);
    });

    it('should provide DependencyResolverService', () => {
      const dependencyResolverService = module.get<DependencyResolverService>(DependencyResolverService);
      expect(dependencyResolverService).toBeDefined();
      expect(dependencyResolverService).toBeInstanceOf(DependencyResolverService);
    });

    it('should provide WorkflowEventLoggerService', () => {
      const workflowEventLoggerService = module.get<WorkflowEventLoggerService>(WorkflowEventLoggerService);
      expect(workflowEventLoggerService).toBeDefined();
      expect(workflowEventLoggerService).toBeInstanceOf(WorkflowEventLoggerService);
    });

    it('should provide EventEmitter2 from EventEmitterModule', () => {
      const eventEmitter = module.get<EventEmitter2>(EventEmitter2);
      expect(eventEmitter).toBeDefined();
      expect(eventEmitter).toBeInstanceOf(EventEmitter2);
    });
  });

  describe('Service Dependencies', () => {
    it('should inject dependencies correctly into WorkflowEngineService', () => {
      const workflowEngineService = module.get<WorkflowEngineService>(WorkflowEngineService);
      
      // Verify that the service has access to its dependencies
      // We can test this by checking if the service can execute basic operations
      expect(workflowEngineService).toBeDefined();
      expect(typeof workflowEngineService.run).toBe('function');
    });

    it('should inject dependencies correctly into TaskExecutorService', () => {
      const taskExecutorService = module.get<TaskExecutorService>(TaskExecutorService);
      
      // Verify that the service has access to its dependencies
      expect(taskExecutorService).toBeDefined();
      expect(typeof taskExecutorService.executeTask).toBe('function');
    });

    it('should inject dependencies correctly into DependencyResolverService', () => {
      const dependencyResolverService = module.get<DependencyResolverService>(DependencyResolverService);
      
      // Verify that the service has access to its dependencies
      expect(dependencyResolverService).toBeDefined();
      expect(typeof dependencyResolverService.buildExecutionPlan).toBe('function');
    });

    it('should ensure WorkflowEventLoggerService is properly initialized', () => {
      const workflowEventLoggerService = module.get<WorkflowEventLoggerService>(WorkflowEventLoggerService);
      const eventEmitter = module.get<EventEmitter2>(EventEmitter2);
      
      // Verify that the event logger service is properly initialized
      expect(workflowEventLoggerService).toBeDefined();
      expect(eventEmitter).toBeDefined();
      
      // Verify that event listeners are registered by checking listener count
      const listenerCount = eventEmitter.listenerCount('task.started');
      expect(listenerCount).toBeGreaterThan(0);
    });
  });

  describe('Module Exports', () => {
    it('should export WorkflowEngineService for external use', () => {
      // Test that the service can be retrieved from the module
      const workflowEngineService = module.get<WorkflowEngineService>(WorkflowEngineService);
      expect(workflowEngineService).toBeDefined();
    });

    it('should export TaskExecutorService for external use', () => {
      // Test that the service can be retrieved from the module
      const taskExecutorService = module.get<TaskExecutorService>(TaskExecutorService);
      expect(taskExecutorService).toBeDefined();
    });

    it('should export DependencyResolverService for external use', () => {
      // Test that the service can be retrieved from the module
      const dependencyResolverService = module.get<DependencyResolverService>(DependencyResolverService);
      expect(dependencyResolverService).toBeDefined();
    });
  });

  describe('EventEmitterModule Configuration', () => {
    it('should configure EventEmitterModule with correct settings', () => {
      const eventEmitter = module.get<EventEmitter2>(EventEmitter2);
      
      // Test basic event emitter functionality
      expect(eventEmitter).toBeDefined();
      expect(typeof eventEmitter.emit).toBe('function');
      expect(typeof eventEmitter.on).toBe('function');
      expect(typeof eventEmitter.off).toBe('function');
    });

    it('should support event emission and listening', () => {
      const eventEmitter = module.get<EventEmitter2>(EventEmitter2);
      
      let eventReceived = false;
      const testPayload = { test: 'data' };
      
      // Register a test listener
      eventEmitter.on('test.event', (payload) => {
        eventReceived = true;
        expect(payload).toEqual(testPayload);
      });
      
      // Emit a test event
      eventEmitter.emit('test.event', testPayload);
      
      // Verify the event was received
      expect(eventReceived).toBe(true);
    });

    it('should handle multiple listeners for the same event', () => {
      const eventEmitter = module.get<EventEmitter2>(EventEmitter2);
      
      let listener1Called = false;
      let listener2Called = false;
      
      // Register multiple listeners
      eventEmitter.on('multi.test', () => { listener1Called = true; });
      eventEmitter.on('multi.test', () => { listener2Called = true; });
      
      // Emit the event
      eventEmitter.emit('multi.test');
      
      // Verify both listeners were called
      expect(listener1Called).toBe(true);
      expect(listener2Called).toBe(true);
    });
  });

  describe('Module Lifecycle', () => {
    it('should initialize WorkflowEventLoggerService on module init', async () => {
      // Create a fresh module to test initialization
      const testModule = await Test.createTestingModule({
        imports: [WorkflowModule],
      }).compile();

      // Before init, the service should exist but listeners might not be registered
      const workflowEventLoggerService = testModule.get<WorkflowEventLoggerService>(WorkflowEventLoggerService);
      expect(workflowEventLoggerService).toBeDefined();

      // Initialize the module
      await testModule.init();

      // After init, event listeners should be registered
      const eventEmitter = testModule.get<EventEmitter2>(EventEmitter2);
      const listenerCount = eventEmitter.listenerCount('task.started');
      expect(listenerCount).toBeGreaterThan(0);

      await testModule.close();
    });

    it('should handle module shutdown gracefully', async () => {
      const testModule = await Test.createTestingModule({
        imports: [WorkflowModule],
      }).compile();

      await testModule.init();
      
      // Verify services are available
      const workflowEngineService = testModule.get<WorkflowEngineService>(WorkflowEngineService);
      expect(workflowEngineService).toBeDefined();

      // Close the module - should not throw errors
      await expect(testModule.close()).resolves.not.toThrow();
    });
  });

  describe('Integration with External Modules', () => {
    it('should work when imported into another module', async () => {
      // Create a test module that imports WorkflowModule
      const testModule = await Test.createTestingModule({
        imports: [WorkflowModule],
        providers: [
          // Add a test service that depends on WorkflowEngineService
          {
            provide: 'TestService',
            useFactory: (workflowEngine: WorkflowEngineService) => {
              return {
                getWorkflowEngine: () => workflowEngine,
              };
            },
            inject: [WorkflowEngineService],
          },
        ],
      }).compile();

      await testModule.init();

      // Verify that the test service can access WorkflowEngineService
      const testService = testModule.get('TestService');
      const workflowEngine = testService.getWorkflowEngine();
      
      expect(workflowEngine).toBeDefined();
      expect(workflowEngine).toBeInstanceOf(WorkflowEngineService);

      await testModule.close();
    });

    it('should maintain singleton instances across the module', () => {
      // Get the same service multiple times
      const workflowEngine1 = module.get<WorkflowEngineService>(WorkflowEngineService);
      const workflowEngine2 = module.get<WorkflowEngineService>(WorkflowEngineService);
      
      // Should be the same instance (singleton)
      expect(workflowEngine1).toBe(workflowEngine2);
      
      const taskExecutor1 = module.get<TaskExecutorService>(TaskExecutorService);
      const taskExecutor2 = module.get<TaskExecutorService>(TaskExecutorService);
      
      // Should be the same instance (singleton)
      expect(taskExecutor1).toBe(taskExecutor2);
    });
  });
});