/**
 * Workflow lifecycle events enumeration
 */
export enum WorkflowEvents {
  TASK_STARTED = 'task.started',
  TASK_COMPLETED = 'task.completed',
  TASK_FAILED = 'task.failed',
  TASK_RETRY = 'task.retry',
  WORKFLOW_STARTED = 'workflow.started',
  WORKFLOW_COMPLETED = 'workflow.completed',
  WORKFLOW_FAILED = 'workflow.failed'
}

/**
 * Base event payload for task-related events
 */
export interface TaskEvent {
  /** Task identifier */
  taskId: string;
  /** Event timestamp */
  timestamp: Date;
  /** Current attempt number (for retry events) */
  attempt?: number;
  /** Task result data (for completion events) */
  result?: any;
  /** Error information (for failure events) */
  error?: Error;
}

/**
 * Event payload for workflow-level events
 */
export interface WorkflowEvent {
  /** Workflow identifier or name */
  workflowId?: string;
  /** Event timestamp */
  timestamp: Date;
  /** Total number of tasks in workflow */
  totalTasks?: number;
  /** Number of completed tasks */
  completedTasks?: number;
  /** Number of failed tasks */
  failedTasks?: number;
  /** Workflow execution result (for completion events) */
  result?: import('./workflow.interface').WorkflowResult;
  /** Error information (for failure events) */
  error?: Error;
}