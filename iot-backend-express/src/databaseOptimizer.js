// High-performance database connection and query optimization
const { Sequelize, Op } = require('sequelize');

class DatabaseOptimizer {
  constructor(sequelize) {
    this.sequelize = sequelize;
    this.queryQueue = [];
    this.batchQueue = new Map();
    this.isProcessingBatch = false;
    this.batchTimeout = null;
    this.stats = {
      queriesExecuted: 0,
      batchedQueries: 0,
      cacheHits: 0,
      optimizedQueries: 0,
      averageQueryTime: 0,
      totalQueryTime: 0
    };

    // Start batch processing
    this.startBatchProcessor();
  }

  // Optimized query with automatic batching
  async optimizedQuery(model, operation, options = {}) {
    const startTime = Date.now();
    
    try {
      let result;
      
      // Handle different operations with optimization
      switch (operation) {
        case 'findOne':
          result = await this.optimizedFindOne(model, options);
          break;
        case 'findAll':
          result = await this.optimizedFindAll(model, options);
          break;
        case 'create':
          result = await this.optimizedCreate(model, options);
          break;
        case 'update':
          result = await this.optimizedUpdate(model, options);
          break;
        case 'upsert':
          result = await this.optimizedUpsert(model, options);
          break;
        case 'bulkCreate':
          result = await this.optimizedBulkCreate(model, options);
          break;
        default:
          result = await model[operation](options);
      }

      // Update stats
      const queryTime = Date.now() - startTime;
      this.updateQueryStats(queryTime);
      
      return result;
    } catch (error) {
      console.error(`Database optimization error in ${operation}:`, error);
      throw error;
    }
  }

  // Optimized findOne with intelligent caching
  async optimizedFindOne(model, options) {
    // Add query optimization hints
    const optimizedOptions = {
      ...options,
      raw: options.raw !== false, // Use raw by default for better performance
      benchmark: true,
      logging: false // Disable logging for performance
    };

    return await model.findOne(optimizedOptions);
  }

  // Optimized findAll with smart limits and indexing
  async optimizedFindAll(model, options) {
    const optimizedOptions = {
      ...options,
      raw: options.raw !== false,
      benchmark: true,
      logging: false
    };

    // Add intelligent limits if not specified
    if (!optimizedOptions.limit && !optimizedOptions.offset) {
      optimizedOptions.limit = 1000; // Prevent accidental full table scans
    }

    // Optimize ordering for better index usage
    if (optimizedOptions.order && Array.isArray(optimizedOptions.order)) {
      // Ensure proper index usage
      optimizedOptions.order = optimizedOptions.order.map(orderItem => {
        if (Array.isArray(orderItem) && orderItem.length === 2) {
          return [orderItem[0], orderItem[1].toUpperCase()];
        }
        return orderItem;
      });
    }

    return await model.findAll(optimizedOptions);
  }

  // Optimized create with validation caching
  async optimizedCreate(model, data) {
    const optimizedData = { ...data };
    
    // Remove undefined values to prevent SQL issues
    Object.keys(optimizedData).forEach(key => {
      if (optimizedData[key] === undefined) {
        delete optimizedData[key];
      }
    });

    return await model.create(optimizedData, {
      benchmark: true,
      logging: false
    });
  }

  // Optimized update with smart WHERE clauses
  async optimizedUpdate(model, data, options) {
    const optimizedOptions = {
      ...options,
      benchmark: true,
      logging: false
    };

    // Ensure WHERE clause exists to prevent accidental full table updates
    if (!optimizedOptions.where || Object.keys(optimizedOptions.where).length === 0) {
      throw new Error('Update operation requires WHERE clause for safety');
    }

    return await model.update(data, optimizedOptions);
  }

  // Optimized upsert with conflict resolution
  async optimizedUpsert(model, data) {
    const optimizedData = { ...data };
    
    // Remove undefined values
    Object.keys(optimizedData).forEach(key => {
      if (optimizedData[key] === undefined) {
        delete optimizedData[key];
      }
    });

    return await model.upsert(optimizedData, {
      benchmark: true,
      logging: false,
      returning: true
    });
  }

