const mongoose = require('mongoose');

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
      'ABDM_HIE_CM_PUSHED'
    ]
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
  hprId: {
    type: String
  },
  ipAddress: {
    type: String
  },
  details: {
    type: Object
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
