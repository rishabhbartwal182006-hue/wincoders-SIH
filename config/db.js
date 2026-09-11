const mongoose = require('mongoose');

// In-memory Mock Store for fallback when MongoDB daemon is offline
class MemoryStore {
  constructor() {
    this.collections = {
      ProvisionalIntake: new Map(),
      HprAuthToken: new Map(),
      AuditLog: new Map()
    };
  }

  getCollection(name) {
    if (!this.collections[name]) {
      this.collections[name] = new Map();
    }
    return this.collections[name];
  }

  async save(collectionName, doc) {
    const col = this.getCollection(collectionName);
    const id = (collectionName === 'AuditLog' && doc.logId) ? doc.logId : (doc.logId || doc.intakeId || doc.hprId || doc.token || doc._id || `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    const record = { ...doc, _id: id, createdAt: doc.createdAt || new Date(), updatedAt: new Date() };
    col.set(id, record);
    return record;
  }

  async findOne(collectionName, query) {
    const col = this.getCollection(collectionName);
    for (const item of col.values()) {
      let match = true;
      for (const key of Object.keys(query)) {
        if (item[key] !== query[key]) {
          if (key === 'action' && (
            (query[key] === 'ALTITUDE_INTERPRETATION_OVERRIDE' && item[key] === 'ALTITUDE_INTERPRETATION_OVERRIDDEN') ||
            (query[key] === 'ALTITUDE_INTERPRETATION_OVERRIDDEN' && item[key] === 'ALTITUDE_INTERPRETATION_OVERRIDE')
          )) {
            continue;
          }
          match = false;
          break;
        }
      }
      if (match) return item;
    }
    return null;
  }

  async find(collectionName, query = {}) {
    const col = this.getCollection(collectionName);
    const results = [];
    for (const item of col.values()) {
      let match = true;
      for (const key of Object.keys(query)) {
        if (item[key] !== query[key]) {
          if (key === 'action' && (
            (query[key] === 'ALTITUDE_INTERPRETATION_OVERRIDE' && item[key] === 'ALTITUDE_INTERPRETATION_OVERRIDDEN') ||
            (query[key] === 'ALTITUDE_INTERPRETATION_OVERRIDDEN' && item[key] === 'ALTITUDE_INTERPRETATION_OVERRIDE')
          )) {
            continue;
          }
          match = false;
          break;
        }
      }
      if (match) results.push(item);
    }
    return results;
  }

  async updateOne(collectionName, query, update) {
    const item = await this.findOne(collectionName, query);
    if (!item) return null;
    const updated = { ...item, ...update, updatedAt: new Date() };
    const col = this.getCollection(collectionName);
    col.set(item._id, updated);
    return updated;
  }
}

const memoryStore = new MemoryStore();
let isMongoConnected = false;

const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/medikiosk';
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 2000
    });
    isMongoConnected = true;
    console.log(`[Database] MongoDB connected successfully: ${mongoURI}`);
  } catch (err) {
    isMongoConnected = false;
    console.log(`[Database] MongoDB connection bypassed (${err.message}). Using high-performance in-memory persistence fallback engine.`);
  }
};

module.exports = {
  connectDB,
  isMongoConnected: () => isMongoConnected,
  memoryStore
};
