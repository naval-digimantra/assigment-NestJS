import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { WorkflowEventLoggerService } from './workflow-event-logger.service';
import { WorkflowEvents, TaskEvent, WorkflowEvent } from '../interfaces/events.interface';

describe('WorkflowEventLoggerService', () => {
  let service: WorkflowEventLoggerService;
  let loggerSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowEventLoggerService],
    }).compile();

    service = module.get<WorkflowEventLoggerService>(WorkflowEventLoggerService);

    // Mock logger methods
    loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleTaskStarted', () => {
    it('should log task started event with correct format', () => {
      // Arrange
      const payload: TaskEvent = {
        taskId: 'test-task-1',
        timestamp: new Date('2023-01-01T10:00:00.000Z')
      };

      // Act
      service.handleTaskStarted(payload);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Task [test-task-1] started at [2023-01-01T10:00:00.000Z]'
      );
    });

    it('should handle task started event with attempt number', () => {
      // Arrange
      const payload: TaskEvent = {
        taskId: 'retry-task',
        timestamp: new Date('2023-01-01T10:00:00.000Z'),
        attempt: 1
      };

      // Act
      service.handleTaskStarted(payload);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Task [retry-task] started at [2023-01-01T10:00:00.000Z]'
      );
    });
  });

  describe('handleTaskCompleted', () => {
    it('should log task completed event with correct format', () => {
      // Arrange
      const payload: TaskEvent = {
        taskId: 'completed-task',
        timestamp: new Date('2023-01-01T10:05:00.000Z'),
        result: { data: 'success' }
      };

      // Act
      service.handleTaskCompleted(payload);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Task [completed-task] completed at [2023-01-01T10:05:00.000Z]'
      );
    });
  });

  describe('handleTaskFailed', () => {
    it('should log task failed event with error message', () => {
      // Arrange
      const error = new Error('Task execution failed');
      const payload: TaskEvent = {
        taskId: 'failed-task',
        timestamp: new Date('2023-01-01T10:03:00.000Z'),
        error
      };

      // Act
      service.handleTaskFailed(payload);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        'Task [failed-task] failed at [2023-01-01T10:03:00.000Z] - Error: Task execution failed'
      );
    });

    it('should handle task failed event without error message', () => {
      // Arrange
      const payload: TaskEvent = {
        taskId: 'failed-task-no-error',
        timestamp: new Date('2023-01-01T10:03:00.000Z')
      };

      // Act
      service.handleTaskFailed(payload);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        'Task [failed-task-no-error] failed at [2023-01-01T10:03:00.000Z] - Error: Unknown error'
      );
    });
  });

  describe('handleTaskRetry', () => {
    it('should log task retry event with attempt number and error', () => {
      // Arrange
      const error = new Error('Temporary failure');
      const payload: TaskEvent = {
        taskId: 'retry-task',
        timestamp: new Date('2023-01-01T10:02:00.000Z'),
        attempt: 2,
        error
      };

      // Act
      service.handleTaskRetry(payload);

      // Assert
      expect(warnSpy).toHaveBeenCalledWith(
        'Task [retry-task] retry attempt 2 at [2023-01-01T10:02:00.000Z] - Previous error: Temporary failure'
      );
    });

    it('should handle task retry event without error message', () => {
      // Arrange
      const payload: TaskEvent = {
        taskId: 'retry-task-no-error',
        timestamp: new Date('2023-01-01T10:02:00.000Z'),
        attempt: 1
      };

      // Act
      service.handleTaskRetry(payload);

      // Assert
      expect(warnSpy).toHaveBeenCalledWith(
        'Task [retry-task-no-error] retry attempt 1 at [2023-01-01T10:02:00.000Z] - Previous error: Unknown error'
      );
    });
  });

  describe('handleWorkflowStarted', () => {
    it('should log workflow started event with workflow ID and task count', () => {
      // Arrange
      const payload: WorkflowEvent = {
        workflowId: 'test-workflow',
        timestamp: new Date('2023-01-01T09:00:00.000Z'),
        totalTasks: 5
      };

      // Act
      service.handleWorkflowStarted(payload);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Workflow [test-workflow] started at [2023-01-01T09:00:00.000Z] with 5 tasks'
      );
    });

    it('should handle workflow started event without workflow ID', () => {
      // Arrange
      const payload: WorkflowEvent = {
        timestamp: new Date('2023-01-01T09:00:00.000Z'),
        totalTasks: 3
      };

      // Act
      service.handleWorkflowStarted(payload);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Workflow [unnamed] started at [2023-01-01T09:00:00.000Z] with 3 tasks'
      );
    });
  });

  describe('handleWorkflowCompleted', () => {
    it('should log workflow completed event with success statistics', () => {
      // Arrange
      const payload: WorkflowEvent = {
        workflowId: 'completed-workflow',
        timestamp: new Date('2023-01-01T09:30:00.000Z'),
        totalTasks: 5,
        completedTasks: 4,
        failedTasks: 1
      };

      // Act
      service.handleWorkflowCompleted(payload);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Workflow [completed-workflow] completed at [2023-01-01T09:30:00.000Z] - 4/5 tasks successful'
      );
    });

    it('should handle workflow completed event without workflow ID', () => {
      // Arrange
      const payload: WorkflowEvent = {
        timestamp: new Date('2023-01-01T09:30:00.000Z'),
        totalTasks: 2,
        completedTasks: 2,
        failedTasks: 0
      };

      // Act
      service.handleWorkflowCompleted(payload);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Workflow [unnamed] completed at [2023-01-01T09:30:00.000Z] - 2/2 tasks successful'
      );
    });
  });

  describe('handleWorkflowFailed', () => {
    it('should log workflow failed event with error message', () => {
      // Arrange
      const error = new Error('Workflow execution failed');
      const payload: WorkflowEvent = {
        workflowId: 'failed-workflow',
        timestamp: new Date('2023-01-01T09:15:00.000Z'),
        error
      };

      // Act
      service.handleWorkflowFailed(payload);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        'Workflow [failed-workflow] failed at [2023-01-01T09:15:00.000Z] - Error: Workflow execution failed'
      );
    });

    it('should handle workflow failed event without error message', () => {
      // Arrange
      const payload: WorkflowEvent = {
        workflowId: 'failed-workflow-no-error',
        timestamp: new Date('2023-01-01T09:15:00.000Z')
      };

      // Act
      service.handleWorkflowFailed(payload);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        'Workflow [failed-workflow-no-error] failed at [2023-01-01T09:15:00.000Z] - Error: Unknown error'
      );
    });
  });
});