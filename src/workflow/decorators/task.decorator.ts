import { TaskDefinition } from '../interfaces/task.interface';

/**
 * Options for the @Task decorator
 */
export interface TaskOptions {

  dependencies?: string[];
  retries?: number;
  timeoutMs?: number;
}

export function Task(id: string, options: TaskOptions = {}): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    // Store task metadata on the class
    if (!target.constructor._taskDefinitions) {
      target.constructor._taskDefinitions = new Map();
    }

    const taskDefinition: TaskDefinition = {
      id,
      handler: descriptor.value,
      dependencies: options.dependencies,
      retries: options.retries,
      timeoutMs: options.timeoutMs
    };

    target.constructor._taskDefinitions.set(id, taskDefinition);
  };
}

export function getTaskDefinitions(target: any): TaskDefinition[] {
  if (!target._taskDefinitions) {
    return [];
  }
  
  return Array.from(target._taskDefinitions.values());
}

export function Workflow(name: string, options: { globalTimeout?: number; globalRetries?: number } = {}): ClassDecorator {
  return function (target: any) {
    // Store workflow metadata
    target._workflowName = name;
    target._workflowOptions = options;
    
    // Add method to get workflow definition
    target.getWorkflowDefinition = function() {
      const taskDefinitions = getTaskDefinitions(target);
      return {
        name,
        tasks: taskDefinitions,
        globalTimeout: options.globalTimeout,
        globalRetries: options.globalRetries
      };
    };
  };
}
