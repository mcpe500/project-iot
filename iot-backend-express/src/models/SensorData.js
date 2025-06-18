const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SensorData = sequelize.define('sensor_data', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      comment: 'Auto-incrementing primary key'
    },    deviceId: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Reference to the device that sent this data (no formal FK constraint)'
    },
    timestamp: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: 'Data collection timestamp (Unix timestamp in milliseconds)'
    },
    temperature: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Temperature reading in Celsius'
    },
    humidity: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Humidity reading in percentage'
    },
    distance: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Distance reading in centimeters'
    },
    lightLevel: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Light level reading (ADC value)'
    },
    // Extensible for additional sensor types
    pressure: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Pressure reading in hPa'
    },
    altitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Altitude reading in meters'
    },
    co2Level: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'CO2 level in ppm'
    },
    // Generic JSON field for custom sensor data
    customData: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Additional custom sensor data as JSON'
    }
  }, {
    timestamps: true,
    indexes: [
      {
        fields: ['deviceId']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['deviceId', 'timestamp']
      }
    ],
    comment: 'Sensor data collected from IoT devices'
  });

  return SensorData;
};