  // High-performance bulk operations
  async optimizedBulkCreate(model, dataArray, options = {}) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return [];
    }

    // Clean data
    const cleanedData = dataArray.map(data => {
      const cleaned = { ...data };
      Object.keys(cleaned).forEach(key => {
        if (cleaned[key] === undefined) {
          delete cleaned[key];
        }
      });
      return cleaned;
    });    const optimizedOptions = {
      ...options,
      benchmark: true,
      logging: false,
      ignoreDuplicates: options.ignoreDuplicates !== false
    };

    // Only add updateOnDuplicate if it's provided and is a non-empty array
    if (options.updateOnDuplicate && Array.isArray(options.updateOnDuplicate) && options.updateOnDuplicate.length > 0) {
      optimizedOptions.updateOnDuplicate = options.updateOnDuplicate;
    }

    // Split into smaller batches for very large operations
    const batchSize = options.batchSize || 1000;
    if (cleanedData.length > batchSize) {
      const results = [];
      for (let i = 0; i < cleanedData.length; i += batchSize) {
        const batch = cleanedData.slice(i, i + batchSize);
        const batchResult = await model.bulkCreate(batch, optimizedOptions);
        results.push(...batchResult);
      }
      return results;
    }

    return await model.bulkCreate(cleanedData, optimizedOptions);
  }

  // Batch query processor for high-throughput scenarios
  startBatchProcessor() {
    setInterval(() => {
      if (this.batchQueue.size > 0 && !this.isProcessingBatch) {
        this.processBatch();
      }
    }, 50); // Process every 50ms
  }

  async processBatch() {
    if (this.isProcessingBatch || this.batchQueue.size === 0) return;
    
    this.isProcessingBatch = true;
    const currentBatch = new Map(this.batchQueue);
    this.batchQueue.clear();

    try {
      const promises = [];
      
      for (const [key, operations] of currentBatch) {
        // Group similar operations for batch processing
        if (operations.length > 1 && operations[0].operation === 'update') {
          // Batch updates
          promises.push(this.batchUpdateOperations(operations));
        } else if (operations.length > 1 && operations[0].operation === 'create') {
          // Batch creates
          promises.push(this.batchCreateOperations(operations));
        } else {
          // Execute individually
          operations.forEach(op => {
            promises.push(this.executeOperation(op));
          });
        }
      }

      await Promise.all(promises);
      this.stats.batchedQueries += currentBatch.size;
    } catch (error) {
      console.error('Batch processing error:', error);
    } finally {
      this.isProcessingBatch = false;
    }
  }

  async batchUpdateOperations(operations) {
    // Group by model and merge data
    const modelGroups = new Map();
    
    operations.forEach(op => {
      const modelName = op.model.name;
      if (!modelGroups.has(modelName)) {
        modelGroups.set(modelName, { model: op.model, updates: [] });
      }
      modelGroups.get(modelName).updates.push(op);
    });

    const promises = [];
    for (const [modelName, group] of modelGroups) {
      // Execute batched updates
      group.updates.forEach(update => {
        promises.push(this.executeOperation(update));
      });
    }

    return Promise.all(promises);
  }

  async batchCreateOperations(operations) {
    // Group by model
    const modelGroups = new Map();
    
    operations.forEach(op => {
      const modelName = op.model.name;
      if (!modelGroups.has(modelName)) {
        modelGroups.set(modelName, { model: op.model, data: [] });
      }
      modelGroups.get(modelName).data.push(op.data);
    });

    const promises = [];
    for (const [modelName, group] of modelGroups) {
      promises.push(
        this.optimizedBulkCreate(group.model, group.data, { ignoreDuplicates: true })
      );
    }

    return Promise.all(promises);
  }

  async executeOperation(operation) {
    const { model, operation: op, data, options } = operation;
    return await this.optimizedQuery(model, op, { ...data, ...options });
  }

  // Query statistics and monitoring
  updateQueryStats(queryTime) {
    this.stats.queriesExecuted++;
    this.stats.totalQueryTime += queryTime;
    this.stats.averageQueryTime = this.stats.totalQueryTime / this.stats.queriesExecuted;
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.batchQueue.size,
      isProcessing: this.isProcessingBatch
    };
  }

  // Connection health monitoring
  async checkConnectionHealth() {
    try {
      const startTime = Date.now();
      await this.sequelize.authenticate();
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        responseTime,
        connectionPool: {
          used: this.sequelize.connectionManager.pool.used.length,
          free: this.sequelize.connectionManager.pool.free.length,
          total: this.sequelize.connectionManager.pool.size
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        responseTime: null
      };
    }
  }

  // Optimized transaction management
  async optimizedTransaction(callback) {
    const transaction = await this.sequelize.transaction({
      isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
      type: Sequelize.Transaction.TYPES.DEFERRED
    });

    try {
      const result = await callback(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

module.exports = { DatabaseOptimizer };
