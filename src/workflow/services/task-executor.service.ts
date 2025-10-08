import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { 
  TaskDefinition, 
  TaskExecution, 
  TaskResult
} from '../interfaces/task.interface';
import { TaskEvent } from '../interfaces/events.interface';
import { WorkflowEvents } from '../enums/workflow.enums';
import { TaskStatus } from '../enums/workflow.enums';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
}

@Injectable()
export class TaskExecutorService {
  private readonly DEFAULT_TIMEOUT = 30000;
  private readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 0,
    baseDelay: 1000,
    backoffMultiplier: 2,
    maxDelay: 30000
  };

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async executeTask(
    taskDefinition: TaskDefinition,
    globalRetries?: number,
    abortSignal?: AbortSignal
  ): Promise<TaskResult> {
    const execution: TaskExecution = {
      id: taskDefinition.id,
      status: TaskStatus.PENDING,
      attempts: 0,
      startTime: new Date()
    };

    const maxRetries = taskDefinition.retries ?? globalRetries ?? this.DEFAULT_RETRY_CONFIG.maxAttempts;
    const timeout = taskDefinition.timeoutMs ?? this.DEFAULT_TIMEOUT;

    let lastError: Error | undefined;

    // Execute with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check for abort signal before each attempt
      if (abortSignal?.aborted) {
        execution.status = TaskStatus.FAILED;
        execution.error = new Error('Task execution aborted');
        execution.endTime = new Date();

        this.emitTaskEvent(WorkflowEvents.TASK_FAILED, {
          taskId: taskDefinition.id,
          timestamp: execution.endTime,
          error: execution.error,
          attempt: execution.attempts
        });

        return this.createTaskResult(execution);
      }

      execution.attempts = attempt + 1;
      execution.status = attempt === 0 ? TaskStatus.RUNNING : TaskStatus.RETRYING;

      // Emit appropriate event
      const payload: TaskEvent = {
        taskId: taskDefinition.id,
        timestamp: new Date(),
        attempt: execution.attempts
      };
      let workflowEvent = WorkflowEvents.TASK_RETRY;
      if (attempt === 0) {
        workflowEvent = WorkflowEvents.TASK_STARTED;
      } else {
        payload.error = lastError;
      }
      this.emitTaskEvent(workflowEvent, payload);

      try {
        // Execute task with timeout and abort signal
        const result = await this.executeWithTimeoutAndAbort(
          taskDefinition.handler,
          timeout,
          abortSignal
        );

        // Task succeeded
        execution.status = TaskStatus.COMPLETED;
        execution.result = result;
        execution.endTime = new Date();

        this.emitTaskEvent(WorkflowEvents.TASK_COMPLETED, {
          taskId: taskDefinition.id,
          timestamp: execution.endTime,
          result,
          attempt: execution.attempts
        });

        return this.createTaskResult(execution);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // If aborted, don't retry
        if (abortSignal?.aborted || lastError.message.includes('aborted')) {
          execution.status = TaskStatus.FAILED;
          execution.error = lastError;
          execution.endTime = new Date();

          this.emitTaskEvent(WorkflowEvents.TASK_FAILED, {
            taskId: taskDefinition.id,
            timestamp: execution.endTime,
            error: lastError,
            attempt: execution.attempts
          });

          return this.createTaskResult(execution);
        }
        
        // If this was the last attempt, mark as failed
        if (attempt === maxRetries) {
          execution.status = TaskStatus.FAILED;
          execution.error = lastError;
          execution.endTime = new Date();

          this.emitTaskEvent(WorkflowEvents.TASK_FAILED, {
            taskId: taskDefinition.id,
            timestamp: execution.endTime,
            error: lastError,
            attempt: execution.attempts
          });

          return this.createTaskResult(execution);
        }

        // Wait before retry (with exponential backoff and abort checking)
        if (attempt < maxRetries) {
          await this.waitForRetryWithAbort(attempt, abortSignal);
        }
      }
    }

    // This should never be reached, but just in case
    throw new Error(`Unexpected execution path for task ${taskDefinition.id}`);
  }

  /**
   * Execute a function with timeout and abort signal support
   */
  private async executeWithTimeoutAndAbort<T>(
    handler: () => Promise<T> | T,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (abortListener && abortSignal) {
          abortSignal.removeEventListener('abort', abortListener);
        }
      };

      // Set up timeout
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Task execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Set up abort signal listener
      if (abortSignal) {
        if (abortSignal.aborted) {
          cleanup();
          reject(new Error('Task execution aborted'));
          return;
        }

        abortListener = () => {
          cleanup();
          reject(new Error('Task execution aborted'));
        };
        abortSignal.addEventListener('abort', abortListener);
      }

      // Execute the handler
      Promise.resolve()
        .then(() => handler())
        .then((result) => {
          cleanup();
          resolve(result);
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });
  }

  /**
   * Wait before retry with exponential backoff and abort signal support
   */
  private async waitForRetryWithAbort(attemptNumber: number, abortSignal?: AbortSignal): Promise<void> {
    const delay = Math.min(
      this.DEFAULT_RETRY_CONFIG.baseDelay * 
      Math.pow(this.DEFAULT_RETRY_CONFIG.backoffMultiplier, attemptNumber),
      this.DEFAULT_RETRY_CONFIG.maxDelay
    );

    return new Promise<void>((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(new Error('Retry wait aborted'));
        return;
      }

      let abortListener: (() => void) | undefined;
      let timeoutId: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (abortListener && abortSignal) {
          abortSignal.removeEventListener('abort', abortListener);
        }
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, delay);

      if (abortSignal) {
        abortListener = () => {
          cleanup();
          reject(new Error('Retry wait aborted'));
        };
        abortSignal.addEventListener('abort', abortListener);
      }
    });
  }

  /**
   * Wait before retry with exponential backoff (legacy method for backward compatibility)
   */
  private async waitForRetry(attemptNumber: number): Promise<void> {
    return this.waitForRetryWithAbort(attemptNumber);
  }

  /**
   * Emit task lifecycle event
   */
  private emitTaskEvent(event: WorkflowEvents, payload: TaskEvent): void {
    this.eventEmitter.emit(event, payload);
  }

  /**
   * Create TaskResult from TaskExecution
   */
  private createTaskResult(execution: TaskExecution): TaskResult {
    const executionTime = execution.endTime && execution.startTime
      ? execution.endTime.getTime() - execution.startTime.getTime()
      : 0;

    return {
      taskId: execution.id,
      success: execution.status === TaskStatus.COMPLETED,
      result: execution.result,
      error: execution.error,
      attempts: execution.attempts,
      executionTime
    };
  }
}