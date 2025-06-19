const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Device = sequelize.define('devices', {
    id: {
      type: DataTypes.STRING(100),
      primaryKey: true,
      allowNull: false,
      comment: 'Unique device identifier'
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Human-readable device name'
    },
    type: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Device type (e.g., ESP32-CAM, ESP32-SENSOR)'
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: 'Device IP address (IPv4 or IPv6)'
    },
    status: {
      type: DataTypes.ENUM('online', 'offline', 'warning', 'error'),
      defaultValue: 'offline',
      allowNull: false,
      comment: 'Current device status'
    },
    lastSeen: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Last heartbeat timestamp (Unix timestamp in milliseconds)'
    },
    uptime: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      comment: 'Device uptime in milliseconds'
    },
    freeHeap: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Free heap memory in bytes'
    },
    wifiRssi: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'WiFi signal strength in dBm'
    },
    capabilities: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Array of device capabilities'
    },
    errors: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Error count'
    }
  }, {
    timestamps: true,
    indexes: [
      {
        fields: ['status']
      },
      {
        fields: ['lastSeen']
      },
      {
        fields: ['type']
      }
    ],
    comment: 'IoT Device registry and status tracking'
  });

  return Device;
};
