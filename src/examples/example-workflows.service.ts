import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowEngineService } from '../workflow/services/workflow-engine.service';
import { 
  WorkflowDefinition, 
  TaskDefinition 
} from '../workflow/interfaces/task.interface';
import { 
  WorkflowEvents, 
  TaskEvent, 
  WorkflowEvent 
} from '../workflow/interfaces/events.interface';

/**
 * Example service demonstrating various workflow patterns and use cases
 */
@Injectable()
export class ExampleWorkflowsService {
  private readonly logger = new Logger(ExampleWorkflowsService.name);

  constructor(private readonly workflowEngine: WorkflowEngineService) {}

  /**
   * Example 1: Simple linear workflow - fetchData -> processData -> saveResult
   */
  async runDataProcessingWorkflow() {
    this.logger.log('Starting data processing workflow example...');

    const workflow: WorkflowDefinition = {
      tasks: [
        {
          id: 'fetchData',
          handler: this.fetchDataTask,
          retries: 2,
          timeoutMs: 5000
        },
        {
          id: 'processData',
          handler: this.processDataTask,
          dependencies: ['fetchData'],
          retries: 1,
          timeoutMs: 10000
        },
        {
          id: 'saveResult',
          handler: this.saveResultTask,
          dependencies: ['processData'],
          retries: 3,
          timeoutMs: 5000
        }
      ],
      globalRetries: 1,
      globalTimeout: 30000
    };

    const result = await this.workflowEngine.run(workflow);
    
    this.logger.log('Data processing workflow completed:', {
      success: result.success,
      completedTasks: result.completedTasks,
      failedTasks: result.failedTasks,
      executionTime: result.executionTime
    });

    return result;
  }

  /**
   * Example 2: Parallel execution workflow
   */
  async runParallelProcessingWorkflow() {
    this.logger.log('Starting parallel processing workflow example...');

    const workflow: WorkflowDefinition = {
      tasks: [
        {
          id: 'initializeSystem',
          handler: this.initializeSystemTask,
          timeoutMs: 3000
        },
        {
          id: 'fetchUserData',
          handler: this.fetchUserDataTask,
          dependencies: ['initializeSystem'],
          retries: 2
        },
        {
          id: 'fetchProductData',
          handler: this.fetchProductDataTask,
          dependencies: ['initializeSystem'],
          retries: 2
        },
        {
          id: 'fetchOrderData',
          handler: this.fetchOrderDataTask,
          dependencies: ['initializeSystem'],
          retries: 2
        },
        {
          id: 'generateReport',
          handler: this.generateReportTask,
          dependencies: ['fetchUserData', 'fetchProductData', 'fetchOrderData'],
          timeoutMs: 15000
        },
        {
          id: 'sendNotification',
          handler: this.sendNotificationTask,
          dependencies: ['generateReport']
        }
      ]
    };

    const result = await this.workflowEngine.run(workflow);
    
    this.logger.log('Parallel processing workflow completed:', {
      success: result.success,
      completedTasks: result.completedTasks,
      failedTasks: result.failedTasks,
      executionTime: result.executionTime
    });

    return result;
  }

  /**
   * Example 3: Error handling and retry demonstration
   */
  async runErrorHandlingWorkflow() {
    this.logger.log('Starting error handling workflow example...');

    const workflow: WorkflowDefinition = {
      tasks: [
        {
          id: 'reliableTask',
          handler: this.reliableTask
        },
        {
          id: 'flakyTask',
          handler: this.flakyTask,
          retries: 3,
          timeoutMs: 2000
        },
        {
          id: 'timeoutTask',
          handler: this.timeoutTask,
          retries: 2,
          timeoutMs: 1000
        },
        {
          id: 'finalTask',
          handler: this.finalTask,
          dependencies: ['reliableTask'] // Only depends on reliable task
        }
      ]
    };

    const result = await this.workflowEngine.run(workflow);
    
    this.logger.log('Error handling workflow completed:', {
      success: result.success,
      completedTasks: result.completedTasks,
      failedTasks: result.failedTasks,
      errors: Object.keys(result.errors),
      executionTime: result.executionTime
    });

    return result;
  }

  // Task implementations for examples

  private fetchDataTask = async (): Promise<{ data: string; timestamp: Date }> => {
    // Simulate API call
    await this.delay(1000);
    const data = { data: 'Sample data from API', timestamp: new Date() };
    console.log('✅ Fetched data:', data);
    return data;
  }

