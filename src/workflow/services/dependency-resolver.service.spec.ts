import { Test, TestingModule } from '@nestjs/testing';
import { DependencyResolverService, CircularDependencyError, MissingDependencyError } from './dependency-resolver.service';
import { TaskDefinition } from '../interfaces/task.interface';
import { ExecutionPlan } from '../interfaces/workflow.interface';

describe('DependencyResolverService', () => {
  let service: DependencyResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DependencyResolverService],
    }).compile();

    service = module.get<DependencyResolverService>(DependencyResolverService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildExecutionPlan', () => {
    it('should create execution plan for tasks with no dependencies', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2' },
        { id: 'task3', handler: () => 'result3' },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.totalTasks).toBe(3);
      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].canRunInParallel).toBe(true);
      expect(plan.batches[0].tasks).toHaveLength(3);
    });

    it('should create execution plan for linear dependency chain', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2', dependencies: ['task1'] },
        { id: 'task3', handler: () => 'result3', dependencies: ['task2'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.totalTasks).toBe(3);
      expect(plan.batches).toHaveLength(3);
      
      // Each batch should have one task since they're sequential
      expect(plan.batches[0].tasks[0].id).toBe('task1');
      expect(plan.batches[1].tasks[0].id).toBe('task2');
      expect(plan.batches[2].tasks[0].id).toBe('task3');
      
      // Single tasks can't run in parallel
      expect(plan.batches[0].canRunInParallel).toBe(false);
      expect(plan.batches[1].canRunInParallel).toBe(false);
      expect(plan.batches[2].canRunInParallel).toBe(false);
    });

    it('should create execution plan for complex dependency graph', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2' },
        { id: 'task3', handler: () => 'result3', dependencies: ['task1'] },
        { id: 'task4', handler: () => 'result4', dependencies: ['task2'] },
        { id: 'task5', handler: () => 'result5', dependencies: ['task3', 'task4'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.totalTasks).toBe(5);
      expect(plan.batches).toHaveLength(3);
      
      // First batch: task1 and task2 (no dependencies)
      expect(plan.batches[0].tasks).toHaveLength(2);
      expect(plan.batches[0].canRunInParallel).toBe(true);
      const firstBatchIds = plan.batches[0].tasks.map(t => t.id);
      expect(firstBatchIds).toContain('task1');
      expect(firstBatchIds).toContain('task2');
      
      // Second batch: task3 and task4 (depend on first batch)
      expect(plan.batches[1].tasks).toHaveLength(2);
      expect(plan.batches[1].canRunInParallel).toBe(true);
      const secondBatchIds = plan.batches[1].tasks.map(t => t.id);
      expect(secondBatchIds).toContain('task3');
      expect(secondBatchIds).toContain('task4');
      
      // Third batch: task5 (depends on task3 and task4)
      expect(plan.batches[2].tasks).toHaveLength(1);
      expect(plan.batches[2].tasks[0].id).toBe('task5');
      expect(plan.batches[2].canRunInParallel).toBe(false);
    });

    it('should estimate execution duration correctly', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', timeoutMs: 1000 },
        { id: 'task2', handler: () => 'result2', timeoutMs: 2000 },
        { id: 'task3', handler: () => 'result3', dependencies: ['task1', 'task2'], timeoutMs: 3000 },
      ];

      const plan = service.buildExecutionPlan(tasks);

      // First batch: task1 and task2 in parallel (max 2000ms)
      // Second batch: task3 sequential (3000ms)
      // Total: 2000 + 3000 = 5000ms
      expect(plan.estimatedDuration).toBe(5000);
    });

    it('should use default timeout when not specified', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2' },
      ];

      const plan = service.buildExecutionPlan(tasks);

      // Two tasks in parallel with default 30000ms timeout
      expect(plan.estimatedDuration).toBe(30000);
    });
  });

  describe('validation', () => {
    it('should throw error for tasks without ID', () => {
      const tasks: TaskDefinition[] = [
        { id: '', handler: () => 'result1' } as TaskDefinition,
      ];

      expect(() => service.buildExecutionPlan(tasks)).toThrow('Task must have a valid string ID');
    });

    it('should throw error for duplicate task IDs', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task1', handler: () => 'result2' },
      ];

      expect(() => service.buildExecutionPlan(tasks)).toThrow('Duplicate task ID found: task1');
    });

    it('should throw error for tasks without handler', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: null as any },
      ];

      expect(() => service.buildExecutionPlan(tasks)).toThrow("Task 'task1' must have a valid handler function");
    });

    it('should throw MissingDependencyError for non-existent dependencies', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', dependencies: ['nonexistent'] },
      ];

      expect(() => service.buildExecutionPlan(tasks)).toThrow(MissingDependencyError);
      expect(() => service.buildExecutionPlan(tasks)).toThrow("Task 'task1' depends on 'nonexistent' which does not exist");
    });
  });

  describe('circular dependency detection', () => {
    it('should detect simple circular dependency', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', dependencies: ['task2'] },
        { id: 'task2', handler: () => 'result2', dependencies: ['task1'] },
      ];

      expect(() => service.buildExecutionPlan(tasks)).toThrow(CircularDependencyError);
    });

    it('should detect complex circular dependency', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', dependencies: ['task3'] },
        { id: 'task2', handler: () => 'result2', dependencies: ['task1'] },
        { id: 'task3', handler: () => 'result3', dependencies: ['task2'] },
      ];

      expect(() => service.buildExecutionPlan(tasks)).toThrow(CircularDependencyError);
    });

    it('should detect self-referencing task', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', dependencies: ['task1'] },
      ];

      expect(() => service.buildExecutionPlan(tasks)).toThrow(CircularDependencyError);
    });

    it('should not throw error for valid complex dependency graph', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2' },
        { id: 'task3', handler: () => 'result3', dependencies: ['task1'] },
        { id: 'task4', handler: () => 'result4', dependencies: ['task2'] },
        { id: 'task5', handler: () => 'result5', dependencies: ['task3'] },
        { id: 'task6', handler: () => 'result6', dependencies: ['task4'] },
        { id: 'task7', handler: () => 'result7', dependencies: ['task5', 'task6'] },
      ];

      expect(() => service.buildExecutionPlan(tasks)).not.toThrow();
    });
  });

  describe('topological sorting', () => {
    it('should maintain dependency order in execution plan', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task3', handler: () => 'result3', dependencies: ['task1', 'task2'] },
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2', dependencies: ['task1'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      // task1 should be in first batch
      expect(plan.batches[0].tasks.some(t => t.id === 'task1')).toBe(true);
      
      // task2 should be in second batch (after task1)
      expect(plan.batches[1].tasks.some(t => t.id === 'task2')).toBe(true);
      
      // task3 should be in third batch (after task1 and task2)
      expect(plan.batches[2].tasks.some(t => t.id === 'task3')).toBe(true);
    });

    it('should handle multiple valid topological orders', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2' },
        { id: 'task3', handler: () => 'result3', dependencies: ['task1'] },
        { id: 'task4', handler: () => 'result4', dependencies: ['task2'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      // First batch should contain task1 and task2
      expect(plan.batches[0].tasks).toHaveLength(2);
      const firstBatchIds = plan.batches[0].tasks.map(t => t.id);
      expect(firstBatchIds).toContain('task1');
      expect(firstBatchIds).toContain('task2');

      // Second batch should contain task3 and task4
      expect(plan.batches[1].tasks).toHaveLength(2);
      const secondBatchIds = plan.batches[1].tasks.map(t => t.id);
      expect(secondBatchIds).toContain('task3');
      expect(secondBatchIds).toContain('task4');
    });
  });

  describe('parallel execution batching', () => {
    it('should identify tasks that can run in parallel', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2' },
        { id: 'task3', handler: () => 'result3' },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].canRunInParallel).toBe(true);
      expect(plan.batches[0].tasks).toHaveLength(3);
    });

    it('should identify tasks that must run sequentially', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2', dependencies: ['task1'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.batches).toHaveLength(2);
      expect(plan.batches[0].canRunInParallel).toBe(false);
      expect(plan.batches[1].canRunInParallel).toBe(false);
    });

    it('should optimize parallel execution for diamond dependency pattern', () => {
      const tasks: TaskDefinition[] = [
        { id: 'start', handler: () => 'start' },
        { id: 'left', handler: () => 'left', dependencies: ['start'] },
        { id: 'right', handler: () => 'right', dependencies: ['start'] },
        { id: 'end', handler: () => 'end', dependencies: ['left', 'right'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.batches).toHaveLength(3);
      
      // First batch: start task
      expect(plan.batches[0].tasks).toHaveLength(1);
      expect(plan.batches[0].tasks[0].id).toBe('start');
      
      // Second batch: left and right tasks in parallel
      expect(plan.batches[1].tasks).toHaveLength(2);
      expect(plan.batches[1].canRunInParallel).toBe(true);
      const middleBatchIds = plan.batches[1].tasks.map(t => t.id);
      expect(middleBatchIds).toContain('left');
      expect(middleBatchIds).toContain('right');
      
      // Third batch: end task
      expect(plan.batches[2].tasks).toHaveLength(1);
      expect(plan.batches[2].tasks[0].id).toBe('end');
    });
  });

  describe('edge cases', () => {
    it('should handle empty task array', () => {
      const tasks: TaskDefinition[] = [];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.totalTasks).toBe(0);
      expect(plan.batches).toHaveLength(0);
      expect(plan.estimatedDuration).toBe(0);
    });

    it('should handle single task', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.totalTasks).toBe(1);
      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].tasks).toHaveLength(1);
      expect(plan.batches[0].canRunInParallel).toBe(false);
    });

    it('should handle tasks with empty dependencies array', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', dependencies: [] },
        { id: 'task2', handler: () => 'result2', dependencies: [] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].canRunInParallel).toBe(true);
      expect(plan.batches[0].tasks).toHaveLength(2);
    });

    it('should handle tasks with null or undefined dependencies', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', dependencies: null as any },
        { id: 'task2', handler: () => 'result2', dependencies: undefined },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].canRunInParallel).toBe(true);
      expect(plan.batches[0].tasks).toHaveLength(2);
    });

    it('should handle tasks with whitespace-only IDs', () => {
      const tasks: TaskDefinition[] = [
        { id: '   ', handler: () => 'result1' },
      ];

      // The current implementation accepts whitespace-only IDs as valid strings
      // This test verifies the current behavior
      const plan = service.buildExecutionPlan(tasks);
      expect(plan.totalTasks).toBe(1);
      expect(plan.batches[0].tasks[0].id).toBe('   ');
    });

    it('should handle tasks with numeric zero timeout', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', timeoutMs: 0 },
      ];

      const plan = service.buildExecutionPlan(tasks);

      // Zero timeout is falsy, so it defaults to 30000ms
      expect(plan.estimatedDuration).toBe(30000);
    });

    it('should handle mixed timeout configurations', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1', timeoutMs: 1000 },
        { id: 'task2', handler: () => 'result2' }, // No timeout specified
        { id: 'task3', handler: () => 'result3', timeoutMs: 2000 },
      ];

      const plan = service.buildExecutionPlan(tasks);

      // All tasks run in parallel, so max timeout should be used (30000 for task2)
      expect(plan.estimatedDuration).toBe(30000);
    });

    it('should handle large dependency graphs efficiently', () => {
      // Create a large linear chain
      const tasks: TaskDefinition[] = [];
      for (let i = 1; i <= 100; i++) {
        tasks.push({
          id: `task${i}`,
          handler: () => `result${i}`,
          dependencies: i > 1 ? [`task${i - 1}`] : undefined,
        });
      }

      const startTime = Date.now();
      const plan = service.buildExecutionPlan(tasks);
      const endTime = Date.now();

      expect(plan.totalTasks).toBe(100);
      expect(plan.batches).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle complex branching dependency patterns', () => {
      const tasks: TaskDefinition[] = [
        { id: 'root', handler: () => 'root' },
        { id: 'branch1', handler: () => 'branch1', dependencies: ['root'] },
        { id: 'branch2', handler: () => 'branch2', dependencies: ['root'] },
        { id: 'branch3', handler: () => 'branch3', dependencies: ['root'] },
        { id: 'merge1', handler: () => 'merge1', dependencies: ['branch1', 'branch2'] },
        { id: 'merge2', handler: () => 'merge2', dependencies: ['branch2', 'branch3'] },
        { id: 'final', handler: () => 'final', dependencies: ['merge1', 'merge2'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.totalTasks).toBe(7);
      expect(plan.batches).toHaveLength(4);
      
      // Verify execution order
      expect(plan.batches[0].tasks[0].id).toBe('root');
      
      const secondBatchIds = plan.batches[1].tasks.map(t => t.id);
      expect(secondBatchIds).toContain('branch1');
      expect(secondBatchIds).toContain('branch2');
      expect(secondBatchIds).toContain('branch3');
      expect(plan.batches[1].canRunInParallel).toBe(true);
      
      const thirdBatchIds = plan.batches[2].tasks.map(t => t.id);
      expect(thirdBatchIds).toContain('merge1');
      expect(thirdBatchIds).toContain('merge2');
      expect(plan.batches[2].canRunInParallel).toBe(true);
      
      expect(plan.batches[3].tasks[0].id).toBe('final');
    });

    it('should handle tasks with duplicate dependencies', () => {
      const tasks: TaskDefinition[] = [
        { id: 'task1', handler: () => 'result1' },
        { id: 'task2', handler: () => 'result2', dependencies: ['task1', 'task1', 'task1'] },
      ];

      const plan = service.buildExecutionPlan(tasks);

      expect(plan.totalTasks).toBe(2);
      expect(plan.batches).toHaveLength(2);
      expect(plan.batches[0].tasks[0].id).toBe('task1');
      expect(plan.batches[1].tasks[0].id).toBe('task2');
    });
  });
});