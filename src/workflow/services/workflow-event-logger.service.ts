import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowEvents, TaskEvent, WorkflowEvent } from '../interfaces/events.interface';

/**
 * Service that listens to all workflow lifecycle events and logs them to console
 */
@Injectable()
export class WorkflowEventLoggerService {
  private readonly logger = new Logger(WorkflowEventLoggerService.name);

  /**
   * Handle task started events
   */
  @OnEvent(WorkflowEvents.TASK_STARTED)
  handleTaskStarted(payload: TaskEvent): void {
    this.logger.log(
      `Task [${payload.taskId}] started at [${payload.timestamp.toISOString()}]`
    );
  }

  /**
   * Handle task completed events
   */
  @OnEvent(WorkflowEvents.TASK_COMPLETED)
  handleTaskCompleted(payload: TaskEvent): void {
    this.logger.log(
      `Task [${payload.taskId}] completed at [${payload.timestamp.toISOString()}]`
    );
  }

  /**
   * Handle task failed events
   */
  @OnEvent(WorkflowEvents.TASK_FAILED)
  handleTaskFailed(payload: TaskEvent): void {
    const errorMessage = payload.error?.message || 'Unknown error';
    this.logger.error(
      `Task [${payload.taskId}] failed at [${payload.timestamp.toISOString()}] - Error: ${errorMessage}`
    );
  }

  /**
   * Handle task retry events
   */
  @OnEvent(WorkflowEvents.TASK_RETRY)
  handleTaskRetry(payload: TaskEvent): void {
    const errorMessage = payload.error?.message || 'Unknown error';
    this.logger.warn(
      `Task [${payload.taskId}] retry attempt ${payload.attempt} at [${payload.timestamp.toISOString()}] - Previous error: ${errorMessage}`
    );
  }

  /**
   * Handle workflow started events
   */
  @OnEvent(WorkflowEvents.WORKFLOW_STARTED)
  handleWorkflowStarted(payload: WorkflowEvent): void {
    const workflowId = payload.workflowId || 'unnamed';
    this.logger.log(
      `Workflow [${workflowId}] started at [${payload.timestamp.toISOString()}] with ${payload.totalTasks} tasks`
    );
  }

  /**
   * Handle workflow completed events
   */
  @OnEvent(WorkflowEvents.WORKFLOW_COMPLETED)
  handleWorkflowCompleted(payload: WorkflowEvent): void {
    const workflowId = payload.workflowId || 'unnamed';
    this.logger.log(
      `Workflow [${workflowId}] completed at [${payload.timestamp.toISOString()}] - ` +
      `${payload.completedTasks}/${payload.totalTasks} tasks successful`
    );
  }

  /**
   * Handle workflow failed events
   */
  @OnEvent(WorkflowEvents.WORKFLOW_FAILED)
  handleWorkflowFailed(payload: WorkflowEvent): void {
    const workflowId = payload.workflowId || 'unnamed';
    const errorMessage = payload.error?.message || 'Unknown error';
    this.logger.error(
      `Workflow [${workflowId}] failed at [${payload.timestamp.toISOString()}] - Error: ${errorMessage}`
    );
  }
}