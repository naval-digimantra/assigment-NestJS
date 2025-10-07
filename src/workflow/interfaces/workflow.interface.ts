/**
 * Result of an entire workflow execution
 */
export interface WorkflowResult {
  /** Whether the entire workflow completed successfully */
  success: boolean;
  /** Array of task IDs that completed successfully */
  completedTasks: string[];
  /** Array of task IDs that failed */
  failedTasks: string[];
  /** Map of task IDs to their result data */
  results: Record<string, any>;
  /** Map of task IDs to their error information */
  errors: Record<string, Error>;
  /** Total workflow execution time in milliseconds */
  executionTime: number;
  /** Total number of tasks in the workflow */
  totalTasks: number;
}

/**
 * Execution batch for parallel task execution
 */
export interface ExecutionBatch {
  /** Tasks that can be executed in this batch */
  tasks: import('./task.interface').TaskDefinition[];
  /** Whether tasks in this batch can run in parallel */
  canRunInParallel: boolean;
}

/**
 * Execution plan created by dependency resolver
 */
export interface ExecutionPlan {
  /** Ordered batches of tasks to execute */
  batches: ExecutionBatch[];
  /** Total number of tasks in the plan */
  totalTasks: number;
  /** Estimated duration in milliseconds (optional) */
  estimatedDuration?: number;
}