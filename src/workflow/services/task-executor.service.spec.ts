import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskExecutorService } from './task-executor.service';
import { TaskDefinition } from '../interfaces/task.interface';
import { TaskStatus } from '../enums/workflow.enums';
import { WorkflowEvents } from '../interfaces/events.interface';

describe('TaskExecutorService', () => {
  let service: TaskExecutorService;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    const mockEventEmitter = {
      emit: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskExecutorService,
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter
        }
      ]
    }).compile();

    service = module.get<TaskExecutorService>(TaskExecutorService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeTask', () => {
    it('should execute a successful synchronous task', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'test-task',
        handler: () => 'success'
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.taskId).toBe('test-task');
      expect(result.attempts).toBe(1);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should execute a successful asynchronous task', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'async-task',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'async success';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBe('async success');
      expect(result.taskId).toBe('async-task');
      expect(result.attempts).toBe(1);
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should emit TASK_STARTED and TASK_COMPLETED events for successful task', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'event-task',
        handler: () => 'result'
      };

      await service.executeTask(taskDefinition);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.TASK_STARTED,
        expect.objectContaining({
          taskId: 'event-task',
          timestamp: expect.any(Date),
          attempt: 1
        })
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.TASK_COMPLETED,
        expect.objectContaining({
          taskId: 'event-task',
          timestamp: expect.any(Date),
          result: 'result',
          attempt: 1
        })
      );
    });

    it('should handle task failure without retries', async () => {
      const error = new Error('Task failed');
      const taskDefinition: TaskDefinition = {
        id: 'failing-task',
        handler: () => {
          throw error;
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.taskId).toBe('failing-task');
      expect(result.attempts).toBe(1);
    });

    it('should emit TASK_FAILED event for failed task', async () => {
      const error = new Error('Task failed');
      const taskDefinition: TaskDefinition = {
        id: 'failing-task',
        handler: () => {
          throw error;
        }
      };

      await service.executeTask(taskDefinition);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.TASK_FAILED,
        expect.objectContaining({
          taskId: 'failing-task',
          timestamp: expect.any(Date),
          error,
          attempt: 1
        })
      );
    });

    it('should retry failed tasks according to retry configuration', async () => {
      let attemptCount = 0;
      const taskDefinition: TaskDefinition = {
        id: 'retry-task',
        retries: 2,
        handler: () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error(`Attempt ${attemptCount} failed`);
          }
          return 'success on retry';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success on retry');
      expect(result.attempts).toBe(3);
      expect(attemptCount).toBe(3);
    });

    it('should emit TASK_RETRY events during retries', async () => {
      let attemptCount = 0;
      const taskDefinition: TaskDefinition = {
        id: 'retry-task',
        retries: 2,
        handler: () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error(`Attempt ${attemptCount} failed`);
          }
          return 'success';
        }
      };

      await service.executeTask(taskDefinition);

      // Should emit TASK_STARTED, TASK_RETRY (2 times), and TASK_COMPLETED
      expect(eventEmitter.emit).toHaveBeenCalledTimes(4);
      
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.TASK_RETRY,
        expect.objectContaining({
          taskId: 'retry-task',
          attempt: 2,
          error: expect.any(Error)
        })
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WorkflowEvents.TASK_RETRY,
        expect.objectContaining({
          taskId: 'retry-task',
          attempt: 3,
          error: expect.any(Error)
        })
      );
    });

    it('should fail after exhausting all retry attempts', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'always-failing-task',
        retries: 2,
        handler: () => {
          throw new Error('Always fails');
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3); // 1 initial + 2 retries
      expect(result.error?.message).toBe('Always fails');
    });

    it('should use global retries when task retries not specified', async () => {
      let attemptCount = 0;
      const taskDefinition: TaskDefinition = {
        id: 'global-retry-task',
        handler: () => {
          attemptCount++;
          if (attemptCount < 2) {
            throw new Error('Fail once');
          }
          return 'success';
        }
      };

      const result = await service.executeTask(taskDefinition, 1);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should handle task timeout', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'timeout-task',
        timeoutMs: 100,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'should not reach here';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timed out');
      expect(result.attempts).toBe(1);
    }, 10000);

    it('should retry timed out tasks', async () => {
      let attemptCount = 0;
      const taskDefinition: TaskDefinition = {
        id: 'timeout-retry-task',
        timeoutMs: 50,
        retries: 1,
        handler: async () => {
          attemptCount++;
          if (attemptCount === 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return 'success on retry';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success on retry');
      expect(result.attempts).toBe(2);
    }, 10000);

    it('should use default timeout when not specified', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'default-timeout-task',
        handler: async () => {
          // This should complete well within the default 30 second timeout
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'completed';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBe('completed');
    });

    it('should handle non-Error exceptions', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'string-error-task',
        handler: () => {
          throw 'String error';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('String error');
    });

    it('should calculate execution time correctly', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'timing-task',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'timed';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.executionTime).toBeGreaterThanOrEqual(40);
      expect(result.executionTime).toBeLessThan(200);
    });
  });

  describe('retry backoff behavior', () => {
    it('should implement exponential backoff between retries', async () => {
      const startTime = Date.now();
      let attemptTimes: number[] = [];
      
      const taskDefinition: TaskDefinition = {
        id: 'backoff-task',
        retries: 2,
        handler: () => {
          attemptTimes.push(Date.now());
          throw new Error('Always fails');
        }
      };

      await service.executeTask(taskDefinition);

      expect(attemptTimes).toHaveLength(3);
      
      // Check that there's increasing delay between attempts
      // First retry should be after ~1000ms, second after ~2000ms more
      const firstDelay = attemptTimes[1] - attemptTimes[0];
      const secondDelay = attemptTimes[2] - attemptTimes[1];
      
      expect(firstDelay).toBeGreaterThanOrEqual(900);
      expect(secondDelay).toBeGreaterThanOrEqual(1800);
    }, 15000);
  });

  describe('complex retry and timeout scenarios', () => {
    it('should handle task that succeeds after timeout on first attempt', async () => {
      let attemptCount = 0;
      const taskDefinition: TaskDefinition = {
        id: 'timeout-then-success-task',
        timeoutMs: 100,
        retries: 1,
        handler: async () => {
          attemptCount++;
          if (attemptCount === 1) {
            // First attempt times out
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'should not reach here';
          } else {
            // Second attempt succeeds quickly
            return 'success on retry';
          }
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success on retry');
      expect(result.attempts).toBe(2);
    }, 10000);

    it('should handle task with zero retries and timeout', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'zero-retry-timeout-task',
        timeoutMs: 50,
        retries: 0,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'should not reach here';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.error?.message).toContain('timed out');
    }, 5000);

    it('should handle task that throws during timeout cleanup', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'cleanup-error-task',
        timeoutMs: 50,
        handler: async () => {
          // Simulate a task that doesn't handle cancellation gracefully
          await new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error('Task cleanup error'));
            }, 100);
          });
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timed out');
    }, 5000);

    it('should handle task with very high retry count', async () => {
      let attemptCount = 0;
      const taskDefinition: TaskDefinition = {
        id: 'high-retry-task',
        retries: 10,
        handler: () => {
          attemptCount++;
          if (attemptCount < 5) {
            throw new Error(`Attempt ${attemptCount} failed`);
          }
          return 'success after many retries';
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success after many retries');
      expect(result.attempts).toBe(5);
    }, 30000);

    it('should handle task that returns undefined result', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'undefined-result-task',
        handler: () => {
          return undefined;
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBeUndefined();
    });

    it('should handle task that returns null result', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'null-result-task',
        handler: () => {
          return null;
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toBeNull();
    });

    it('should handle task that returns complex object result', async () => {
      const complexResult = {
        data: [1, 2, 3],
        metadata: { timestamp: new Date(), version: '1.0' },
        nested: { deep: { value: 'test' } }
      };

      const taskDefinition: TaskDefinition = {
        id: 'complex-result-task',
        handler: () => complexResult
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(true);
      expect(result.result).toEqual(complexResult);
    });

    it('should handle task with custom timeout that overrides global timeout', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'custom-timeout-task',
        timeoutMs: 200,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'completed within custom timeout';
        }
      };

      const result = await service.executeTask(taskDefinition, 0); // No global timeout override

      expect(result.success).toBe(true);
      expect(result.result).toBe('completed within custom timeout');
    }, 5000);

    it('should handle promise rejection in async task', async () => {
      const rejectionError = new Error('Promise rejected');
      const taskDefinition: TaskDefinition = {
        id: 'promise-rejection-task',
        handler: async () => {
          return Promise.reject(rejectionError);
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.error).toBe(rejectionError);
    });

    it('should handle task that throws after successful async operation', async () => {
      const taskDefinition: TaskDefinition = {
        id: 'async-then-throw-task',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error('Error after async operation');
        }
      };

      const result = await service.executeTask(taskDefinition);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Error after async operation');
    });
  });
});