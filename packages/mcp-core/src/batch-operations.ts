/**
 * Batch Operations - Bulk API Request Processing
 *
 * Provides batch execution of API operations with configurable concurrency,
 * error handling, and progress tracking.
 */

export interface BatchOperationConfig {
  /**
   * Maximum concurrent operations
   * @default 5
   */
  concurrency?: number;

  /**
   * Stop on first error (fail-fast) or continue processing
   * @default false (continue on error)
   */
  stopOnError?: boolean;

  /**
   * Retry failed operations
   * @default 0 (no retries)
   */
  retries?: number;

  /**
   * Delay between retries in milliseconds
   * @default 1000
   */
  retryDelay?: number;

  /**
   * Progress callback (called after each operation completes)
   */
  onProgress?: (progress: BatchProgress) => void;
}

export interface BatchProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  percentage: number;
}

export interface BatchOperation<T, R> {
  /**
   * Unique identifier for this operation
   */
  id: string;

  /**
   * Input data for the operation
   */
  input: T;

  /**
   * The async function to execute
   */
  operation: (input: T) => Promise<R>;
}

export interface BatchResult<T, R> {
  /**
   * Operation ID
   */
  id: string;

  /**
   * Input data
   */
  input: T;

  /**
   * Result (if successful)
   */
  result?: R;

  /**
   * Error (if failed)
   */
  error?: Error;

  /**
   * Success flag
   */
  success: boolean;

  /**
   * Number of retry attempts made
   */
  attempts: number;
}

export interface BatchExecutionResult<T, R> {
  /**
   * All operation results
   */
  results: BatchResult<T, R>[];

  /**
   * Summary statistics
   */
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number;
    totalDuration: number;
  };
}

/**
 * Batch Operations Executor
 *
 * Executes multiple operations in batches with configurable concurrency
 * and error handling. Supports progress tracking and retry logic.
 */
export class BatchOperations {
  private readonly config: Required<BatchOperationConfig>;

  constructor(config: BatchOperationConfig = {}) {
    this.config = {
      concurrency: config.concurrency || 5,
      stopOnError: config.stopOnError || false,
      retries: config.retries || 0,
      retryDelay: config.retryDelay || 1000,
      onProgress: config.onProgress || (() => {}),
    };
  }

  /**
   * Execute batch operations with concurrency control
   */
  async execute<T, R>(
    operations: BatchOperation<T, R>[]
  ): Promise<BatchExecutionResult<T, R>> {
    const startTime = Date.now();
    const results: BatchResult<T, R>[] = [];
    const queue = [...operations];
    const inProgress = new Set<Promise<void>>();

    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    // Process operations with concurrency limit
    while (queue.length > 0 || inProgress.size > 0) {
      // Start new operations up to concurrency limit
      while (queue.length > 0 && inProgress.size < this.config.concurrency) {
        const operation = queue.shift()!;

        const promise = this.executeOperation(operation)
          .then((result) => {
            results.push(result);
            completed++;
            if (result.success) {
              succeeded++;
            } else {
              failed++;
            }

            // Call progress callback
            this.config.onProgress({
              total: operations.length,
              completed,
              succeeded,
              failed,
              percentage: (completed / operations.length) * 100,
            });

            // Stop on error if configured
            if (!result.success && this.config.stopOnError) {
              queue.length = 0; // Clear queue
            }
          })
          .finally(() => {
            inProgress.delete(promise);
          });

        inProgress.add(promise);
      }

      // Wait for at least one operation to complete
      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }

    const totalDuration = Date.now() - startTime;

    return {
      results,
      summary: {
        total: operations.length,
        succeeded,
        failed,
        successRate: succeeded / operations.length,
        totalDuration,
      },
    };
  }

  /**
   * Execute a single operation with retry logic
   */
  private async executeOperation<T, R>(
    operation: BatchOperation<T, R>
  ): Promise<BatchResult<T, R>> {
    let attempts = 0;
    let lastError: Error | undefined;

    while (attempts <= this.config.retries) {
      attempts++;
      try {
        const result = await operation.operation(operation.input);
        return {
          id: operation.id,
          input: operation.input,
          result,
          success: true,
          attempts,
        };
      } catch (error) {
        lastError = error as Error;

        // Retry if attempts remaining
        if (attempts <= this.config.retries) {
          await this.delay(this.config.retryDelay);
        }
      }
    }

    // All retries exhausted
    return {
      id: operation.id,
      input: operation.input,
      error: lastError,
      success: false,
      attempts,
    };
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<BatchOperationConfig>> {
    return { ...this.config };
  }
}

/**
 * Helper function to create batch operations from array of inputs
 */
export function createBatchOperations<T, R>(
  inputs: T[],
  operation: (input: T) => Promise<R>,
  idPrefix: string = 'op'
): BatchOperation<T, R>[] {
  return inputs.map((input, index) => ({
    id: `${idPrefix}-${index}`,
    input,
    operation,
  }));
}

/**
 * Helper function to filter successful results
 */
export function getSuccessfulResults<T, R>(
  results: BatchResult<T, R>[]
): Array<{ id: string; input: T; result: R }> {
  return results
    .filter(r => r.success && r.result !== undefined)
    .map(r => ({ id: r.id, input: r.input, result: r.result! }));
}

/**
 * Helper function to filter failed results
 */
export function getFailedResults<T, R>(
  results: BatchResult<T, R>[]
): Array<{ id: string; input: T; error: Error }> {
  return results
    .filter(r => !r.success && r.error !== undefined)
    .map(r => ({ id: r.id, input: r.input, error: r.error! }));
}
