import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowModule } from './workflow.module';
import { WorkflowEngineService } from './services/workflow-engine.service';
import { WorkflowDefinition, TaskDefinition } from './interfaces/task.interface';

describe('WorkflowEngine E2E Integration', () => {
  let workflowEngine: WorkflowEngineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [WorkflowModule],
    }).compile();

    await module.init();
    workflowEngine = module.get<WorkflowEngineService>(WorkflowEngineService);
  });

  describe('Simple Linear Task Chains', () => {
    it('should execute a simple linear workflow', async () => {
      // Arrange
      const task1: TaskDefinition = {
        id: 'fetch-data',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { data: [1, 2, 3] };
        }
      };

      const task2: TaskDefinition = {
        id: 'process-data',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return { processed: true };
        },
        dependencies: ['fetch-data']
      };

      const task3: TaskDefinition = {
        id: 'save-result',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 8));
          return { saved: true };
        },
        dependencies: ['process-data']
      };

      const workflow: WorkflowDefinition = {
        tasks: [task1, task2, task3]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['fetch-data', 'process-data', 'save-result']);
      expect(result.failedTasks).toEqual([]);
      expect(result.results['fetch-data']).toEqual({ data: [1, 2, 3] });
      expect(result.results['process-data']).toEqual({ processed: true });
      expect(result.results['save-result']).toEqual({ saved: true });
      expect(result.totalTasks).toBe(3);
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should execute a three-step data pipeline', async () => {
      // Arrange
      const extractTask: TaskDefinition = {
        id: 'extract',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { records: 100, source: 'database' };
        }
      };

      const transformTask: TaskDefinition = {
        id: 'transform',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { transformed: 100, format: 'json' };
        },
        dependencies: ['extract']
      };

      const loadTask: TaskDefinition = {
        id: 'load',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 12));
          return { loaded: 100, destination: 'warehouse' };
        },
        dependencies: ['transform']
      };

      const workflow: WorkflowDefinition = {
        tasks: [extractTask, transformTask, loadTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(3);
      expect(result.results.extract.records).toBe(100);
      expect(result.results.transform.transformed).toBe(100);
      expect(result.results.load.loaded).toBe(100);
    });
  });

  describe('Complex Dependency Scenarios with Parallel Execution', () => {
    it('should handle diamond dependency pattern efficiently', async () => {
      // Arrange - Diamond pattern: A -> B,C -> D
      const taskA: TaskDefinition = {
        id: 'initialize',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { initialized: true, config: { version: '1.0' } };
        }
      };

      const taskB: TaskDefinition = {
        id: 'fetch-users',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 25));
          return { users: ['user1', 'user2', 'user3'] };
        },
        dependencies: ['initialize']
      };

      const taskC: TaskDefinition = {
        id: 'fetch-settings',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { settings: { theme: 'dark', lang: 'en' } };
        },
        dependencies: ['initialize']
      };

      const taskD: TaskDefinition = {
        id: 'render-dashboard',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { dashboard: 'rendered', components: 5 };
        },
        dependencies: ['fetch-users', 'fetch-settings']
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
      expect(result.completedTasks).toEqual(['initialize', 'fetch-users', 'fetch-settings', 'render-dashboard']);
      expect(result.results.initialize.initialized).toBe(true);
      expect(result.results['fetch-users'].users).toHaveLength(3);
      expect(result.results['fetch-settings'].settings.theme).toBe('dark');
      expect(result.results['render-dashboard'].dashboard).toBe('rendered');
      
      // Should complete faster than sequential execution due to parallel B,C
      // Expected: ~10ms (A) + ~25ms (max of B,C parallel) + ~15ms (D) = ~50ms + overhead
      expect(totalTime).toBeLessThan(80);
    });

    it('should handle fan-out and fan-in pattern', async () => {
      // Arrange - One task fans out to multiple parallel tasks, then fans back in
      const sourceTask: TaskDefinition = {
        id: 'source',
        handler: async () => ({ source: 'ready', timestamp: Date.now() })
      };

      const parallelTasks: TaskDefinition[] = Array.from({ length: 5 }, (_, i) => ({
        id: `parallel-${i + 1}`,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 10));
          return { processed: i + 1, result: `result-${i + 1}` };
        },
        dependencies: ['source']
      }));

      const aggregateTask: TaskDefinition = {
        id: 'aggregate',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return { aggregated: true, totalProcessed: 5 };
        },
        dependencies: parallelTasks.map(t => t.id)
      };

      const workflow: WorkflowDefinition = {
        tasks: [sourceTask, ...parallelTasks, aggregateTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(7); // 1 source + 5 parallel + 1 aggregate
      expect(result.results.source.source).toBe('ready');
      expect(result.results.aggregate.aggregated).toBe(true);
      
      // Verify all parallel tasks completed
      parallelTasks.forEach((task, i) => {
        expect(result.results[task.id].processed).toBe(i + 1);
      });
    });

    it('should handle complex multi-branch workflow', async () => {
      // Arrange - Complex workflow with multiple independent branches
      const initTask: TaskDefinition = {
        id: 'init',
        handler: async () => ({ initialized: true })
      };

      // Branch 1: User processing
      const fetchUsersTask: TaskDefinition = {
        id: 'fetch-users',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { users: 50 };
        },
        dependencies: ['init']
      };

      const validateUsersTask: TaskDefinition = {
        id: 'validate-users',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { validated: 48, invalid: 2 };
        },
        dependencies: ['fetch-users']
      };

      // Branch 2: Content processing
      const fetchContentTask: TaskDefinition = {
        id: 'fetch-content',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { articles: 25, images: 100 };
        },
        dependencies: ['init']
      };

      const processContentTask: TaskDefinition = {
        id: 'process-content',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 25));
          return { processed: true, optimized: 90 };
        },
        dependencies: ['fetch-content']
      };

      // Branch 3: Analytics
      const fetchAnalyticsTask: TaskDefinition = {
        id: 'fetch-analytics',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 12));
          return { pageViews: 10000, sessions: 2500 };
        },
        dependencies: ['init']
      };

      // Final aggregation
      const generateReportTask: TaskDefinition = {
        id: 'generate-report',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 8));
          return { report: 'generated', timestamp: Date.now() };
        },
        dependencies: ['validate-users', 'process-content', 'fetch-analytics']
      };

      const workflow: WorkflowDefinition = {
        tasks: [
          initTask, fetchUsersTask, validateUsersTask,
          fetchContentTask, processContentTask,
          fetchAnalyticsTask, generateReportTask
        ]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(7);
      expect(result.results.init.initialized).toBe(true);
      expect(result.results['validate-users'].validated).toBe(48);
      expect(result.results['process-content'].processed).toBe(true);
      expect(result.results['fetch-analytics'].pageViews).toBe(10000);
      expect(result.results['generate-report'].report).toBe('generated');
    });
  });

  describe('Mixed Success/Failure Scenarios with Error Handling', () => {
    it('should handle partial failures without stopping independent branches', async () => {
      // Arrange
      const successTask1: TaskDefinition = {
        id: 'success-1',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { success: true, branch: 1 };
        }
      };

      const failingTask: TaskDefinition = {
        id: 'failing-task',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          throw new Error('Simulated failure');
        },
        retries: 1
      };

      const dependentTask: TaskDefinition = {
        id: 'dependent-on-failure',
        handler: async () => ({ shouldNotExecute: true }),
        dependencies: ['failing-task']
      };

      const successTask2: TaskDefinition = {
        id: 'success-2',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 8));
          return { success: true, branch: 2 };
        }
      };

      const workflow: WorkflowDefinition = {
        tasks: [successTask1, failingTask, dependentTask, successTask2]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toContain('success-1');
      expect(result.completedTasks).toContain('success-2');
      expect(result.failedTasks).toContain('failing-task');
      expect(result.results['success-1'].success).toBe(true);
      expect(result.results['success-2'].success).toBe(true);
      expect(result.errors['failing-task']).toBeInstanceOf(Error);
    });

    it('should handle retry scenarios with eventual success', async () => {
      // Arrange
      let attempt1 = 0;
      let attempt2 = 0;

      const retrySuccessTask: TaskDefinition = {
        id: 'retry-success',
        handler: async () => {
          attempt1++;
          if (attempt1 < 3) {
            throw new Error(`Attempt ${attempt1} failed`);
          }
          return { success: true, attempts: attempt1 };
        },
        retries: 3
      };

      const retryFailTask: TaskDefinition = {
        id: 'retry-fail',
        handler: async () => {
          attempt2++;
          throw new Error(`Always fails - attempt ${attempt2}`);
        },
        retries: 2
      };

      const normalTask: TaskDefinition = {
        id: 'normal',
        handler: async () => ({ normal: true })
      };

      const workflow: WorkflowDefinition = {
        tasks: [retrySuccessTask, retryFailTask, normalTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.completedTasks).toContain('retry-success');
      expect(result.completedTasks).toContain('normal');
      expect(result.failedTasks).toContain('retry-fail');
      expect(result.results['retry-success'].attempts).toBe(3);
      expect(result.results.normal.normal).toBe(true);
      expect(attempt1).toBe(3);
      expect(attempt2).toBe(3); // Initial + 2 retries
    });
  });

  describe('Timeout and Retry Behavior in Realistic Scenarios', () => {
    it('should handle timeout with successful retry', async () => {
      // Arrange
      let attempts = 0;
      const timeoutRetryTask: TaskDefinition = {
        id: 'timeout-retry',
        handler: async () => {
          attempts++;
          if (attempts < 3) {
            // First two attempts timeout
            await new Promise(resolve => setTimeout(resolve, 150));
          } else {
            // Third attempt succeeds quickly
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          return { success: true, attempt: attempts };
        },
        timeoutMs: 100,
        retries: 3
      };

      const workflow: WorkflowDefinition = {
        tasks: [timeoutRetryTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(['timeout-retry']);
      expect(result.results['timeout-retry'].success).toBe(true);
      expect(result.results['timeout-retry'].attempt).toBe(3);
      expect(attempts).toBe(3);
    });

    it('should handle permanent timeout failure', async () => {
      // Arrange
      const alwaysTimeoutTask: TaskDefinition = {
        id: 'always-timeout',
        handler: async () => {
          // Always takes longer than timeout
          await new Promise(resolve => setTimeout(resolve, 200));
          return { shouldNotReach: true };
        },
        timeoutMs: 50,
        retries: 2
      };

      const workflow: WorkflowDefinition = {
        tasks: [alwaysTimeoutTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(false);
      expect(result.failedTasks).toEqual(['always-timeout']);
      expect(result.errors['always-timeout']).toBeInstanceOf(Error);
      expect(result.errors['always-timeout'].message).toContain('timed out');
    });

    it('should handle mixed timeout and error scenarios', async () => {
      // Arrange
      let timeoutAttempts = 0;
      let errorAttempts = 0;

      const timeoutTask: TaskDefinition = {
        id: 'timeout-task',
        handler: async () => {
          timeoutAttempts++;
          if (timeoutAttempts < 2) {
            await new Promise(resolve => setTimeout(resolve, 120));
          }
          return { timeoutSuccess: true };
        },
        timeoutMs: 100,
        retries: 2
      };

      const errorTask: TaskDefinition = {
        id: 'error-task',
        handler: async () => {
          errorAttempts++;
          if (errorAttempts < 3) {
            throw new Error(`Error attempt ${errorAttempts}`);
          }
          return { errorSuccess: true };
        },
        retries: 3
      };

      const normalTask: TaskDefinition = {
        id: 'normal-task',
        handler: async () => ({ normalSuccess: true })
      };

      const workflow: WorkflowDefinition = {
        tasks: [timeoutTask, errorTask, normalTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(3);
      expect(result.results['timeout-task'].timeoutSuccess).toBe(true);
      expect(result.results['error-task'].errorSuccess).toBe(true);
      expect(result.results['normal-task'].normalSuccess).toBe(true);
      expect(timeoutAttempts).toBe(2);
      expect(errorAttempts).toBe(3);
    });
  });

  describe('Real-world Workflow Scenarios', () => {
    it('should handle e-commerce order processing workflow', async () => {
      // Arrange - Simulate e-commerce order processing
      const validateOrderTask: TaskDefinition = {
        id: 'validate-order',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { valid: true, orderId: 'ORD-12345', items: 3 };
        },
        retries: 1
      };

      const checkInventoryTask: TaskDefinition = {
        id: 'check-inventory',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { available: true, reserved: 3 };
        },
        dependencies: ['validate-order'],
        retries: 2
      };

      const processPaymentTask: TaskDefinition = {
        id: 'process-payment',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 25));
          return { charged: true, transactionId: 'TXN-67890', amount: 99.99 };
        },
        dependencies: ['validate-order'],
        retries: 3
      };

      const createShipmentTask: TaskDefinition = {
        id: 'create-shipment',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 18));
          return { shipmentId: 'SHIP-11111', carrier: 'UPS', tracking: 'TRK-22222' };
        },
        dependencies: ['check-inventory', 'process-payment']
      };

      const sendConfirmationTask: TaskDefinition = {
        id: 'send-confirmation',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { sent: true, email: 'customer@example.com', sms: true };
        },
        dependencies: ['create-shipment']
      };

      const workflow: WorkflowDefinition = {
        tasks: [validateOrderTask, checkInventoryTask, processPaymentTask, createShipmentTask, sendConfirmationTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(5);
      expect(result.results['validate-order'].orderId).toBe('ORD-12345');
      expect(result.results['check-inventory'].available).toBe(true);
      expect(result.results['process-payment'].charged).toBe(true);
      expect(result.results['create-shipment'].shipmentId).toBe('SHIP-11111');
      expect(result.results['send-confirmation'].sent).toBe(true);
    });

    it('should handle CI/CD pipeline workflow', async () => {
      // Arrange - Simulate CI/CD pipeline
      const checkoutCodeTask: TaskDefinition = {
        id: 'checkout-code',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 12));
          return { commit: 'abc123', branch: 'main', files: 150 };
        }
      };

      const installDepsTask: TaskDefinition = {
        id: 'install-deps',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return { installed: 45, cached: 20 };
        },
        dependencies: ['checkout-code']
      };

      const runTestsTask: TaskDefinition = {
        id: 'run-tests',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 40));
          return { passed: 98, failed: 0, coverage: 85.5 };
        },
        dependencies: ['install-deps'],
        timeoutMs: 60000
      };

      const buildAppTask: TaskDefinition = {
        id: 'build-app',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 35));
          return { built: true, size: '2.5MB', artifacts: 3 };
        },
        dependencies: ['run-tests']
      };

      const runSecurityScanTask: TaskDefinition = {
        id: 'security-scan',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 25));
          return { vulnerabilities: 0, scanned: 150 };
        },
        dependencies: ['install-deps']
      };

      const deployTask: TaskDefinition = {
        id: 'deploy',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { deployed: true, environment: 'staging', url: 'https://staging.app.com' };
        },
        dependencies: ['build-app', 'security-scan']
      };

      const workflow: WorkflowDefinition = {
        tasks: [checkoutCodeTask, installDepsTask, runTestsTask, buildAppTask, runSecurityScanTask, deployTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(6);
      expect(result.results['checkout-code'].commit).toBe('abc123');
      expect(result.results['install-deps'].installed).toBe(45);
      expect(result.results['run-tests'].passed).toBe(98);
      expect(result.results['build-app'].built).toBe(true);
      expect(result.results['security-scan'].vulnerabilities).toBe(0);
      expect(result.results.deploy.deployed).toBe(true);
    });

    it('should handle data analytics pipeline with error recovery', async () => {
      // Arrange - Simulate data analytics pipeline
      let extractAttempts = 0;
      
      const extractDataTask: TaskDefinition = {
        id: 'extract-data',
        handler: async () => {
          extractAttempts++;
          if (extractAttempts < 2) {
            throw new Error('Database connection timeout');
          }
          await new Promise(resolve => setTimeout(resolve, 25));
          return { records: 50000, sources: ['db1', 'db2', 'api'] };
        },
        retries: 2,
        timeoutMs: 30000
      };

      const cleanDataTask: TaskDefinition = {
        id: 'clean-data',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 35));
          return { cleaned: 48500, removed: 1500, duplicates: 500 };
        },
        dependencies: ['extract-data']
      };

      const transformDataTask: TaskDefinition = {
        id: 'transform-data',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 40));
          return { transformed: 48500, format: 'parquet', partitions: 10 };
        },
        dependencies: ['clean-data']
      };

      const generateMetricsTask: TaskDefinition = {
        id: 'generate-metrics',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { metrics: 25, kpis: 8, alerts: 2 };
        },
        dependencies: ['transform-data']
      };

      const createVisualizationsTask: TaskDefinition = {
        id: 'create-visualizations',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return { charts: 15, dashboards: 3, reports: 5 };
        },
        dependencies: ['transform-data']
      };

      const publishResultsTask: TaskDefinition = {
        id: 'publish-results',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { published: true, url: 'https://analytics.company.com/report-123' };
        },
        dependencies: ['generate-metrics', 'create-visualizations']
      };

      const workflow: WorkflowDefinition = {
        tasks: [extractDataTask, cleanDataTask, transformDataTask, generateMetricsTask, createVisualizationsTask, publishResultsTask]
      };

      // Act
      const result = await workflowEngine.run(workflow);

      // Assert
      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(6);
      expect(result.results['extract-data'].records).toBe(50000);
      expect(result.results['clean-data'].cleaned).toBe(48500);
      expect(result.results['transform-data'].transformed).toBe(48500);
      expect(result.results['generate-metrics'].metrics).toBe(25);
      expect(result.results['create-visualizations'].charts).toBe(15);
      expect(result.results['publish-results'].published).toBe(true);
      expect(extractAttempts).toBe(2); // Should have retried once
    });
  });
});