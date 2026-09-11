const mongoose = require('mongoose');
const crypto = require('crypto');

const AuditLogSchema = new mongoose.Schema({
  logId: {
    type: String,
    required: true,
    unique: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'KIOSK_INTAKE_RECEIVED',
      'DOCTOR_SUMMARY_ACCESSED',
      'HPR_AUTH_SUCCESS',
      'HPR_AUTH_FAILED',
      'WRITE_LOCK_COMMITTED',
      'FHIR_BUNDLE_GENERATED',
      'ABDM_HIE_CM_PUSHED',
      'ALTITUDE_INTERPRETATION_OVERRIDE',
      'ALTITUDE_INTERPRETATION_OVERRIDDEN',
      'ALTITUDE_RED_FLAG_ESCALATION',
      'ALTITUDE_RED_FLAG_TRIGGERED',
      'ALTITUDE_CONTEXT_APPLIED'
    ]
  },
  sessionId: {
    type: String
  },
  intakeId: {
    type: String
  },
  abhaId: {
    type: String
  },
  performedBy: {
    type: String,
    required: true,
    default: 'SYSTEM_KIOSK'
  },
  userId: {
    type: String
  },
  altitudeMeters: {
    type: Number
  },
  altitudeSource: {
    type: String
  },
  algorithmVersion: {
    type: String,
    default: 'altitude-mvp-v1'
  },
  hprId: {
    type: String
  },
  ipAddress: {
    type: String
  },
  details: {
    type: Object
  },
  payload: {
    type: Object
  },
  prevHash: {
    type: String,
    default: 'GENESIS'
  },
  hash: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Enforce Append-Only Immutability in Mongoose
AuditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany'], function() {
  throw new Error('AuditLog entries are append-only and tamper-evident; mutations and deletions are prohibited.');
});

let lastKnownChainHash = 'GENESIS';

/**
 * Computes SHA-256 hash for tamper-evident chaining:
 * currentHash = sha256(prevHash + timestamp + eventType + payload)
 */
function computeEntryHash(prevHash, timestamp, eventType, payload) {
  const prev = prevHash || 'GENESIS';
  const tsStr = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return crypto.createHash('sha256').update(`${prev}${tsStr}${eventType}${payloadStr}`).digest('hex');
}

/**
 * Pre-save hook to populate hash chain if not supplied
 */
AuditLogSchema.pre('save', async function(next) {
  if (!this.userId && this.performedBy) {
    this.userId = this.performedBy;
  }
  if (!this.sessionId && this.intakeId) {
    this.sessionId = this.intakeId;
  }
  if (!this.prevHash || this.prevHash === 'GENESIS') {
    this.prevHash = lastKnownChainHash;
  }
  if (!this.hash) {
    const payload = this.payload || this.details || {};
    this.hash = computeEntryHash(this.prevHash, this.timestamp || new Date(), this.action, payload);
  }
  lastKnownChainHash = this.hash;
  next();
});

const AuditLogModel = mongoose.model('AuditLog', AuditLogSchema);

async function getLastHash() {
  try {
    const { isMongoConnected, memoryStore } = require('../config/db');
    if (isMongoConnected && isMongoConnected()) {
      const last = await AuditLogModel.findOne().sort({ timestamp: -1, createdAt: -1 });
      if (last && last.hash) return last.hash;
    } else if (memoryStore) {
      const col = memoryStore.getCollection('AuditLog');
      const items = Array.from(col.values());
      if (items.length > 0) {
        items.sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
        if (items[0] && items[0].hash) return items[0].hash;
      }
    }
  } catch (err) {
    // fallback to in-memory tracker
  }
  return lastKnownChainHash;
}

/**
 * Append-only audit logger supporting both MongoDB and MemoryStore
 */
async function recordAuditLog(entry) {
  const { isMongoConnected, memoryStore } = require('../config/db');
  const prevHash = entry.prevHash || (await getLastHash());
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
  const logId = entry.logId || `AUDIT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const action = entry.action;
  const payload = entry.payload || entry.details || {};
  const hash = entry.hash || computeEntryHash(prevHash, timestamp, action, payload);

  const doc = {
    logId,
    action,
    sessionId: entry.sessionId || entry.intakeId || null,
    intakeId: entry.intakeId || entry.sessionId || null,
    abhaId: entry.abhaId || null,
    performedBy: entry.performedBy || entry.userId || 'SYSTEM_KIOSK',
    userId: entry.userId || entry.performedBy || 'SYSTEM_KIOSK',
    altitudeMeters: entry.altitudeMeters !== undefined ? Number(entry.altitudeMeters) : null,
    altitudeSource: entry.altitudeSource || null,
    algorithmVersion: entry.algorithmVersion || 'altitude-mvp-v1',
    hprId: entry.hprId || null,
    ipAddress: entry.ipAddress || null,
    details: entry.details || payload,
    payload,
    prevHash,
    hash,
    timestamp
  };

  lastKnownChainHash = hash;

  if (isMongoConnected && isMongoConnected()) {
    return await AuditLogModel.create(doc);
  } else {
    return await memoryStore.save('AuditLog', doc);
  }
}

/**
 * Validates the cryptographic integrity of an audit chain
 */
function verifyAuditChain(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return { valid: true, count: 0 };
  
  for (let i = 0; i < logs.length; i++) {
    const curr = logs[i];
    const expectedHash = computeEntryHash(curr.prevHash, curr.timestamp, curr.action, curr.payload || curr.details);
    if (curr.hash !== expectedHash) {
      return { valid: false, brokenIndex: i, error: `Hash mismatch at index ${i}: stored ${curr.hash}, expected ${expectedHash}` };
    }
    if (i > 0) {
      const prev = logs[i - 1];
      if (curr.prevHash !== prev.hash) {
        return { valid: false, brokenIndex: i, error: `Chain link broken at index ${i}: prevHash ${curr.prevHash} != previous entry hash ${prev.hash}` };
      }
    }
  }
  return { valid: true, count: logs.length };
}

AuditLogModel.computeEntryHash = computeEntryHash;
AuditLogModel.recordAuditLog = recordAuditLog;
AuditLogModel.verifyAuditChain = verifyAuditChain;
AuditLogModel.getLastHash = getLastHash;

module.exports = AuditLogModel;
