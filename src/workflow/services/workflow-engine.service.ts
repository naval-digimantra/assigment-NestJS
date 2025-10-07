import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { 
  WorkflowResult, 
  ExecutionPlan 
} from '../interfaces/workflow.interface';
import { 
  TaskDefinition, 
  TaskResult, 
  WorkflowDefinition 
} from '../interfaces/task.interface';
import { WorkflowEvents, WorkflowEvent } from '../interfaces/events.interface';
import { DependencyResolverService } from './dependency-resolver.service';
import { TaskExecutorService } from './task-executor.service';

export interface WorkflowFailurePolicy {
  stopOnFirstFailure: boolean;
  allowPartialSuccess: boolean;
  maxFailurePercentage: number;
}

interface ActiveWorkflow {
  workflowId: string;
  startTime: Date;
  abortController: AbortController;
  taskPromises: Map<string, Promise<TaskResult>>;
  cleanupCallbacks: Array<() => Promise<void> | void>;
}

@Injectable()
export class WorkflowEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkflowEngineService.name);
  private readonly activeWorkflows = new Map<string, ActiveWorkflow>();
  private isShuttingDown = false;

  private readonly DEFAULT_FAILURE_POLICY: WorkflowFailurePolicy = {
    stopOnFirstFailure: false,
    allowPartialSuccess: true,
    maxFailurePercentage: 50
  };

  constructor(
    private readonly dependencyResolver: DependencyResolverService,
    private readonly taskExecutor: TaskExecutorService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Initiating graceful shutdown of workflow engine');
    this.isShuttingDown = true;

    if (this.activeWorkflows.size > 0) {
      this.logger.warn(`Cancelling ${this.activeWorkflows.size} active workflows`);
      
      const shutdownPromises = Array.from(this.activeWorkflows.values()).map(
        workflow => this.cancelWorkflow(workflow.workflowId, 'Service shutdown')
      );

      await Promise.allSettled(shutdownPromises);
    }

    this.logger.log('Workflow engine shutdown completed');
  }

  async cancelWorkflow(workflowId: string, reason: string = 'Manual cancellation'): Promise<void> {
    const activeWorkflow = this.activeWorkflows.get(workflowId);
    if (!activeWorkflow) {
      this.logger.warn(`Cannot cancel workflow ${workflowId}: not found in active workflows`);
      return;
    }

    this.logger.log(`Cancelling workflow ${workflowId}: ${reason}`);

    try {
      activeWorkflow.abortController.abort();

      const taskResults = await Promise.allSettled(
        Array.from(activeWorkflow.taskPromises.values())
      );

      for (const cleanup of activeWorkflow.cleanupCallbacks) {
        try {
          await cleanup();
        } catch (error) {
          this.logger.error(`Cleanup callback failed for workflow ${workflowId}:`, error);
        }
      }

      this.emitWorkflowEvent(WorkflowEvents.WORKFLOW_FAILED, {
        workflowId,
        timestamp: new Date(),
        totalTasks: activeWorkflow.taskPromises.size,
        error: new Error(`Workflow cancelled: ${reason}`)
      });

      this.logger.log(`Workflow ${workflowId} cancelled successfully`);
    } catch (error) {
      this.logger.error(`Error during workflow cancellation for ${workflowId}:`, error);
    } finally {
      this.activeWorkflows.delete(workflowId);
    }
  }

  // Main entry point - runs a workflow
  async run(
    workflow: WorkflowDefinition, 
    failurePolicy?: Partial<WorkflowFailurePolicy>
  ): Promise<WorkflowResult> {
    // Check if service is shutting down
    if (this.isShuttingDown) {
      throw new Error('Cannot start new workflow: service is shutting down');
    }

    const startTime = Date.now();
    const workflowId = this.generateWorkflowId();
    const policy = { ...this.DEFAULT_FAILURE_POLICY, ...failurePolicy };
    
    // Create active workflow tracking
    const activeWorkflow: ActiveWorkflow = {
      workflowId,
      startTime: new Date(),
      abortController: new AbortController(),
      taskPromises: new Map(),
      cleanupCallbacks: []
    };

    this.activeWorkflows.set(workflowId, activeWorkflow);

    try {
      // Step 1: Comprehensive workflow validation
      this.validateWorkflowDefinition(workflow);
      
      this.logger.log(`Starting workflow ${workflowId} with ${workflow.tasks.length} tasks`);
      
      // Log workflow start
      this.logger.log(`Starting workflow execution with ${workflow.tasks.length} tasks`);
      
      // Emit workflow started event
      this.emitWorkflowEvent(WorkflowEvents.WORKFLOW_STARTED, {
        workflowId,
        timestamp: new Date(),
        totalTasks: workflow.tasks.length
      });

      this.logger.debug('Workflow validation completed successfully');

      // Step 2: Build execution plan using dependency resolver
      const executionPlan = this.dependencyResolver.buildExecutionPlan(workflow.tasks);
      this.logger.debug(`Created execution plan with ${executionPlan.batches.length} batches`);

      // Step 3: Execute workflow according to plan with enhanced error handling
      const workflowResult = await this.executeWorkflowPlanWithRecovery(
        executionPlan, 
        workflow,
        workflowId,
        policy,
        activeWorkflow.abortController.signal
      );

      // Calculate total execution time
      const executionTime = Date.now() - startTime;
      workflowResult.executionTime = executionTime;

      // Log workflow completion metrics
      const totalExecutionTime = Date.now() - startTime;
      
      // Emit appropriate workflow completion event based on success
      if (workflowResult.success) {
        this.emitWorkflowEvent(WorkflowEvents.WORKFLOW_COMPLETED, {
          workflowId,
          timestamp: new Date(),
          totalTasks: workflow.tasks.length,
          completedTasks: workflowResult.completedTasks.length,
          failedTasks: workflowResult.failedTasks.length,
          result: workflowResult
        });
      } else {
        // Workflow failed due to task failures
        const workflowError = new Error(`Workflow failed: ${workflowResult.failedTasks.length} of ${workflow.tasks.length} tasks failed`);
        this.emitWorkflowEvent(WorkflowEvents.WORKFLOW_FAILED, {
          workflowId,
          timestamp: new Date(),
          totalTasks: workflow.tasks.length,
          completedTasks: workflowResult.completedTasks.length,
          failedTasks: workflowResult.failedTasks.length,
          result: workflowResult,
          error: workflowError
        });
      }

      this.logger.log(
        `Workflow ${workflowId} completed: ${workflowResult.completedTasks.length}/${workflow.tasks.length} tasks successful ` +
        `(total time: ${totalExecutionTime}ms)`
      );

      return workflowResult;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const workflowError = error instanceof Error ? error : new Error(String(error));
      
      this.logger.error(`Workflow ${workflowId} execution failed: ${workflowError.message}`, workflowError.stack);

      // Perform cleanup for failed workflow
      await this.cleanupFailedWorkflow(workflowId, workflowError);

      // Emit workflow failure event
      this.emitWorkflowEvent(WorkflowEvents.WORKFLOW_FAILED, {
        workflowId,
        timestamp: new Date(),
        totalTasks: workflow?.tasks?.length || 0,
        error: workflowError
      });

      // Return failed workflow result
      return {
        success: false,
        completedTasks: [],
        failedTasks: Array.isArray(workflow?.tasks) ? workflow.tasks.map(task => task.id) : [],
        results: {},
        errors: { workflow: workflowError },
        executionTime,
        totalTasks: workflow?.tasks?.length || 0
      };
    } finally {
      // Always clean up active workflow tracking
      this.activeWorkflows.delete(workflowId);
    }
  }

  /**
   * Comprehensive validation of workflow definition
   */
  private validateWorkflowDefinition(workflow: WorkflowDefinition): void {
    if (!workflow) {
      throw new Error('Workflow definition is required');
    }

    if (!workflow.tasks || !Array.isArray(workflow.tasks)) {
      throw new Error('Workflow must contain a tasks array');
    }

    if (workflow.tasks.length === 0) {
      throw new Error('Workflow must contain at least one task');
    }

    // Validate global timeout if specified
    if (workflow.globalTimeout !== undefined) {
      if (typeof workflow.globalTimeout !== 'number' || workflow.globalTimeout <= 0) {
        throw new Error('Global timeout must be a positive number');
      }
      if (workflow.globalTimeout > 86400000) { // 24 hours
        throw new Error('Global timeout cannot exceed 24 hours (86400000ms)');
      }
    }

    // Validate global retries if specified
    if (workflow.globalRetries !== undefined) {
      if (typeof workflow.globalRetries !== 'number' || workflow.globalRetries < 0) {
        throw new Error('Global retries must be a non-negative number');
      }
      if (workflow.globalRetries > 10) {
        throw new Error('Global retries cannot exceed 10 attempts');
      }
    }

    // Validate individual tasks
    const taskIds = new Set<string>();
    const allDependencies = new Set<string>();

    for (let i = 0; i < workflow.tasks.length; i++) {
      const task = workflow.tasks[i];
      const taskContext = `Task ${i + 1} (${task?.id || 'unnamed'})`;

      // Validate task structure
      if (!task || typeof task !== 'object') {
        throw new Error(`${taskContext}: Task must be an object`);
      }

      // Validate task ID
      if (!task.id || typeof task.id !== 'string') {
        throw new Error(`${taskContext}: Task ID is required and must be a string`);
      }

      if (task.id.trim() === '') {
        throw new Error(`${taskContext}: Task ID cannot be empty or whitespace`);
      }

      if (taskIds.has(task.id)) {
        throw new Error(`${taskContext}: Duplicate task ID '${task.id}' found`);
      }
      taskIds.add(task.id);

      // Validate task handler
      if (!task.handler || typeof task.handler !== 'function') {
        throw new Error(`${taskContext}: Task handler is required and must be a function`);
      }

      // Validate dependencies
      if (task.dependencies !== undefined) {
        if (!Array.isArray(task.dependencies)) {
          throw new Error(`${taskContext}: Dependencies must be an array`);
        }

        for (const dep of task.dependencies) {
          if (typeof dep !== 'string' || dep.trim() === '') {
            throw new Error(`${taskContext}: Each dependency must be a non-empty string`);
          }
          allDependencies.add(dep);
        }

        // Check for self-dependency
        if (task.dependencies.includes(task.id)) {
          throw new Error(`${taskContext}: Task cannot depend on itself`);
        }

        // Check for duplicate dependencies
        const uniqueDeps = new Set(task.dependencies);
        if (uniqueDeps.size !== task.dependencies.length) {
          throw new Error(`${taskContext}: Duplicate dependencies found`);
        }
      }

      // Validate retries
      if (task.retries !== undefined) {
        if (typeof task.retries !== 'number' || task.retries < 0) {
          throw new Error(`${taskContext}: Retries must be a non-negative number`);
        }
        if (task.retries > 10) {
          throw new Error(`${taskContext}: Retries cannot exceed 10 attempts`);
        }
      }

      // Validate timeout
      if (task.timeoutMs !== undefined) {
        if (typeof task.timeoutMs !== 'number' || task.timeoutMs <= 0) {
          throw new Error(`${taskContext}: Timeout must be a positive number`);
        }
        if (task.timeoutMs > 3600000) { // 1 hour
          throw new Error(`${taskContext}: Timeout cannot exceed 1 hour (3600000ms)`);
        }
      }
    }

    // Validate that all dependencies reference existing tasks
    for (const dep of allDependencies) {
      if (!taskIds.has(dep)) {
        throw new Error(`Dependency '${dep}' references non-existent task`);
      }
    }

    // Additional validation: check for reasonable workflow size
    if (workflow.tasks.length > 1000) {
      throw new Error('Workflow cannot contain more than 1000 tasks');
    }

    this.logger.debug(`Comprehensive workflow validation passed for ${workflow.tasks.length} tasks`);
  }

  /**
   * Executes the workflow according to the execution plan with recovery mechanisms
   */
  private async executeWorkflowPlanWithRecovery(
    executionPlan: ExecutionPlan,
    workflow: WorkflowDefinition,
    workflowId: string,
    failurePolicy: WorkflowFailurePolicy,
    abortSignal: AbortSignal
  ): Promise<WorkflowResult> {
    const results: Record<string, any> = {};
    const errors: Record<string, Error> = {};
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];
    const skippedTasks: string[] = [];

    this.logger.debug(`Executing workflow plan with ${executionPlan.batches.length} batches`);

    // Execute each batch in sequence
    for (let batchIndex = 0; batchIndex < executionPlan.batches.length; batchIndex++) {
      // Check for abort signal
      if (abortSignal.aborted) {
        this.logger.warn(`Workflow ${workflowId} aborted during batch ${batchIndex + 1}`);
        
        // Mark remaining tasks as skipped
        for (let i = batchIndex; i < executionPlan.batches.length; i++) {
          for (const task of executionPlan.batches[i].tasks) {
            if (!completedTasks.includes(task.id) && !failedTasks.includes(task.id)) {
              skippedTasks.push(task.id);
              errors[task.id] = new Error('Task skipped due to workflow cancellation');
            }
          }
        }
        break;
      }

      const batch = executionPlan.batches[batchIndex];
      
      this.logger.debug(
        `Executing batch ${batchIndex + 1}/${executionPlan.batches.length} ` +
        `with ${batch.tasks.length} tasks (parallel: ${batch.canRunInParallel})`
      );

      // Check if we should skip this batch due to dependency failures
      const shouldSkipBatch = this.shouldSkipBatchDueToDependencies(
        batch, 
        failedTasks, 
        workflow.tasks
      );

      if (shouldSkipBatch) {
        this.logger.warn(`Skipping batch ${batchIndex + 1} due to failed dependencies`);
        
        for (const task of batch.tasks) {
          skippedTasks.push(task.id);
          errors[task.id] = new Error('Task skipped due to failed dependencies');
        }
        continue;
      }

      try {
        const batchResults = await this.executeBatchWithRecovery(
          batch, 
          workflow.globalRetries,
          abortSignal
        );
        
        // Process batch results
        for (const taskResult of batchResults) {

          if (taskResult.success) {
            completedTasks.push(taskResult.taskId);
            results[taskResult.taskId] = taskResult.result;
            this.logger.debug(`Task ${taskResult.taskId} completed successfully in ${taskResult.executionTime}ms`);
          } else {
            failedTasks.push(taskResult.taskId);
            errors[taskResult.taskId] = taskResult.error || new Error('Unknown task error');
            this.logger.warn(`Task ${taskResult.taskId} failed after ${taskResult.attempts} attempts: ${taskResult.error?.message}`);
          }
        }

        // Apply failure policy
        const shouldStopExecution = this.shouldStopExecutionDueToFailures(
          failedTasks.length,
          completedTasks.length + failedTasks.length,
          workflow.tasks.length,
          failurePolicy
        );

        if (shouldStopExecution) {
          this.logger.warn(`Stopping workflow execution due to failure policy`);
          
          // Mark remaining tasks as skipped
          for (let i = batchIndex + 1; i < executionPlan.batches.length; i++) {
            for (const task of executionPlan.batches[i].tasks) {
              skippedTasks.push(task.id);
              errors[task.id] = new Error('Task skipped due to failure policy');
            }
          }
          break;
        }

      } catch (error) {
        const batchError = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Batch ${batchIndex + 1} execution failed: ${batchError.message}`);
        
        // Mark all tasks in this batch as failed
        for (const task of batch.tasks) {
          failedTasks.push(task.id);
          errors[task.id] = batchError;
        }

        // Check if we should stop due to batch failure
        if (failurePolicy.stopOnFirstFailure) {
          this.logger.warn(`Stopping workflow execution due to batch failure and stopOnFirstFailure policy`);
          break;
        }
      }
    }

    const workflowResult: WorkflowResult = {
      success: failedTasks.length === 0 && skippedTasks.length === 0,
      completedTasks,
      failedTasks: [...failedTasks, ...skippedTasks],
      results,
      errors,
      executionTime: 0, // Will be set by caller
      totalTasks: workflow.tasks.length
    };

    this.logger.log(
      `Workflow execution completed: ${completedTasks.length} successful, ${failedTasks.length} failed, ${skippedTasks.length} skipped`
    );

    return workflowResult;
  }

  /**
   * Executes a batch of tasks with recovery mechanisms
   */
  private async executeBatchWithRecovery(
    batch: { tasks: TaskDefinition[]; canRunInParallel: boolean },
    globalRetries?: number,
    abortSignal?: AbortSignal
  ): Promise<TaskResult[]> {
    if (batch.canRunInParallel && batch.tasks.length > 1) {
      this.logger.debug(`Executing ${batch.tasks.length} tasks in parallel`);
      
      // Optimize parallel execution with controlled concurrency
      const maxConcurrency = Math.min(batch.tasks.length, this.getOptimalConcurrency());
      
      if (batch.tasks.length <= maxConcurrency) {
        // Execute all tasks in parallel
        const taskPromises = batch.tasks.map(task => 
          this.executeTaskWithAbortSupport(task, globalRetries, abortSignal)
        );
        
        return Promise.all(taskPromises);
      } else {
        // Execute in chunks to control concurrency
        return this.executeTasksInChunks(batch.tasks, maxConcurrency, globalRetries, abortSignal);
      }
    } else {
      this.logger.debug(`Executing ${batch.tasks.length} tasks sequentially`);
      
      // Execute tasks sequentially with abort checking
      const results: TaskResult[] = [];
      for (const task of batch.tasks) {
        if (abortSignal?.aborted) {
          // Return failed result for remaining tasks
          results.push({
            taskId: task.id,
            success: false,
            error: new Error('Task cancelled due to workflow abort'),
            attempts: 0,
            executionTime: 0
          });
          continue;
        }

        const result = await this.executeTaskWithAbortSupport(task, globalRetries, abortSignal);
        results.push(result);
      }
      
      return results;
    }
  }

  /**
   * Execute task with abort signal support
   */
  private async executeTaskWithAbortSupport(
    task: TaskDefinition,
    globalRetries?: number,
    abortSignal?: AbortSignal
  ): Promise<TaskResult> {
    if (abortSignal?.aborted) {
      return {
        taskId: task.id,
        success: false,
        error: new Error('Task cancelled before execution'),
        attempts: 0,
        executionTime: 0
      };
    }

    return this.taskExecutor.executeTask(task, globalRetries, abortSignal);
  }

  /**
   * Check if batch should be skipped due to failed dependencies
   */
  private shouldSkipBatchDueToDependencies(
    batch: { tasks: TaskDefinition[] },
    failedTasks: string[],
    allTasks: TaskDefinition[]
  ): boolean {
    return batch.tasks.some(task => {
      if (!task.dependencies || task.dependencies.length === 0) {
        return false;
      }

      // Check if any dependency has failed
      return task.dependencies.some(dep => failedTasks.includes(dep));
    });
  }

  /**
   * Determine if execution should stop based on failure policy
   */
  private shouldStopExecutionDueToFailures(
    failedCount: number,
    processedCount: number,
    totalCount: number,
    policy: WorkflowFailurePolicy
  ): boolean {
    if (policy.stopOnFirstFailure && failedCount > 0) {
      return true;
    }

    if (!policy.allowPartialSuccess && failedCount > 0) {
      return true;
    }

    const failurePercentage = (failedCount / Math.max(processedCount, 1)) * 100;
    if (failurePercentage > policy.maxFailurePercentage) {
      return true;
    }

    return false;
  }

  /**
   * Clean up resources for a failed workflow
   */
  private async cleanupFailedWorkflow(workflowId: string, error: Error): Promise<void> {
    const activeWorkflow = this.activeWorkflows.get(workflowId);
    if (!activeWorkflow) {
      return;
    }

    this.logger.debug(`Cleaning up failed workflow ${workflowId}`);

    try {
      // Cancel any running tasks
      activeWorkflow.abortController.abort();

      // Wait for tasks to settle (with timeout)
      const cleanupTimeout = new Promise(resolve => setTimeout(resolve, 5000));
      const taskSettlement = Promise.allSettled(
        Array.from(activeWorkflow.taskPromises.values())
      );

      await Promise.race([cleanupTimeout, taskSettlement]);

      // Run cleanup callbacks
      for (const cleanup of activeWorkflow.cleanupCallbacks) {
        try {
          await cleanup();
        } catch (cleanupError) {
          this.logger.error(`Cleanup callback failed for workflow ${workflowId}:`, cleanupError);
        }
      }

      this.logger.debug(`Cleanup completed for workflow ${workflowId}`);
    } catch (cleanupError) {
      this.logger.error(`Error during cleanup for workflow ${workflowId}:`, cleanupError);
    }
  }

  /**
   * Emits workflow-level events
   */
  private emitWorkflowEvent(event: WorkflowEvents, payload: WorkflowEvent): void {
    this.eventEmitter.emit(event, payload);
    
    // Also log the event for debugging
    this.logger.debug(`Emitted event: ${event}`, { 
      workflowId: payload.workflowId,
      timestamp: payload.timestamp 
    });
  }

  /**
   * Register a cleanup callback for a workflow
   */
  registerCleanupCallback(workflowId: string, callback: () => Promise<void> | void): void {
    const activeWorkflow = this.activeWorkflows.get(workflowId);
    if (activeWorkflow) {
      activeWorkflow.cleanupCallbacks.push(callback);
    }
  }

  /**
   * Get list of active workflow IDs
   */
  getActiveWorkflowIds(): string[] {
    return Array.from(this.activeWorkflows.keys());
  }

  /**
   * Check if a workflow is currently active
   */
  isWorkflowActive(workflowId: string): boolean {
    return this.activeWorkflows.has(workflowId);
  }

  /**
   * Execute tasks in controlled chunks for optimal concurrency
   */
  private async executeTasksInChunks(
    tasks: TaskDefinition[],
    maxConcurrency: number,
    globalRetries?: number,
    abortSignal?: AbortSignal
  ): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    
    for (let i = 0; i < tasks.length; i += maxConcurrency) {
      if (abortSignal?.aborted) {
        // Add failed results for remaining tasks
        for (let j = i; j < tasks.length; j++) {
          results.push({
            taskId: tasks[j].id,
            success: false,
            error: new Error('Task cancelled due to workflow abort'),
            attempts: 0,
            executionTime: 0
          });
        }
        break;
      }

      const chunk = tasks.slice(i, i + maxConcurrency);
      const chunkPromises = chunk.map(task => 
        this.executeTaskWithAbortSupport(task, globalRetries, abortSignal)
      );
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }
    
    return results;
  }

  /**
   * Get optimal concurrency - simple approach based on CPU cores
   */
  private getOptimalConcurrency(): number {
    const os = require('os');
    const cpuCores = os.cpus().length;
    // TODO: make this configurable instead of hardcoded
    return Math.min(cpuCores * 2, 10);
  }



  /**
   * Generates a unique workflow ID for tracking
   */
  private generateWorkflowId(): string {
    return `workflow_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}