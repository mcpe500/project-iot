// High-performance in-memory cache manager for IoT backend
const EventEmitter = require('events');

class HighPerformanceCache extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxSize = options.maxSize || 10000;
    this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default
    this.cache = new Map();
    this.accessTime = new Map();
    this.writeTime = new Map();
    this.hitCount = 0;
    this.missCount = 0;
    this.stats = {
      gets: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      hits: 0,
      misses: 0
    };

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000); // Every 30 seconds
  }

  set(key, value, customTtl = null) {
    this.stats.sets++;
    const now = Date.now();
    const ttl = customTtl || this.ttl;

    // Evict if at max size
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, value);
    this.writeTime.set(key, now);
    this.accessTime.set(key, now + ttl);
    
    return true;
  }

  get(key) {
    this.stats.gets++;
    const now = Date.now();

    if (!this.cache.has(key)) {
      this.stats.misses++;
      this.missCount++;
      return undefined;
    }

    // Check TTL
    const expiresAt = this.accessTime.get(key);
    if (expiresAt && now > expiresAt) {
      this.delete(key);
      this.stats.misses++;
      this.missCount++;
      return undefined;
    }

    this.stats.hits++;
    this.hitCount++;
    return this.cache.get(key);
  }

  has(key) {
    const now = Date.now();
    if (!this.cache.has(key)) return false;

    const expiresAt = this.accessTime.get(key);
    if (expiresAt && now > expiresAt) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    this.stats.deletes++;
    this.cache.delete(key);
    this.accessTime.delete(key);
    this.writeTime.delete(key);
    return true;
  }

  clear() {
    this.cache.clear();
    this.accessTime.clear();
    this.writeTime.clear();
    this.resetStats();
  }

  evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.writeTime) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, expiresAt] of this.accessTime) {
      if (expiresAt && now > expiresAt) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`🧹 Cache cleaned up ${keysToDelete.length} expired entries`);
    }
  }

  getStats() {
    const hitRate = this.stats.gets > 0 ? (this.stats.hits / this.stats.gets * 100).toFixed(2) : '0.00';
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: `${hitRate}%`,
      memoryUsage: process.memoryUsage()
    };
  }

  resetStats() {
    this.stats = {
      gets: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      hits: 0,
      misses: 0
    };
    this.hitCount = 0;
    this.missCount = 0;
  }

  // Batch operations for better performance
  mset(entries) {
    const results = [];
    for (const [key, value, ttl] of entries) {
      results.push(this.set(key, value, ttl));
    }
    return results;
  }

  mget(keys) {
    const results = {};
    for (const key of keys) {
      results[key] = this.get(key);
    }
    return results;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// Cache factory for different data types
class CacheManager {
  constructor() {
    // Different caches for different data types with different TTLs
    this.deviceCache = new HighPerformanceCache({ 
      maxSize: 1000, 
      ttl: 2 * 60 * 1000 // 2 minutes for devices
    });
    
    this.sensorDataCache = new HighPerformanceCache({ 
      maxSize: 5000, 
      ttl: 30 * 1000 // 30 seconds for sensor data
    });
    
    this.buzzerCache = new HighPerformanceCache({ 
      maxSize: 500, 
      ttl: 1 * 60 * 1000 // 1 minute for buzzer requests
    });

    this.queryCache = new HighPerformanceCache({ 
      maxSize: 2000, 
      ttl: 60 * 1000 // 1 minute for query results
    });

    this.performanceMetrics = {
      cacheHits: 0,
      cacheMisses: 0,
      queryOptimizations: 0,
      batchOperations: 0
    };
  }

  // Device-specific caching
  cacheDevice(deviceId, deviceData) {
    this.deviceCache.set(`device:${deviceId}`, deviceData);
    this.deviceCache.set(`device:ip:${deviceData.ipAddress}`, deviceData);
  }

  getCachedDevice(deviceId) {
    return this.deviceCache.get(`device:${deviceId}`);
  }

  // Sensor data caching with smart batching
  cacheSensorData(deviceId, data, limit) {
    const key = `sensor:${deviceId}:${limit}`;
    this.sensorDataCache.set(key, data);
  }

  getCachedSensorData(deviceId, limit) {
    const key = `sensor:${deviceId}:${limit}`;
    return this.sensorDataCache.get(key);
  }

  // Buzzer request caching
  cacheBuzzerStatus(deviceId, status) {
    this.buzzerCache.set(`buzzer:${deviceId}`, status);
  }

  getCachedBuzzerStatus(deviceId) {
    return this.buzzerCache.get(`buzzer:${deviceId}`);
  }

  // Query result caching
  cacheQuery(queryKey, result) {
    this.queryCache.set(queryKey, result);
  }

  getCachedQuery(queryKey) {
    return this.queryCache.get(queryKey);
  }

  // Invalidation methods
  invalidateDevice(deviceId) {
    this.deviceCache.delete(`device:${deviceId}`);
    // Also invalidate related caches
    this.sensorDataCache.delete(`sensor:${deviceId}:*`);
    this.buzzerCache.delete(`buzzer:${deviceId}`);
  }

  invalidateDevicesByPattern(pattern) {
    const devices = this.deviceCache.cache;
    for (const key of devices.keys()) {
      if (key.includes(pattern)) {
        this.deviceCache.delete(key);
      }
    }
  }

  // Performance monitoring
  getOverallStats() {
    return {
      devices: this.deviceCache.getStats(),
      sensorData: this.sensorDataCache.getStats(),
      buzzer: this.buzzerCache.getStats(),
      queries: this.queryCache.getStats(),
      performance: this.performanceMetrics
    };
  }

  // Cleanup all caches
  cleanup() {
    this.deviceCache.cleanup();
    this.sensorDataCache.cleanup();
    this.buzzerCache.cleanup();
    this.queryCache.cleanup();
  }

  destroy() {
    this.deviceCache.destroy();
    this.sensorDataCache.destroy();
    this.buzzerCache.destroy();
    this.queryCache.destroy();
  }
}

module.exports = {
  HighPerformanceCache,
  CacheManager
};
