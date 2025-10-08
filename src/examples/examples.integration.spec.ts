import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExampleWorkflowsService } from './example-workflows.service';
import { WorkflowEngineService } from '../workflow/services/workflow-engine.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { 
  WorkflowEvents, 
  TaskEvent, 
  WorkflowEvent 
} from '../workflow/interfaces/events.interface';
import { 
  WorkflowDefinition, 
  TaskDefinition 
} from '../workflow/interfaces/task.interface';

describe('ExampleWorkflowsService Integration Tests', () => {
  let service: ExampleWorkflowsService;
  let workflowEngine: WorkflowEngineService;
  let eventEmitter: EventEmitter2;
  let module: TestingModule;

  // Event tracking for tests
  let emittedEvents: { event: string; payload: any }[] = [];

  beforeEach(async () => {
    emittedEvents = [];

    module = await Test.createTestingModule({
      imports: [WorkflowModule],
      providers: [ExampleWorkflowsService],
    }).compile();

    service = module.get<ExampleWorkflowsService>(ExampleWorkflowsService);
    workflowEngine = module.get<WorkflowEngineService>(WorkflowEngineService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Set up event listeners to track all events
    Object.values(WorkflowEvents).forEach(event => {
      eventEmitter.on(event, (payload) => {
        emittedEvents.push({ event, payload });
      });
    });
  });

  afterEach(async () => {
    await module.close();
  });

  describe('Data Processing Workflow', () => {
    it('should execute linear workflow successfully', async () => {
      // Act
      const result = await service.runDataProcessingWorkflow();

      // Assert - Check workflow result
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['fetchData', 'processData', 'saveResult']);
      expect(result.failedTasks).toEqual([]);
      expect(result.totalTasks).toBe(3);
      expect(result.executionTime).toBeGreaterThan(0);

      // Verify task results
      expect(result.results['fetchData']).toBeDefined();
      expect(result.results['processData']).toBeDefined();
      expect(result.results['saveResult']).toBeDefined();

      // Check that events were emitted
      const workflowStartedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.WORKFLOW_STARTED);
      const workflowCompletedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.WORKFLOW_COMPLETED);
      const taskCompletedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.TASK_COMPLETED);

      expect(workflowStartedEvents).toHaveLength(1);
      expect(workflowCompletedEvents).toHaveLength(1);
      expect(taskCompletedEvents).toHaveLength(3);

      // Verify task execution order
      const taskIds = taskCompletedEvents.map(e => e.payload.taskId);
      expect(taskIds).toEqual(['fetchData', 'processData', 'saveResult']);
    }, 15000);

    it('should handle task results correctly', async () => {
      // Create a simple workflow to test result handling
      const workflow: WorkflowDefinition = {
        tasks: [
          {
            id: 'task1',
            handler: async () => ({ value: 42, message: 'success' })
          },
          {
            id: 'task2',
            handler: async () => ({ processed: true, timestamp: new Date().toISOString() }),
            dependencies: ['task1']
          }
        ]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.results['task1']).toEqual({ value: 42, message: 'success' });
      expect(result.results['task2']).toMatchObject({ processed: true });
      expect(result.results['task2'].timestamp).toBeDefined();
    });
  });

  describe('Parallel Processing Workflow', () => {
    it('should execute independent tasks in parallel', async () => {
      const startTime = Date.now();

      // Act
      const result = await service.runParallelProcessingWorkflow();

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Assert - Check workflow result
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(6);
      expect(result.failedTasks).toHaveLength(0);
      
      // Verify all expected tasks completed
      expect(result.completedTasks).toContain('initializeSystem');
      expect(result.completedTasks).toContain('fetchUserData');
      expect(result.completedTasks).toContain('fetchProductData');
      expect(result.completedTasks).toContain('fetchOrderData');
      expect(result.completedTasks).toContain('generateReport');
      expect(result.completedTasks).toContain('sendNotification');

      // Parallel execution should be faster than sequential
      // The three fetch tasks (1.5s, 1.2s, 0.8s) should run in parallel
      // So total time should be closer to max(1.5s) + other tasks, not sum(3.5s)
      expect(totalTime).toBeLessThan(8000); // Should be much less than if run sequentially

      // Verify task execution order from events
      const taskCompletedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.TASK_COMPLETED);
      const completedTaskIds = taskCompletedEvents.map(e => e.payload.taskId);
      
      // Verify execution order - initialize should be first
      expect(completedTaskIds[0]).toBe('initializeSystem');
      
      // The three fetch tasks should complete before generateReport
      const generateReportIndex = completedTaskIds.indexOf('generateReport');
      const fetchUserIndex = completedTaskIds.indexOf('fetchUserData');
      const fetchProductIndex = completedTaskIds.indexOf('fetchProductData');
      const fetchOrderIndex = completedTaskIds.indexOf('fetchOrderData');
      
      expect(fetchUserIndex).toBeLessThan(generateReportIndex);
      expect(fetchProductIndex).toBeLessThan(generateReportIndex);
      expect(fetchOrderIndex).toBeLessThan(generateReportIndex);
    }, 15000);
  });

  describe('Error Handling Workflow', () => {
    it('should handle task failures and continue with independent tasks', async () => {
      // Act
      const result = await service.runErrorHandlingWorkflow();

      // Assert - Check workflow result
      expect(result.totalTasks).toBe(4);
      
      // reliableTask and finalTask should complete
      expect(result.completedTasks).toContain('reliableTask');
      expect(result.completedTasks).toContain('finalTask');

      // Some tasks should fail (flakyTask and timeoutTask are designed to fail)
      expect(result.failedTasks.length).toBeGreaterThan(0);

      // Check events
      const taskFailedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.TASK_FAILED);
      const taskCompletedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.TASK_COMPLETED);

      expect(taskFailedEvents.length).toBeGreaterThan(0);
      
      const completedTaskIds = taskCompletedEvents.map(e => e.payload.taskId);
      expect(completedTaskIds).toContain('reliableTask');
      expect(completedTaskIds).toContain('finalTask');
    }, 15000);

    it('should emit retry events for failing tasks', async () => {
      // Create a workflow with a task that will definitely retry
      const workflow: WorkflowDefinition = {
        tasks: [
          {
            id: 'alwaysFailTask',
            handler: async () => {
              throw new Error('Always fails');
            },
            retries: 2
          }
        ]
      };

      // Act
      await workflowEngine.run(workflow);

      // Assert
      const retryEvents = emittedEvents.filter(e => e.event === WorkflowEvents.TASK_RETRY);
      expect(retryEvents.length).toBeGreaterThanOrEqual(1);
      
      const failedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.TASK_FAILED);
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].payload.taskId).toBe('alwaysFailTask');
    });
  });

  describe('Custom Workflow Patterns', () => {
    it('should handle complex dependency chains', async () => {
      const workflow: WorkflowDefinition = {
        tasks: [
          {
            id: 'root',
            handler: async () => ({ step: 'root' })
          },
          {
            id: 'branch1',
            handler: async () => ({ step: 'branch1' }),
            dependencies: ['root']
          },
          {
            id: 'branch2',
            handler: async () => ({ step: 'branch2' }),
            dependencies: ['root']
          },
          {
            id: 'leaf1',
            handler: async () => ({ step: 'leaf1' }),
            dependencies: ['branch1']
          },
          {
            id: 'leaf2',
            handler: async () => ({ step: 'leaf2' }),
            dependencies: ['branch2']
          },
          {
            id: 'merge',
            handler: async () => ({ step: 'merge' }),
            dependencies: ['leaf1', 'leaf2']
          }
        ]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(6);
      
      // Verify execution order respects dependencies
      const taskCompletedEvents = emittedEvents.filter(e => e.event === WorkflowEvents.TASK_COMPLETED);
      const completedTaskIds = taskCompletedEvents.map(e => e.payload.taskId);
      
      const rootIndex = completedTaskIds.indexOf('root');
      const branch1Index = completedTaskIds.indexOf('branch1');
      const branch2Index = completedTaskIds.indexOf('branch2');
      const leaf1Index = completedTaskIds.indexOf('leaf1');
      const leaf2Index = completedTaskIds.indexOf('leaf2');
      const mergeIndex = completedTaskIds.indexOf('merge');
      
      expect(rootIndex).toBeLessThan(branch1Index);
      expect(rootIndex).toBeLessThan(branch2Index);
      expect(branch1Index).toBeLessThan(leaf1Index);
      expect(branch2Index).toBeLessThan(leaf2Index);
      expect(leaf1Index).toBeLessThan(mergeIndex);
      expect(leaf2Index).toBeLessThan(mergeIndex);
    });

    it('should handle timeout scenarios correctly', async () => {
      const workflow: WorkflowDefinition = {
        tasks: [
          {
            id: 'quickTask',
            handler: async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return { completed: true };
            },
            timeoutMs: 500
          },
          {
            id: 'slowTask',
            handler: async () => {
              await new Promise(resolve => setTimeout(resolve, 2000));
              return { completed: true };
            },
            timeoutMs: 500, // Will timeout
            retries: 1
          }
        ]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.completedTasks).toContain('quickTask');
      expect(result.failedTasks).toContain('slowTask');
      
      const taskFailedEvents = emittedEvents.filter(e => 
        e.event === WorkflowEvents.TASK_FAILED && e.payload.taskId === 'slowTask'
      );
      expect(taskFailedEvents).toHaveLength(1);
      
      // Should have retry events for the slow task
      const retryEvents = emittedEvents.filter(e => 
        e.event === WorkflowEvents.TASK_RETRY && e.payload.taskId === 'slowTask'
      );
      expect(retryEvents.length).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  describe('Event System Integration', () => {
    it('should emit all lifecycle events in correct order', async () => {
      const workflow: WorkflowDefinition = {
        tasks: [
          {
            id: 'testTask',
            handler: async () => ({ result: 'success' })
          }
        ]
      };

      // Act
      await workflowEngine.run(workflow);

      // Assert - Check event order
      const eventTypes = emittedEvents.map(e => e.event);
      
      expect(eventTypes).toContain(WorkflowEvents.WORKFLOW_STARTED);
      expect(eventTypes).toContain(WorkflowEvents.TASK_STARTED);
      expect(eventTypes).toContain(WorkflowEvents.TASK_COMPLETED);
      expect(eventTypes).toContain(WorkflowEvents.WORKFLOW_COMPLETED);
      
      // Workflow started should be first
      expect(eventTypes[0]).toBe(WorkflowEvents.WORKFLOW_STARTED);
      
      // Workflow completed should be last
      expect(eventTypes[eventTypes.length - 1]).toBe(WorkflowEvents.WORKFLOW_COMPLETED);
    });

    it('should include correct payload data in events', async () => {
      const workflow: WorkflowDefinition = {
        tasks: [
          {
            id: 'dataTask',
            handler: async () => ({ data: 'test', timestamp: new Date() })
          }
        ]
      };

      // Act
      await workflowEngine.run(workflow);

      // Assert
      const taskCompletedEvent = emittedEvents.find(e => 
        e.event === WorkflowEvents.TASK_COMPLETED && e.payload.taskId === 'dataTask'
      );
      
      expect(taskCompletedEvent).toBeDefined();
      expect(taskCompletedEvent!.payload.taskId).toBe('dataTask');
      expect(taskCompletedEvent!.payload.timestamp).toBeInstanceOf(Date);
      expect(taskCompletedEvent!.payload.result).toMatchObject({ data: 'test' });
      
      const workflowCompletedEvent = emittedEvents.find(e => 
        e.event === WorkflowEvents.WORKFLOW_COMPLETED
      );
      
      expect(workflowCompletedEvent).toBeDefined();
      expect(workflowCompletedEvent!.payload.totalTasks).toBe(1);
      expect(workflowCompletedEvent!.payload.completedTasks).toBe(1);
      expect(workflowCompletedEvent!.payload.failedTasks).toBe(0);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle workflows with many tasks efficiently', async () => {
      // Create a workflow with many independent tasks
      const taskCount = 20;
      const tasks: TaskDefinition[] = [];
      
      for (let i = 0; i < taskCount; i++) {
        tasks.push({
          id: `task_${i}`,
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return { taskNumber: i };
          }
        });
      }
      
      const workflow: WorkflowDefinition = { tasks };
      
      const startTime = Date.now();
      
      // Act
      const result = await workflowEngine.run(workflow);
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(taskCount);
      expect(result.failedTasks).toHaveLength(0);
      
      // Should complete much faster than sequential execution
      // 20 tasks * 50ms = 1000ms sequential, but should be ~50ms parallel
      expect(executionTime).toBeLessThan(500);
      
      // Verify all tasks completed
      for (let i = 0; i < taskCount; i++) {
        expect(result.completedTasks).toContain(`task_${i}`);
        expect(result.results[`task_${i}`]).toEqual({ taskNumber: i });
      }
    }, 10000);
  });
});