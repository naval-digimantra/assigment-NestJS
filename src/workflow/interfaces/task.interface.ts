import { TaskStatus } from '../enums/workflow.enums';

/**
 * Core task definition interface
 */
export interface TaskDefinition {
  /** Unique identifier for the task */
  id: string;
  /** Function to execute for this task - can be sync or async */
  handler: () => Promise<any> | any;
  /** Array of task IDs that must complete before this task can run */
  dependencies?: string[];
  /** Number of retry attempts if task fails (default: 0) */
  retries?: number;
  /** Timeout in milliseconds for task execution (default: 30000) */
  timeoutMs?: number;
}

/**
 * Workflow definition containing multiple tasks
 */
export interface WorkflowDefinition {
  /** Array of tasks to execute */
  tasks: TaskDefinition[];
  /** Global timeout for the entire workflow in milliseconds */
  globalTimeout?: number;
  /** Global retry count that applies to all tasks without specific retry settings */
  globalRetries?: number;
}


/**
 * Task execution state tracking
 */
export interface TaskExecution {
  /** Task identifier */
  id: string;
  /** Current execution status */
  status: TaskStatus;
  /** Result data if task completed successfully */
  result?: any;
  /** Error information if task failed */
  error?: Error;
  /** Number of execution attempts made */
  attempts: number;
  /** Timestamp when task execution started */
  startTime?: Date;
  /** Timestamp when task execution ended */
  endTime?: Date;
}

/**
 * Result of a single task execution
 */
export interface TaskResult {
  /** Task identifier */
  taskId: string;
  /** Whether the task completed successfully */
  success: boolean;
  /** Result data if successful */
  result?: any;
  /** Error information if failed */
  error?: Error;
  /** Total number of attempts made */
  attempts: number;
  /** Total execution time in milliseconds */
  executionTime: number;
}