  private processDataTask = async (): Promise<{ processedData: string; count: number }> => {
    // Simulate data processing
    await this.delay(2000);
    const result = { processedData: 'Processed sample data', count: 42 };
    console.log('✅ Processed data:', result);
    return result;
  }

  private saveResultTask = async (): Promise<{ saved: boolean; id: string }> => {
    // Simulate saving to database
    await this.delay(500);
    const result = { saved: true, id: `result_${Date.now()}` };
    console.log('✅ Saved result:', result);
    return result;
  }

  private initializeSystemTask = async (): Promise<{ initialized: boolean }> => {
    await this.delay(1000);
    console.log('✅ System initialized');
    return { initialized: true };
  }

  private fetchUserDataTask = async (): Promise<{ users: number }> => {
    await this.delay(1500);
    const result = { users: 150 };
    console.log('✅ Fetched user data:', result);
    return result;
  }

  private fetchProductDataTask = async (): Promise<{ products: number }> => {
    await this.delay(1200);
    const result = { products: 75 };
    console.log('✅ Fetched product data:', result);
    return result;
  }

  private fetchOrderDataTask = async (): Promise<{ orders: number }> => {
    await this.delay(800);
    const result = { orders: 230 };
    console.log('✅ Fetched order data:', result);
    return result;
  }

  private generateReportTask = async (): Promise<{ reportId: string; pages: number }> => {
    await this.delay(3000);
    const result = { reportId: `report_${Date.now()}`, pages: 12 };
    console.log('✅ Generated report:', result);
    return result;
  }

  private sendNotificationTask = async (): Promise<{ sent: boolean; recipients: number }> => {
    await this.delay(500);
    const result = { sent: true, recipients: 5 };
    console.log('✅ Sent notifications:', result);
    return result;
  }

  private reliableTask = async (): Promise<{ status: string }> => {
    await this.delay(300);
    console.log('✅ Reliable task completed');
    return { status: 'success' };
  }

  private flakyTask = async (): Promise<{ attempt: number }> => {
    await this.delay(500);
    // 70% chance of failure to demonstrate retry logic
    if (Math.random() < 0.7) {
      throw new Error('Flaky task failed (simulated)');
    }
    console.log('✅ Flaky task succeeded after retries');
    return { attempt: 1 };
  }

  private timeoutTask = async (): Promise<{ completed: boolean }> => {
    // This task will timeout (takes 3 seconds but timeout is 1 second)
    await this.delay(3000);
    console.log('✅ Timeout task completed (should not see this)');
    return { completed: true };
  }

  private finalTask = async (): Promise<{ final: boolean }> => {
    await this.delay(200);
    console.log('✅ Final task completed');
    return { final: true };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Event listeners for demonstration

  @OnEvent(WorkflowEvents.WORKFLOW_STARTED)
  handleWorkflowStarted(payload: WorkflowEvent) {
    this.logger.log(`🚀 Workflow started: ${payload.workflowId} with ${payload.totalTasks} tasks`);
  }

  @OnEvent(WorkflowEvents.WORKFLOW_COMPLETED)
  handleWorkflowCompleted(payload: WorkflowEvent) {
    this.logger.log(`✅ Workflow completed: ${payload.workflowId} - ${payload.completedTasks}/${payload.totalTasks} tasks successful`);
  }

  @OnEvent(WorkflowEvents.WORKFLOW_FAILED)
  handleWorkflowFailed(payload: WorkflowEvent) {
    this.logger.error(`❌ Workflow failed: ${payload.workflowId} - ${payload.failedTasks}/${payload.totalTasks} tasks failed`);
  }

  @OnEvent(WorkflowEvents.TASK_STARTED)
  handleTaskStarted(payload: TaskEvent) {
    this.logger.debug(`⏳ Task started: ${payload.taskId}`);
  }

  @OnEvent(WorkflowEvents.TASK_COMPLETED)
  handleTaskCompleted(payload: TaskEvent) {
    this.logger.debug(`✅ Task completed: ${payload.taskId}`);
  }

  @OnEvent(WorkflowEvents.TASK_FAILED)
  handleTaskFailed(payload: TaskEvent) {
    this.logger.warn(`❌ Task failed: ${payload.taskId} - ${payload.error?.message}`);
  }

  @OnEvent(WorkflowEvents.TASK_RETRY)
  handleTaskRetry(payload: TaskEvent) {
    this.logger.warn(`🔄 Task retry: ${payload.taskId} - attempt ${payload.attempt}`);
  }
}