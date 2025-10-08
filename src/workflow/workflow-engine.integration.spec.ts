import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowModule } from './workflow.module';
import { WorkflowEngineService } from './services/workflow-engine.service';
import { WorkflowEventLoggerService } from './services/workflow-event-logger.service';
import { WorkflowDefinition, TaskDefinition } from './interfaces/task.interface';
import { WorkflowEvents, TaskEvent, WorkflowEvent } from './interfaces/events.interface';

describe('WorkflowEngine Integration', () => {
  let workflowEngine: WorkflowEngineService;
  let eventEmitter: EventEmitter2;
  let eventLogger: WorkflowEventLoggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [WorkflowModule],
    }).compile();

    // Initialize the module to ensure event listeners are registered
    await module.init();

    workflowEngine = module.get<WorkflowEngineService>(WorkflowEngineService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    eventLogger = module.get<WorkflowEventLoggerService>(WorkflowEventLoggerService);
    
    // Ensure the event logger service is instantiated and listeners are registered
    expect(eventLogger).toBeDefined();
  });

  it('should be defined', () => {
    expect(workflowEngine).toBeDefined();
  });

  it('should execute a simple workflow end-to-end', async () => {
    // Arrange
    const task1: TaskDefinition = {
      id: 'task1',
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result1';
      }
    };

    const task2: TaskDefinition = {
      id: 'task2',
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'result2';
      },
      dependencies: ['task1']
    };

    const workflow: WorkflowDefinition = {
      tasks: [task1, task2],
      globalRetries: 1
    };

    // Act
    const result = await workflowEngine.run(workflow);

    // Assert
    expect(result.success).toBe(true);
    expect(result.completedTasks).toEqual(['task1', 'task2']);
    expect(result.failedTasks).toEqual([]);
    expect(result.results).toEqual({
      task1: 'result1',
      task2: 'result2'
    });
    expect(result.totalTasks).toBe(2);
    expect(result.executionTime).toBeGreaterThan(0);
  });

  it('should handle parallel execution', async () => {
    // Arrange
    const task1: TaskDefinition = {
      id: 'parallel1',
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return 'parallel_result1';
      }
    };

    const task2: TaskDefinition = {
      id: 'parallel2',
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
        return 'parallel_result2';
      }
    };

    const workflow: WorkflowDefinition = {
      tasks: [task1, task2]
    };

    // Act
    const startTime = Date.now();
    const result = await workflowEngine.run(workflow);
    const totalTime = Date.now() - startTime;

    // Assert
    expect(result.success).toBe(true);
    expect(result.completedTasks).toHaveLength(2);
    expect(result.results).toEqual({
      parallel1: 'parallel_result1',
      parallel2: 'parallel_result2'
    });
    
    // Should complete faster than sequential execution (less than 50ms total)
    expect(totalTime).toBeLessThan(50);
  });

  describe('Complex Dependency Scenarios', () => {
    it('should handle diamond dependency pattern with parallel execution', async () => {
      // Arrange - Diamond pattern: A -> B,C -> D
      const taskA: TaskDefinition = {
        id: 'taskA',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'resultA';
        }
      };

      const taskB: TaskDefinition = {
        id: 'taskB',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return 'resultB';
        },
        dependencies: ['taskA']
      };

      const taskC: TaskDefinition = {
        id: 'taskC',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 12));
          return 'resultC';
        },
        dependencies: ['taskA']
      };

      const taskD: TaskDefinition = {
        id: 'taskD',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 8));
          return 'resultD';
        },
        dependencies: ['taskB', 'taskC']
      };

      const workflow: WorkflowDefinition = {
        tasks: [taskA, taskB, taskC, taskD]
      };

      // Act
      const startTime = Date.now();
      const result = await workflowEngine.run(workflow);
      const totalTime = Date.now() - startTime;

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['taskA', 'taskB', 'taskC', 'taskD']);
      expect(result.results).toEqual({
        taskA: 'resultA',
        taskB: 'resultB',
        taskC: 'resultC',
        taskD: 'resultD'
      });
      
      // Should complete faster than sequential execution (B and C run in parallel)
      // Expected: ~10ms (A) + ~15ms (max of B,C parallel) + ~8ms (D) = ~33ms + overhead
      expect(totalTime).toBeLessThan(60);
    });

    it('should handle complex multi-level dependency chains', async () => {
      // Arrange - Complex chain with multiple levels and parallel branches
      const tasks: TaskDefinition[] = [
        {
          id: 'init',
          handler: async () => 'initialized'
        },
        {
          id: 'fetch1',
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return 'data1';
          },
          dependencies: ['init']
        },
        {
          id: 'fetch2',
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 12));
            return 'data2';
          },
          dependencies: ['init']
        },
        {
          id: 'process1',
          handler: async () => 'processed1',
          dependencies: ['fetch1']
        },
        {
          id: 'process2',
          handler: async () => 'processed2',
          dependencies: ['fetch2']
        },
        {
          id: 'combine',
          handler: async () => 'combined',
          dependencies: ['process1', 'process2']
        },
        {
          id: 'validate',
          handler: async () => 'validated',
          dependencies: ['combine']
        },
        {
          id: 'save',
          handler: async () => 'saved',
          dependencies: ['validate']
        }
      ];

      const workflow: WorkflowDefinition = {
        tasks
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(8);
      expect(result.results.save).toBe('saved');
      expect(result.totalTasks).toBe(8);
    });

    it('should handle wide parallel execution with many independent tasks', async () => {
      // Arrange - Many parallel tasks
      const parallelTasks: TaskDefinition[] = Array.from({ length: 10 }, (_, i) => ({
        id: `parallel-task-${i}`,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 5));
          return `result-${i}`;
        }
      }));

      const finalTask: TaskDefinition = {
        id: 'final-aggregator',
        handler: async () => 'aggregated',
        dependencies: parallelTasks.map(t => t.id)
      };

      const workflow: WorkflowDefinition = {
        tasks: [...parallelTasks, finalTask]
      };

      // Act
      const startTime = Date.now();
      const result = await workflowEngine.run(workflow);
      const totalTime = Date.now() - startTime;

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(11);
      expect(result.results['final-aggregator']).toBe('aggregated');
      
      // Should complete much faster than sequential execution
      expect(totalTime).toBeLessThan(100); // Much less than 10 * 25ms average
    });
  });

  describe('Mixed Success/Failure Scenarios', () => {
    it('should handle partial workflow failure with dependency cascade', async () => {
      // Arrange
      const successTask: TaskDefinition = {
        id: 'success-task',
        handler: async () => 'success'
      };

      const failingTask: TaskDefinition = {
        id: 'failing-task',
        handler: async () => {
          throw new Error('Task failure');
        },
        retries: 1
      };

      const dependentTask: TaskDefinition = {
        id: 'dependent-task',
        handler: async () => 'should not execute',
        dependencies: ['failing-task']
      };

      const independentTask: TaskDefinition = {
        id: 'independent-task',
        handler: async () => 'independent success'
      };

      const workflow: WorkflowDefinition = {
        tasks: [successTask, failingTask, dependentTask, independentTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toContain('success-task');
      expect(result.completedTasks).toContain('independent-task');
      expect(result.failedTasks).toContain('failing-task');
      expect(result.failedTasks).toContain('dependent-task'); // skipped due to failed dependency
      expect(result.results['success-task']).toBe('success');
      expect(result.results['independent-task']).toBe('independent success');
      expect(result.errors['failing-task']).toBeInstanceOf(Error);
      expect(result.errors['dependent-task']).toBeInstanceOf(Error); // skipped tasks get error
    });

    it('should handle mixed retry scenarios with some tasks succeeding and others failing', async () => {
      // Arrange
      let task1Attempts = 0;
      let task2Attempts = 0;

      const retrySuccessTask: TaskDefinition = {
        id: 'retry-success',
        handler: async () => {
          task1Attempts++;
          if (task1Attempts < 3) {
            throw new Error(`Attempt ${task1Attempts} failed`);
          }
          return 'success after retries';
        },
        retries: 3
      };

      const retryFailTask: TaskDefinition = {
        id: 'retry-fail',
        handler: async () => {
          task2Attempts++;
          throw new Error(`Permanent failure attempt ${task2Attempts}`);
        },
        retries: 2
      };

      const normalTask: TaskDefinition = {
        id: 'normal-task',
        handler: async () => 'normal success'
      };

      const workflow: WorkflowDefinition = {
        tasks: [retrySuccessTask, retryFailTask, normalTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toEqual(['retry-success', 'normal-task']);
      expect(result.failedTasks).toEqual(['retry-fail']);
      expect(result.results['retry-success']).toBe('success after retries');
      expect(result.results['normal-task']).toBe('normal success');
      expect(result.errors['retry-fail']).toBeInstanceOf(Error);
      expect(task1Attempts).toBe(3);
      expect(task2Attempts).toBe(3); // Initial + 2 retries
    });

    it('should handle failure in parallel branch without affecting other branches', async () => {
      // Arrange
      const branch1Task1: TaskDefinition = {
        id: 'branch1-task1',
        handler: async () => 'branch1-result1'
      };

      const branch1Task2: TaskDefinition = {
        id: 'branch1-task2',
        handler: async () => {
          throw new Error('Branch 1 failure');
        },
        dependencies: ['branch1-task1'],
        retries: 1
      };

      const branch2Task1: TaskDefinition = {
        id: 'branch2-task1',
        handler: async () => 'branch2-result1'
      };

      const branch2Task2: TaskDefinition = {
        id: 'branch2-task2',
        handler: async () => 'branch2-result2',
        dependencies: ['branch2-task1']
      };

      const workflow: WorkflowDefinition = {
        tasks: [branch1Task1, branch1Task2, branch2Task1, branch2Task2]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toEqual(['branch1-task1', 'branch2-task1', 'branch2-task2']);
      expect(result.failedTasks).toEqual(['branch1-task2']);
      expect(result.results['branch2-task2']).toBe('branch2-result2');
      expect(result.errors['branch1-task2']).toBeInstanceOf(Error);
    });
  });

  describe('Timeout and Retry Behavior', () => {
    it('should handle task timeouts with retry logic', async () => {
      // Arrange
      let attemptCount = 0;
      const timeoutTask: TaskDefinition = {
        id: 'timeout-task',
        handler: async () => {
          attemptCount++;
          if (attemptCount < 3) {
            // Simulate timeout by taking longer than allowed
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          return 'success after timeout retries';
        },
        timeoutMs: 100,
        retries: 3
      };

      const workflow: WorkflowDefinition = {
        tasks: [timeoutTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['timeout-task']);
      expect(result.results['timeout-task']).toBe('success after timeout retries');
      expect(attemptCount).toBe(3);
    });

    it('should handle permanent timeout failures', async () => {
      // Arrange
      const permanentTimeoutTask: TaskDefinition = {
        id: 'permanent-timeout',
        handler: async () => {
          // Always timeout
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'should not reach here';
        },
        timeoutMs: 50,
        retries: 2
      };

      const workflow: WorkflowDefinition = {
        tasks: [permanentTimeoutTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.failedTasks).toEqual(['permanent-timeout']);
      expect(result.errors['permanent-timeout']).toBeInstanceOf(Error);
      expect(result.errors['permanent-timeout'].message).toContain('timed out');
    });

    it('should handle mixed timeout and regular retry scenarios', async () => {
      // Arrange
      let timeoutAttempts = 0;
      let errorAttempts = 0;

      const timeoutRetryTask: TaskDefinition = {
        id: 'timeout-retry',
        handler: async () => {
          timeoutAttempts++;
          if (timeoutAttempts < 2) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          return 'timeout success';
        },
        timeoutMs: 100,
        retries: 2
      };

      const errorRetryTask: TaskDefinition = {
        id: 'error-retry',
        handler: async () => {
          errorAttempts++;
          if (errorAttempts < 3) {
            throw new Error(`Error attempt ${errorAttempts}`);
          }
          return 'error success';
        },
        retries: 3
      };

      const workflow: WorkflowDefinition = {
        tasks: [timeoutRetryTask, errorRetryTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['timeout-retry', 'error-retry']);
      expect(result.results['timeout-retry']).toBe('timeout success');
      expect(result.results['error-retry']).toBe('error success');
      expect(timeoutAttempts).toBe(2);
      expect(errorAttempts).toBe(3);
    });

    it('should respect individual task timeout settings', async () => {
      // Arrange
      const slowTask: TaskDefinition = {
        id: 'slow-task',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'slow result';
        },
        timeoutMs: 100 // Individual timeout shorter than task execution
      };

      const workflow: WorkflowDefinition = {
        tasks: [slowTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.failedTasks).toEqual(['slow-task']);
      expect(result.errors['slow-task']).toBeInstanceOf(Error);
      expect(result.errors['slow-task'].message).toContain('timed out');
    });
  });

  describe('Event System Integration', () => {
    let loggerSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let eventEmitterSpy: jest.SpyInstance;

    beforeEach(() => {
      // Mock logger methods to capture console output
      loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      
      // Spy on event emitter to verify events are emitted
      eventEmitterSpy = jest.spyOn(eventEmitter, 'emit');
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should emit and log all lifecycle events for successful workflow', async () => {
      // Arrange
      const task1: TaskDefinition = {
        id: 'event-task-1',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'success1';
        }
      };

      const task2: TaskDefinition = {
        id: 'event-task-2',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return 'success2';
        },
        dependencies: ['event-task-1']
      };

      const workflow: WorkflowDefinition = {
        tasks: [task1, task2]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert workflow execution
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['event-task-1', 'event-task-2']);

      // Verify events were emitted
      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_STARTED,
        expect.objectContaining({
          timestamp: expect.any(Date),
          totalTasks: 2
        })
      );

      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_STARTED,
        expect.objectContaining({
          taskId: 'event-task-1',
          timestamp: expect.any(Date)
        })
      );

      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_COMPLETED,
        expect.objectContaining({
          taskId: 'event-task-1',
          timestamp: expect.any(Date),
          result: 'success1'
        })
      );

      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_STARTED,
        expect.objectContaining({
          taskId: 'event-task-2',
          timestamp: expect.any(Date)
        })
      );

      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_COMPLETED,
        expect.objectContaining({
          taskId: 'event-task-2',
          timestamp: expect.any(Date),
          result: 'success2'
        })
      );

      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_COMPLETED,
        expect.objectContaining({
          timestamp: expect.any(Date),
          totalTasks: 2,
          completedTasks: 2,
          failedTasks: 0
        })
      );

      // Verify console logging occurred
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Workflow \[workflow_.*\] started at/)
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task [event-task-1] started at')
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task [event-task-1] completed at')
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task [event-task-2] started at')
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task [event-task-2] completed at')
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Workflow \[workflow_.*\] completed at/)
      );
    });

    it('should emit and log retry events for failing tasks', async () => {
      // Arrange
      let attemptCount = 0;
      const retryTask: TaskDefinition = {
        id: 'retry-event-task',
        handler: async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error(`Attempt ${attemptCount} failed`);
          }
          return 'success after retries';
        },
        retries: 3
      };

      const workflow: WorkflowDefinition = {
        tasks: [retryTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert workflow execution
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['retry-event-task']);

      // Verify retry events were emitted
      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_RETRY,
        expect.objectContaining({
          taskId: 'retry-event-task',
          timestamp: expect.any(Date),
          attempt: 2,
          error: expect.any(Error)
        })
      );

      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_RETRY,
        expect.objectContaining({
          taskId: 'retry-event-task',
          timestamp: expect.any(Date),
          attempt: 3,
          error: expect.any(Error)
        })
      );

      // Verify console logging for retries
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task [retry-event-task] retry attempt 2 at')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task [retry-event-task] retry attempt 3 at')
      );
    });

    it('should emit and log failure events for permanently failed tasks', async () => {
      // Arrange
      const failingTask: TaskDefinition = {
        id: 'failing-event-task',
        handler: async () => {
          throw new Error('Permanent task failure');
        },
        retries: 1
      };

      const workflow: WorkflowDefinition = {
        tasks: [failingTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert workflow execution
      expect(result.success).toBe(false);
      expect(result.failedTasks).toEqual(['failing-event-task']);

      // Verify failure events were emitted
      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_FAILED,
        expect.objectContaining({
          taskId: 'failing-event-task',
          timestamp: expect.any(Date),
          error: expect.any(Error)
        })
      );

      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.WORKFLOW_FAILED,
        expect.objectContaining({
          timestamp: expect.any(Date),
          error: expect.any(Error)
        })
      );

      // Verify console logging for failures
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task [failing-event-task] failed at')
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Workflow \[workflow_.*\] failed at/)
      );
    });

    it('should handle event payload validation correctly', async () => {
      // Arrange
      const testTask: TaskDefinition = {
        id: 'payload-validation-task',
        handler: async () => ({ data: 'test', timestamp: new Date() })
      };

      const workflow: WorkflowDefinition = {
        tasks: [testTask]
      };

      // Act
      await workflowEngine.run(workflow);

      // Assert event payloads have correct structure
      const taskStartedCall = eventEmitterSpy.mock.calls.find(
        call => call[0] === WorkflowEvents.TASK_STARTED
      );
      const taskCompletedCall = eventEmitterSpy.mock.calls.find(
        call => call[0] === WorkflowEvents.TASK_COMPLETED
      );
      const workflowStartedCall = eventEmitterSpy.mock.calls.find(
        call => call[0] === WorkflowEvents.WORKFLOW_STARTED
      );

      // Validate TaskEvent structure
      const taskStartedPayload: TaskEvent = taskStartedCall[1];
      expect(taskStartedPayload).toMatchObject({
        taskId: expect.any(String),
        timestamp: expect.any(Date)
      });

      const taskCompletedPayload: TaskEvent = taskCompletedCall[1];
      expect(taskCompletedPayload).toMatchObject({
        taskId: expect.any(String),
        timestamp: expect.any(Date),
        result: expect.any(Object)
      });

      // Validate WorkflowEvent structure
      const workflowStartedPayload: WorkflowEvent = workflowStartedCall[1];
      expect(workflowStartedPayload).toMatchObject({
        timestamp: expect.any(Date),
        totalTasks: expect.any(Number)
      });
    });

    it('should support external event listeners', async () => {
      // Arrange
      const externalEvents: Array<{ event: string; payload: any }> = [];
      
      // Register external event listeners
      eventEmitter.on(WorkflowEvents.TASK_STARTED, (payload) => {
        externalEvents.push({ event: WorkflowEvents.TASK_STARTED, payload });
      });
      
      eventEmitter.on(WorkflowEvents.TASK_COMPLETED, (payload) => {
        externalEvents.push({ event: WorkflowEvents.TASK_COMPLETED, payload });
      });

      const testTask: TaskDefinition = {
        id: 'external-listener-task',
        handler: async () => 'external test result'
      };

      const workflow: WorkflowDefinition = {
        tasks: [testTask]
      };

      // Act
      await workflowEngine.run(workflow);

      // Assert external listeners received events
      expect(externalEvents).toHaveLength(2);
      
      const startedEvent = externalEvents.find(e => e.event === WorkflowEvents.TASK_STARTED);
      const completedEvent = externalEvents.find(e => e.event === WorkflowEvents.TASK_COMPLETED);
      
      expect(startedEvent).toBeDefined();
      expect(startedEvent?.payload.taskId).toBe('external-listener-task');
      
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.payload.taskId).toBe('external-listener-task');
      expect(completedEvent?.payload.result).toBe('external test result');
    });

    it('should emit events in correct order for complex workflows', async () => {
      // Arrange
      const task1: TaskDefinition = {
        id: 'order-task-1',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'result1';
        }
      };

      const task2: TaskDefinition = {
        id: 'order-task-2',
        handler: async () => 'result2',
        dependencies: ['order-task-1']
      };

      const workflow: WorkflowDefinition = {
        tasks: [task1, task2]
      };

      // Act
      await workflowEngine.run(workflow);

      // Assert events were emitted in correct order by checking the spy calls
      const emitCalls = eventEmitterSpy.mock.calls;
      const eventOrder = emitCalls.map(call => {
        const [eventType, payload] = call;
        if (eventType === WorkflowEvents.TASK_STARTED || 
            eventType === WorkflowEvents.TASK_COMPLETED) {
          return `${eventType}:${payload.taskId}`;
        }
        return eventType;
      });

      expect(eventOrder).toEqual([
        WorkflowEvents.WORKFLOW_STARTED,
        `${WorkflowEvents.TASK_STARTED}:order-task-1`,
        `${WorkflowEvents.TASK_COMPLETED}:order-task-1`,
        `${WorkflowEvents.TASK_STARTED}:order-task-2`,
        `${WorkflowEvents.TASK_COMPLETED}:order-task-2`,
        WorkflowEvents.WORKFLOW_COMPLETED
      ]);
    });

    it('should handle multiple external listeners without interference', async () => {
      // Arrange
      const testTask: TaskDefinition = {
        id: 'multi-listener-task',
        handler: async () => 'multi listener result'
      };

      const workflow: WorkflowDefinition = {
        tasks: [testTask]
      };

      // Act
      await workflowEngine.run(workflow);

      // Assert that the event was emitted (multiple listeners would receive the same event)
      expect(eventEmitterSpy).toHaveBeenCalledWith(
        WorkflowEvents.TASK_COMPLETED,
        expect.objectContaining({
          taskId: 'multi-listener-task',
          result: 'multi listener result',
          timestamp: expect.any(Date)
        })
      );

      // Verify the event was emitted exactly once (listeners would all receive this same emission)
      const taskCompletedCalls = eventEmitterSpy.mock.calls.filter(
        call => call[0] === WorkflowEvents.TASK_COMPLETED
      );
      expect(taskCompletedCalls).toHaveLength(1);
    });
  });

  describe('Realistic Workflow Scenarios', () => {
    it('should handle data processing pipeline workflow', async () => {
      // Arrange - Simulate a realistic data processing pipeline
      const fetchDataTask: TaskDefinition = {
        id: 'fetchData',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { data: [1, 2, 3, 4, 5], source: 'api' };
        },
        timeoutMs: 5000,
        retries: 2
      };

      const validateDataTask: TaskDefinition = {
        id: 'validateData',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { valid: true, errors: [] };
        },
        dependencies: ['fetchData'],
        retries: 1
      };

      const processDataTask: TaskDefinition = {
        id: 'processData',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return { processed: [2, 4, 6, 8, 10], algorithm: 'multiply-by-2' };
        },
        dependencies: ['validateData'],
        timeoutMs: 10000
      };

      const generateReportTask: TaskDefinition = {
        id: 'generateReport',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { report: 'Data processing completed successfully', timestamp: new Date() };
        },
        dependencies: ['processData']
      };

      const saveResultTask: TaskDefinition = {
        id: 'saveResult',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 25));
          return { saved: true, location: '/tmp/results.json' };
        },
        dependencies: ['processData'],
        retries: 3
      };

      const notifyTask: TaskDefinition = {
        id: 'notify',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return { notified: true, recipients: ['admin@example.com'] };
        },
        dependencies: ['generateReport', 'saveResult']
      };

      const workflow: WorkflowDefinition = {
        tasks: [fetchDataTask, validateDataTask, processDataTask, generateReportTask, saveResultTask, notifyTask],
        globalRetries: 1,
        globalTimeout: 30000
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual([
        'fetchData', 'validateData', 'processData', 'generateReport', 'saveResult', 'notify'
      ]);
      expect(result.results.fetchData).toEqual({ data: [1, 2, 3, 4, 5], source: 'api' });
      expect(result.results.processData).toEqual({ processed: [2, 4, 6, 8, 10], algorithm: 'multiply-by-2' });
      expect(result.results.notify).toEqual({ notified: true, recipients: ['admin@example.com'] });
      expect(result.totalTasks).toBe(6);
    });

    it('should handle microservice orchestration workflow', async () => {
      // Arrange - Simulate microservice orchestration
      let authAttempts = 0;
      
      const authenticateTask: TaskDefinition = {
        id: 'authenticate',
        handler: async () => {
          authAttempts++;
          if (authAttempts < 2) {
            throw new Error('Authentication service temporarily unavailable');
          }
          await new Promise(resolve => setTimeout(resolve, 15));
          return { token: 'jwt-token-123', expires: Date.now() + 3600000 };
        },
        retries: 2,
        timeoutMs: 3000
      };

      const fetchUserProfileTask: TaskDefinition = {
        id: 'fetchUserProfile',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { userId: 'user-123', name: 'John Doe', email: 'john@example.com' };
        },
        dependencies: ['authenticate'],
        retries: 1
      };

      const fetchUserPreferencesTask: TaskDefinition = {
        id: 'fetchUserPreferences',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 18));
          return { theme: 'dark', language: 'en', notifications: true };
        },
        dependencies: ['authenticate'],
        retries: 1
      };

      const fetchRecommendationsTask: TaskDefinition = {
        id: 'fetchRecommendations',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 35));
          return { recommendations: ['item1', 'item2', 'item3'], algorithm: 'collaborative-filtering' };
        },
        dependencies: ['fetchUserProfile', 'fetchUserPreferences'],
        timeoutMs: 5000
      };

      const logActivityTask: TaskDefinition = {
        id: 'logActivity',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 8));
          return { logged: true, activityId: 'activity-456' };
        },
        dependencies: ['fetchUserProfile']
      };

      const workflow: WorkflowDefinition = {
        tasks: [authenticateTask, fetchUserProfileTask, fetchUserPreferencesTask, fetchRecommendationsTask, logActivityTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(5);
      expect(result.results.authenticate.token).toBe('jwt-token-123');
      expect(result.results.fetchRecommendations.recommendations).toEqual(['item1', 'item2', 'item3']);
      expect(authAttempts).toBe(2); // Should have retried once
    });

    it('should handle batch processing workflow with error recovery', async () => {
      // Arrange - Simulate batch processing with some failures
      const batchItems = Array.from({ length: 5 }, (_, i) => i + 1);
      let processingErrors = new Set([2, 4]); // Items 2 and 4 will fail initially

      const batchTasks: TaskDefinition[] = batchItems.map(item => ({
        id: `process-item-${item}`,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 10));
          
          if (processingErrors.has(item)) {
            processingErrors.delete(item); // Remove error for retry
            throw new Error(`Processing failed for item ${item}`);
          }
          
          return { item, processed: true, result: item * 2 };
        },
        retries: 1,
        timeoutMs: 2000
      }));

      const aggregateTask: TaskDefinition = {
        id: 'aggregate-results',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { aggregated: true, totalItems: batchItems.length };
        },
        dependencies: batchTasks.map(t => t.id)
      };

      const workflow: WorkflowDefinition = {
        tasks: [...batchTasks, aggregateTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(6); // 5 batch items + 1 aggregate
      expect(result.results['aggregate-results']).toEqual({ aggregated: true, totalItems: 5 });
      
      // Verify all batch items were processed successfully after retries
      batchItems.forEach(item => {
        expect(result.results[`process-item-${item}`]).toEqual({
          item,
          processed: true,
          result: item * 2
        });
      });
    });

    it('should handle real-time event processing workflow', async () => {
      // Arrange - Simulate real-time event processing
      const events = [
        { id: 'event-1', type: 'user-action', data: { action: 'click', element: 'button' } },
        { id: 'event-2', type: 'system-alert', data: { level: 'warning', message: 'High CPU usage' } },
        { id: 'event-3', type: 'user-action', data: { action: 'scroll', position: 100 } }
      ];

      const ingestEventsTask: TaskDefinition = {
        id: 'ingest-events',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 12));
          return { ingested: events.length, events };
        }
      };

      const filterEventsTask: TaskDefinition = {
        id: 'filter-events',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 8));
          const filtered = events.filter(e => e.type === 'user-action');
          return { filtered: filtered.length, events: filtered };
        },
        dependencies: ['ingest-events']
      };

      const enrichEventsTask: TaskDefinition = {
        id: 'enrich-events',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { enriched: true, metadata: { timestamp: Date.now(), source: 'web-app' } };
        },
        dependencies: ['filter-events']
      };

      const storeEventsTask: TaskDefinition = {
        id: 'store-events',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { stored: true, database: 'events-db', collection: 'user-actions' };
        },
        dependencies: ['enrich-events'],
        retries: 2
      };

      const triggerAlertsTask: TaskDefinition = {
        id: 'trigger-alerts',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          const systemEvents = events.filter(e => e.type === 'system-alert');
          return { alerts: systemEvents.length, triggered: systemEvents.length > 0 };
        },
        dependencies: ['ingest-events']
      };

      const workflow: WorkflowDefinition = {
        tasks: [ingestEventsTask, filterEventsTask, enrichEventsTask, storeEventsTask, triggerAlertsTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(5);
      expect(result.results['ingest-events'].ingested).toBe(3);
      expect(result.results['filter-events'].filtered).toBe(2); // Only user-action events
      expect(result.results['trigger-alerts'].alerts).toBe(1); // Only system-alert events
      expect(result.results['store-events'].stored).toBe(true);
    });
  });
});