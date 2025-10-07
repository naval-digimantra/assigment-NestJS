import { Injectable, Logger } from '@nestjs/common';
import { TaskDefinition } from '../interfaces/task.interface';
import { ExecutionPlan, ExecutionBatch } from '../interfaces/workflow.interface';

export class CircularDependencyError extends Error {
  constructor(cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

export class MissingDependencyError extends Error {
  constructor(taskId: string, missingDep: string) {
    super(`Task '${taskId}' depends on '${missingDep}' which does not exist`);
    this.name = 'MissingDependencyError';
  }
}

@Injectable()
export class DependencyResolverService {
  private readonly logger = new Logger(DependencyResolverService.name);

  // Main method - figures out what order to run tasks in
  buildExecutionPlan(tasks: TaskDefinition[]): ExecutionPlan {
    this.logger.debug(`Building execution plan for ${tasks.length} tasks`);

    this.validateTasks(tasks);

    const dependencyGraph = this.buildDependencyGraph(tasks);
    this.detectCircularDependencies(dependencyGraph);
    
    // Use topological sort to get the right order
    const sortedTaskIds = this.topologicalSort(dependencyGraph);
    const batches = this.createExecutionBatches(tasks, dependencyGraph, sortedTaskIds);
    
    const executionPlan: ExecutionPlan = {
      batches,
      totalTasks: tasks.length,
      estimatedDuration: this.estimateExecutionDuration(batches)
    };

    this.logger.debug(`Created execution plan with ${batches.length} batches`);
    return executionPlan;
  }

  private validateTasks(tasks: TaskDefinition[]): void {
    const taskIds = new Set<string>();
    
    for (const task of tasks) {
      if (!task.id || typeof task.id !== 'string') {
        throw new Error(`Task must have a valid string ID`);
      }
      
      if (taskIds.has(task.id)) {
        throw new Error(`Duplicate task ID found: ${task.id}`);
      }
      
      taskIds.add(task.id);
      
      if (!task.handler || typeof task.handler !== 'function') {
        throw new Error(`Task '${task.id}' must have a valid handler function`);
      }
      
      if (task.dependencies) {
        for (const depId of task.dependencies) {
          if (!taskIds.has(depId) && !tasks.some(t => t.id === depId)) {
            throw new MissingDependencyError(task.id, depId);
          }
        }
      }
    }
  }

  private buildDependencyGraph(tasks: TaskDefinition[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    
    for (const task of tasks) {
      graph.set(task.id, new Set<string>());
    }
    
    for (const task of tasks) {
      if (task.dependencies) {
        for (const depId of task.dependencies) {
          if (!graph.has(depId)) {
            throw new MissingDependencyError(task.id, depId);
          }
          graph.get(depId)!.add(task.id);
        }
      }
    }
    
    return graph;
  }

  // Check for circular dependencies using DFS
  private detectCircularDependencies(graph: Map<string, Set<string>>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    for (const taskId of graph.keys()) {
      if (!visited.has(taskId)) {
        this.dfsCircularCheck(taskId, graph, visited, recursionStack, path);
      }
    }
  }

  private dfsCircularCheck(
    taskId: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    recursionStack: Set<string>,
    path: string[]
  ): void {
    visited.add(taskId);
    recursionStack.add(taskId);
    path.push(taskId);

    const dependents = graph.get(taskId) || new Set();
    
    for (const dependent of dependents) {
      if (!visited.has(dependent)) {
        this.dfsCircularCheck(dependent, graph, visited, recursionStack, path);
      } else if (recursionStack.has(dependent)) {
        const cycleStart = path.indexOf(dependent);
        const cycle = path.slice(cycleStart).concat(dependent);
        throw new CircularDependencyError(cycle);
      }
    }

    recursionStack.delete(taskId);
    path.pop();
  }

  // Topological sort using Kahn's algorithm
  private topologicalSort(graph: Map<string, Set<string>>): string[] {
    const inDegree = new Map<string, number>();
    const result: string[] = [];
    const queue: string[] = [];

    for (const taskId of graph.keys()) {
      inDegree.set(taskId, 0);
    }

    for (const [taskId, dependents] of graph) {
      for (const dependent of dependents) {
        inDegree.set(dependent, (inDegree.get(dependent) || 0) + 1);
      }
    }

    // Start with tasks that have no dependencies
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const dependents = graph.get(current) || new Set();
      for (const dependent of dependents) {
        const newDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDegree);
        
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    if (result.length !== graph.size) {
      throw new Error('Failed to resolve all dependencies - possible circular dependency');
    }

    return result;
  }

  private createExecutionBatches(
    tasks: TaskDefinition[],
    graph: Map<string, Set<string>>,
    sortedTaskIds: string[]
  ): ExecutionBatch[] {
    const batches: ExecutionBatch[] = [];
    const processed = new Set<string>();
    const taskMap = new Map(tasks.map(task => [task.id, task]));

    while (processed.size < tasks.length) {
      const currentBatch: TaskDefinition[] = [];
      
      for (const taskId of sortedTaskIds) {
        if (processed.has(taskId)) continue;
        
        const task = taskMap.get(taskId)!;
        const canRun = !task.dependencies || 
          task.dependencies.every(depId => processed.has(depId));
        
        if (canRun) {
          currentBatch.push(task);
        }
      }

      if (currentBatch.length === 0) {
        throw new Error('Unable to create execution batch - dependency resolution failed');
      }

      for (const task of currentBatch) {
        processed.add(task.id);
      }

      batches.push({
        tasks: currentBatch,
        canRunInParallel: currentBatch.length > 1
      });
    }

    return batches;
  }

  // Rough estimate of how long the workflow will take
  private estimateExecutionDuration(batches: ExecutionBatch[]): number {
    let totalDuration = 0;
    
    for (const batch of batches) {
      if (batch.canRunInParallel) {
        // parallel tasks - use the longest one
        const maxTimeout = Math.max(...batch.tasks.map(task => task.timeoutMs || 30000));
        totalDuration += maxTimeout;
      } else {
        // sequential - add them all up
        const batchDuration = batch.tasks.reduce(
          (sum, task) => sum + (task.timeoutMs || 30000),
          0
        );
        totalDuration += batchDuration;
      }
    }
    
    return totalDuration;
  }
}