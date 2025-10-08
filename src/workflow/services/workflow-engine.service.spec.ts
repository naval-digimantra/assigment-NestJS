import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { WorkflowEngineService } from './workflow-engine.service';
import { DependencyResolverService } from './dependency-resolver.service';
import { TaskExecutorService } from './task-executor.service';
import { 
  WorkflowResult, 
  ExecutionPlan, 
  ExecutionBatch 
} from '../interfaces/workflow.interface';
import { 
  TaskDefinition, 
  TaskResult, 
  WorkflowDefinition 
} from '../interfaces/task.interface';
import { WorkflowEvents } from '../interfaces/events.interface';

describe('WorkflowEngineService', () => {
  let service: WorkflowEngineService;
  let dependencyResolver: jest.Mocked<DependencyResolverService>;
  let taskExecutor: jest.Mocked<TaskExecutorService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  // Mock task definitions for testing
  const mockTask1: TaskDefinition = {
    id: 'task1',
    handler: jest.fn().mockResolvedValue('result1')
  };

  const mockTask2: TaskDefinition = {
    id: 'task2',
    handler: jest.fn().mockResolvedValue('result2'),
    dependencies: ['task1']
  };

  const mockTask3: TaskDefinition = {
    id: 'task3',
    handler: jest.fn().mockResolvedValue('result3')
  };

  beforeEach(async () => {
    const mockDependencyResolver = {
      buildExecutionPlan: jest.fn()
    };

    const mockTaskExecutor = {
      executeTask: jest.fn()
    };

    const mockEventEmitter = {
      emit: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowEngineService,
        {
          provide: DependencyResolverService,
          useValue: mockDependencyResolver
        },
        {
          provide: TaskExecutorService,
          useValue: mockTaskExecutor
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter
        }
      ],
    }).compile();

    service = module.get<WorkflowEngineService>(WorkflowEngineService);
    dependencyResolver = module.get(DependencyResolverService);
    taskExecutor = module.get(TaskExecutorService);
    eventEmitter = module.get(EventEmitter2);

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('run', () => {
    it('should execute a simple workflow successfully', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1, mockTask2]
      };

      const executionPlan: ExecutionPlan = {
        batches: [
          { tasks: [mockTask1], canRunInParallel: false },
          { tasks: [mockTask2], canRunInParallel: false }
        ],
        totalTasks: 2
      };

      const taskResults: TaskResult[] = [
        {
          taskId: 'task1',
          success: true,
          result: 'result1',
          attempts: 1,
          executionTime: 100
        },
        {
          taskId: 'task2',
          success: true,
          result: 'result2',
          attempts: 1,
          executionTime: 150
        }
      ];

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask
        .mockResolvedValueOnce(taskResults[0])
        .mockResolvedValueOnce(taskResults[1]);

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['task1', 'task2']);
      expect(result.failedTasks).toEqual([]);
      expect(result.results).toEqual({
        task1: 'result1',
        task2: 'result2'
      });
      expect(result.totalTasks).toBe(2);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);

      // Verify service interactions
      expect(dependencyResolver.buildExecutionPlan).toHaveBeenCalledWith(workflow.tasks);
      expect(taskExecutor.executeTask).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_STARTED,
        expect.objectContaining({
          totalTasks: 2
        })
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_COMPLETED,
        expect.objectContaining({
          totalTasks: 2,
          completedTasks: 2,
          failedTasks: 0
        })
      );
    });

    it('should execute parallel tasks concurrently', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1, mockTask3] // Both have no dependencies
      };

      const executionPlan: ExecutionPlan = {
        batches: [
          { tasks: [mockTask1, mockTask3], canRunInParallel: true }
        ],
        totalTasks: 2
      };

      const taskResults: TaskResult[] = [
        {
          taskId: 'task1',
          success: true,
          result: 'result1',
          attempts: 1,
          executionTime: 100
        },
        {
          taskId: 'task3',
          success: true,
          result: 'result3',
          attempts: 1,
          executionTime: 80
        }
      ];

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask
        .mockResolvedValueOnce(taskResults[0])
        .mockResolvedValueOnce(taskResults[1]);

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['task1', 'task3']);
      expect(taskExecutor.executeTask).toHaveBeenCalledTimes(2);
      
      // Verify both tasks were called (parallel execution)
      expect(taskExecutor.executeTask).toHaveBeenCalledWith(mockTask1, undefined, expect.any(AbortSignal));
      expect(taskExecutor.executeTask).toHaveBeenCalledWith(mockTask3, undefined, expect.any(AbortSignal));
    });

    it('should handle task failures gracefully', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1, mockTask2]
      };

      const executionPlan: ExecutionPlan = {
        batches: [
          { tasks: [mockTask1], canRunInParallel: false },
          { tasks: [mockTask2], canRunInParallel: false }
        ],
        totalTasks: 2
      };

      const taskError = new Error('Task execution failed');
      const taskResults: TaskResult[] = [
        {
          taskId: 'task1',
          success: false,
          error: taskError,
          attempts: 3,
          executionTime: 200
        },
        {
          taskId: 'task2',
          success: true,
          result: 'result2',
          attempts: 1,
          executionTime: 100
        }
      ];

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask
        .mockResolvedValueOnce(taskResults[0])
        .mockResolvedValueOnce(taskResults[1]);

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toEqual([]);
      expect(result.failedTasks).toEqual(['task1', 'task2']);
      expect(result.errors).toHaveProperty('task1', taskError);
      expect(result.errors).toHaveProperty('task2');
      expect(result.results).toEqual({});
    });

    it('should pass global retries to task executor', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1],
        globalRetries: 3
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      const taskResult: TaskResult = {
        taskId: 'task1',
        success: true,
        result: 'result1',
        attempts: 1,
        executionTime: 100
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockResolvedValue(taskResult);

      // Act
      await service.run(workflow);

      // Assert
      expect(taskExecutor.executeTask).toHaveBeenCalledWith(mockTask1, 3, expect.any(AbortSignal));
    });

    it('should handle workflow validation errors', async () => {
      // Arrange
      const invalidWorkflow: WorkflowDefinition = {
        tasks: []
      };

      // Act
      const result = await service.run(invalidWorkflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.errors).toHaveProperty('workflow');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_FAILED,
        expect.objectContaining({
          error: expect.any(Error)
        })
      );
    });

    it('should handle dependency resolver errors', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const resolverError = new Error('Circular dependency detected');
      dependencyResolver.buildExecutionPlan.mockImplementation(() => {
        throw resolverError;
      });

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.errors).toHaveProperty('workflow', resolverError);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_FAILED,
        expect.objectContaining({
          error: resolverError
        })
      );
    });

    it('should handle batch execution errors', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1, mockTask2]
      };

      const executionPlan: ExecutionPlan = {
        batches: [
          { tasks: [mockTask1], canRunInParallel: false },
          { tasks: [mockTask2], canRunInParallel: false }
        ],
        totalTasks: 2
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask
        .mockResolvedValueOnce({
          taskId: 'task1',
          success: true,
          result: 'result1',
          attempts: 1,
          executionTime: 100
        })
        .mockRejectedValueOnce(new Error('Batch execution failed'));

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toEqual(['task1']);
      expect(result.failedTasks).toEqual(['task2']);
    });
  });

  describe('workflow validation', () => {
    it('should reject null workflow', async () => {
      const result = await service.run(null as any);
      expect(result.success).toBe(false);
      expect(result.errors.workflow.message).toContain('Workflow definition is required');
    });

    it('should reject workflow without tasks', async () => {
      const workflow = {} as WorkflowDefinition;
      const result = await service.run(workflow);
      expect(result.success).toBe(false);
      expect(result.errors.workflow.message).toContain('tasks array');
    });

    it('should reject workflow with empty tasks array', async () => {
      const workflow: WorkflowDefinition = { tasks: [] };
      const result = await service.run(workflow);
      expect(result.success).toBe(false);
      expect(result.errors.workflow.message).toContain('at least one task');
    });

    it('should reject workflow with invalid global timeout', async () => {
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1],
        globalTimeout: -1
      };
      const result = await service.run(workflow);
      expect(result.success).toBe(false);
      expect(result.errors.workflow.message).toContain('positive number');
    });

    it('should reject workflow with invalid global retries', async () => {
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1],
        globalRetries: -1
      };
      const result = await service.run(workflow);
      expect(result.success).toBe(false);
      expect(result.errors.workflow.message).toContain('non-negative number');
    });
  });

  describe('event emission', () => {
    it('should emit workflow lifecycle events', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockResolvedValue({
        taskId: 'task1',
        success: true,
        result: 'result1',
        attempts: 1,
        executionTime: 100
      });

      // Act
      await service.run(workflow);

      // Assert
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_STARTED,
        expect.objectContaining({
          workflowId: expect.any(String),
          timestamp: expect.any(Date),
          totalTasks: 1
        })
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_COMPLETED,
        expect.objectContaining({
          workflowId: expect.any(String),
          timestamp: expect.any(Date),
          totalTasks: 1,
          completedTasks: 1,
          failedTasks: 0,
          result: expect.any(Object)
        })
      );
    });

    it('should emit workflow failure event on error', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: []
      };

      // Act
      await service.run(workflow);

      // Assert
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_FAILED,
        expect.objectContaining({
          workflowId: expect.any(String),
          timestamp: expect.any(Date),
          error: expect.any(Error)
        })
      );
    });
  });

  describe('logging', () => {
    it('should log workflow execution progress', async () => {
      // Arrange
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const debugSpy = jest.spyOn(Logger.prototype, 'debug');

      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockResolvedValue({
        taskId: 'task1',
        success: true,
        result: 'result1',
        attempts: 1,
        executionTime: 100
      });

      // Act
      await service.run(workflow);

      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting workflow execution')
      );
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workflow validation completed')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('completed: 1/1 tasks successful')
      );
    });
  });

  describe('complex workflow patterns', () => {
    it('should handle workflow with mixed success and failure in parallel batches', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1, mockTask3] // Both independent
      };

      const executionPlan: ExecutionPlan = {
        batches: [
          { tasks: [mockTask1, mockTask3], canRunInParallel: true }
        ],
        totalTasks: 2
      };

      const taskResults: TaskResult[] = [
        {
          taskId: 'task1',
          success: true,
          result: 'result1',
          attempts: 1,
          executionTime: 100
        },
        {
          taskId: 'task3',
          success: false,
          error: new Error('Task 3 failed'),
          attempts: 2,
          executionTime: 200
        }
      ];

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask
        .mockResolvedValueOnce(taskResults[0])
        .mockResolvedValueOnce(taskResults[1]);

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toEqual(['task1']);
      expect(result.failedTasks).toEqual(['task3']);
      expect(result.results).toEqual({ task1: 'result1' });
      expect(result.errors).toHaveProperty('task3');
    });

    it('should handle workflow with global timeout configuration', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1],
        globalTimeout: 5000
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockResolvedValue({
        taskId: 'task1',
        success: true,
        result: 'result1',
        attempts: 1,
        executionTime: 100
      });

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(taskExecutor.executeTask).toHaveBeenCalledWith(mockTask1, undefined, expect.any(AbortSignal));
    });

    it('should handle empty batches in execution plan', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const executionPlan: ExecutionPlan = {
        batches: [
          { tasks: [], canRunInParallel: false }, // Empty batch
          { tasks: [mockTask1], canRunInParallel: false }
        ],
        totalTasks: 1
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockResolvedValue({
        taskId: 'task1',
        success: true,
        result: 'result1',
        attempts: 1,
        executionTime: 100
      });

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['task1']);
    });

    it('should handle workflow with large number of parallel tasks', async () => {
      // Arrange
      const largeTasks: TaskDefinition[] = [];
      const taskResults: TaskResult[] = [];
      
      for (let i = 1; i <= 50; i++) {
        largeTasks.push({
          id: `task${i}`,
          handler: jest.fn().mockResolvedValue(`result${i}`)
        });
        taskResults.push({
          taskId: `task${i}`,
          success: true,
          result: `result${i}`,
          attempts: 1,
          executionTime: 50
        });
      }

      const workflow: WorkflowDefinition = {
        tasks: largeTasks
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: largeTasks, canRunInParallel: true }],
        totalTasks: 50
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockImplementation((task) => {
        const index = parseInt(task.id.replace('task', '')) - 1;
        return Promise.resolve(taskResults[index]);
      });

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(50);
      expect(result.failedTasks).toHaveLength(0);
      expect(taskExecutor.executeTask).toHaveBeenCalledTimes(50);
    });

    it('should handle workflow where task executor throws unexpected error', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      const unexpectedError = new Error('Unexpected executor error');
      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockRejectedValue(unexpectedError);

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.failedTasks).toEqual(['task1']);
      expect(result.errors).toHaveProperty('task1', unexpectedError);
    });

    it('should handle workflow with tasks that have no results', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1, mockTask2]
      };

      const executionPlan: ExecutionPlan = {
        batches: [
          { tasks: [mockTask1], canRunInParallel: false },
          { tasks: [mockTask2], canRunInParallel: false }
        ],
        totalTasks: 2
      };

      const taskResults: TaskResult[] = [
        {
          taskId: 'task1',
          success: true,
          // No result property
          attempts: 1,
          executionTime: 100
        } as TaskResult,
        {
          taskId: 'task2',
          success: true,
          result: undefined,
          attempts: 1,
          executionTime: 150
        }
      ];

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask
        .mockResolvedValueOnce(taskResults[0])
        .mockResolvedValueOnce(taskResults[1]);

      // Act
      const result = await service.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['task1', 'task2']);
      expect(result.results).toEqual({
        task2: undefined
      });
    });

    it('should generate unique workflow IDs for concurrent executions', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockResolvedValue({
        taskId: 'task1',
        success: true,
        result: 'result1',
        attempts: 1,
        executionTime: 100
      });

      // Act
      const [result1, result2] = await Promise.all([
        service.run(workflow),
        service.run(workflow)
      ]);

      // Assert
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_STARTED,
        expect.objectContaining({
          workflowId: expect.any(String)
        })
      );

      // Verify that different workflow IDs were generated
      const startedCalls = eventEmitter.emit.mock.calls.filter(
        call => call[0] === WorkflowEvents.WORKFLOW_STARTED
      );
      expect(startedCalls).toHaveLength(2);
      expect(startedCalls[0][1].workflowId).not.toBe(startedCalls[1][1].workflowId);
    });
  });

  describe('performance and memory management', () => {
    it('should handle workflow execution without memory leaks', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      taskExecutor.executeTask.mockResolvedValue({
        taskId: 'task1',
        success: true,
        result: 'result1',
        attempts: 1,
        executionTime: 100
      });

      // Act - Run multiple workflows to check for memory leaks
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(service.run(workflow));
      }
      
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should measure execution time accurately', async () => {
      // Arrange
      const workflow: WorkflowDefinition = {
        tasks: [mockTask1]
      };

      const executionPlan: ExecutionPlan = {
        batches: [{ tasks: [mockTask1], canRunInParallel: false }],
        totalTasks: 1
      };

      dependencyResolver.buildExecutionPlan.mockReturnValue(executionPlan);
      
      // Mock a task that takes some time
      taskExecutor.executeTask.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          taskId: 'task1',
          success: true,
          result: 'result1',
          attempts: 1,
          executionTime: 100
        };
      });

      // Act
      const startTime = Date.now();
      const result = await service.run(workflow);
      const endTime = Date.now();

      // Assert
      expect(result.executionTime).toBeGreaterThanOrEqual(90);
      expect(result.executionTime).toBeLessThanOrEqual(endTime - startTime + 10);
    });
  });
});